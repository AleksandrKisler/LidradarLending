#!/usr/bin/env node
/* LidRadar: сервер лендинга.
   Раздаёт сайт и записывает заявки с формы в файл leads.jsonl рядом с index.html:
   одна заявка — одна строка JSON. Файл можно читать прямо на сервере (cat, tail, jq).

   Запуск: node server.mjs   (Node 20+, зависимостей нет)

   Настройки (переменные окружения или флаги --port и --host):
     PORT         порт, по умолчанию 5180
     HOST         адрес, по умолчанию 127.0.0.1 (сервер стоит за nginx или Caddy); 0.0.0.0 открывает порт наружу
     LEADS_FILE   путь к файлу заявок, по умолчанию leads.jsonl рядом с этим файлом
     TRUST_PROXY  1, если сервер стоит за обратным прокси: IP посетителя берётся из X-Forwarded-For
                  (нужен только для ограничения частоты заявок; IP-адрес нигде не сохраняется)

   Файл заявок наружу не отдаётся. Сервер раздаёт только index.html, assets/ и legal/ (список ниже),
   поэтому leads.jsonl, server.mjs, README.md и каталог .git по адресу сайта недоступны.
   Правила проверки полей общие с браузером: assets/validate.js. */
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const V = require('./assets/validate.js');
const HERE = path.dirname(fileURLToPath(import.meta.url));

const BUSINESS_TYPES = ['Автосервис', 'Детейлинг', 'Салон красоты', 'Другое'];
const MAX_BODY = 8 * 1024;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_GLOBAL = 30; // заявок за окно со всего сайта
const RATE_PER_IP = 5; // заявок за окно с одного адреса
const DUPLICATE_SCAN_LINES = 500; // сколько последних заявок смотрим при поиске повтора
const TAIL_BYTES = 1024 * 1024;
const TIMEZONE = 'Europe/Moscow';

// Только это сайт отдаёт наружу. Всё остальное, включая файл заявок, отвечает 404.
const ROOT_FILES = new Set(['index.html', 'robots.txt', 'sitemap.xml', 'favicon.ico', 'favicon.svg', 'favicon.png']);
const PUBLIC_DIRS = new Set(['assets', 'legal']);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff'
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin'
};

/* ---------- Заявка: проверка и приведение к единому виду ---------- */

const str = (v) => (typeof v === 'string' ? v : '');

function cleanText(value, max) {
  const text = value === null || value === undefined ? '' : String(value);
  return text.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Один и тот же контакт в разной записи: «@Name», «t.me/name» и «name» совпадают, email без учёта регистра. */
export function contactKey(contact) {
  const checked = V.checkContact(contact);
  const text = checked.ok ? checked.value : cleanText(contact, 254);
  return text.toLowerCase().replace(/^@/, '');
}

/** Возвращает заявку или { error: поле, reason: причина }. */
export function normalizeLead(b) {
  const name = V.checkName(str(b.name));
  if (!name.ok) return { error: 'name', reason: name.reason };
  const company = V.checkCompany(str(b.company));
  if (!company.ok) return { error: 'company', reason: company.reason };
  const contact = V.checkContact(str(b.contact));
  if (!contact.ok) return { error: 'contact', reason: contact.reason };

  const business = cleanText(str(b.business), 60);
  if (!BUSINESS_TYPES.includes(business)) return { error: 'business', reason: 'unknown' };
  if (b.consent !== true) return { error: 'consent', reason: 'required' };

  let locations = null;
  if (b.locations !== null && b.locations !== undefined && b.locations !== '') {
    const n = typeof b.locations === 'number' || typeof b.locations === 'string' ? Number(String(b.locations).trim()) : NaN;
    if (!Number.isInteger(n) || n < 1 || n > 999) return { error: 'locations', reason: 'range' };
    locations = n;
  }

  return {
    id: cleanText(str(b.id), 64),
    name: name.value,
    company: company.value,
    business,
    contact: contact.value,
    contactKey: contactKey(contact.value),
    locations,
    source: cleanText(str(b.utm), 120) || cleanText(str(b.referrer), 120) || 'прямой заход'
  };
}

/* ---------- Файл заявок ---------- */

async function readTailLines(file, maxLines) {
  let fh;
  try {
    fh = await fsp.open(file, 'r');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  try {
    const { size } = await fh.stat();
    const length = Math.min(size, TAIL_BYTES);
    const buf = Buffer.alloc(length);
    const { bytesRead } = await fh.read(buf, 0, length, size - length);
    let text = buf.toString('utf8', 0, bytesRead);
    if (size > length) text = text.slice(text.indexOf('\n') + 1); // первая строка могла обрезаться
    return text.split('\n').filter(Boolean).slice(-maxLines);
  } finally {
    await fh.close();
  }
}

/** Дописывает строку и дожидается записи на диск: «принято» значит «лежит в файле». */
async function appendLine(file, line) {
  const fh = await fsp.open(file, 'a+', 0o600); // a+: дописывать в конец и читать последний байт
  try {
    const { size } = await fh.stat();
    let prefix = '';
    if (size > 0) {
      // Файл правят руками: если редактор убрал последний перевод строки, заявка не должна склеиться с предыдущей
      const last = Buffer.alloc(1);
      await fh.read(last, 0, 1, size - 1);
      if (last[0] !== 0x0a) prefix = '\n';
    }
    await fh.appendFile(prefix + line + '\n', 'utf8');
    await fh.datasync();
  } finally {
    await fh.close();
  }
}

const dateFormat = new Intl.DateTimeFormat('sv-SE', { timeZone: TIMEZONE, dateStyle: 'short', timeStyle: 'medium' });

/** Короткий отпечаток текста согласия, который видел посетитель. По нему видно, на какую редакцию он согласился. */
async function consentDocId(root) {
  try {
    const html = await fsp.readFile(path.join(root, 'legal', 'consent.html'));
    return 'sha256:' + crypto.createHash('sha256').update(html).digest('hex').slice(0, 12);
  } catch {
    return null;
  }
}

function createStore(file, root, now) {
  let chain = Promise.resolve();

  async function add(lead) {
    const recent = (await readTailLines(file, DUPLICATE_SCAN_LINES)).map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null; // строку испортили руками: пропускаем, остальные читаем дальше
      }
    }).filter(Boolean);

    // Та же заявка пришла второй раз (двойной клик, повтор после обрыва связи): строку не дублируем
    if (lead.id && recent.some((r) => r.id === lead.id)) return { duplicate: true };

    const status = recent.some((r) => typeof r.contact === 'string' && contactKey(r.contact) === lead.contactKey) ? 'Повтор' : 'Новая';
    const at = new Date(now());
    const record = {
      date: dateFormat.format(at), // московское время, для чтения глазами
      receivedAt: at.toISOString(),
      id: lead.id,
      name: lead.name,
      company: lead.company,
      business: lead.business,
      contact: lead.contact,
      locations: lead.locations,
      source: lead.source,
      status,
      consent: true,
      consentDoc: await consentDocId(root)
    };
    await appendLine(file, JSON.stringify(record));
    return { duplicate: false, status };
  }

  // Записи идут строго по очереди: две заявки одновременно не перемешаются в файле
  return {
    add(lead) {
      const run = chain.then(() => add(lead));
      chain = run.catch(() => {});
      return run;
    }
  };
}

/* ---------- Ограничение частоты ---------- */

function createRateLimiter(limitGlobal, limitIp, now) {
  let windowId = -1;
  let total = 0;
  const perIp = new Map();
  return (ip) => {
    const id = Math.floor(now() / RATE_WINDOW_MS);
    if (id !== windowId) {
      windowId = id;
      total = 0;
      perIp.clear();
    }
    const count = perIp.get(ip) ?? 0;
    if (total >= limitGlobal || count >= limitIp) return false;
    total += 1;
    perIp.set(ip, count + 1);
    return true;
  };
}

/* ---------- HTTP ---------- */

function sendJson(res, status, body, extra = {}) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
    ...extra
  });
  res.end(data);
}

function sendText(res, status, text, extra = {}) {
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    ...extra
  });
  res.end(text);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const tooLarge = () => Object.assign(new Error('body too large'), { code: 'TOO_LARGE' });
    if (Number(req.headers['content-length']) > limit) return reject(tooLarge());
    const chunks = [];
    let size = 0;
    let failed = false;
    req.on('data', (chunk) => {
      if (failed) return;
      size += chunk.length;
      if (size > limit) {
        failed = true;
        reject(tooLarge());
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => { if (!failed) resolve(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', reject);
  });
}

function clientIp(req, trustProxy) {
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    // Правый адрес дописал наш прокси; левые посетитель мог подставить сам
    if (typeof forwarded === 'string') {
      const last = forwarded.split(',').pop().trim();
      if (last) return last;
    }
  }
  return req.socket.remoteAddress || 'unknown';
}

/** Путь в URL → файл на диске, только из разрешённого списка. Иначе null. */
function resolvePublic(root, pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (/[\0\\]/.test(rel)) return null;
  const parts = rel.split('/').filter((p) => p !== '');
  if (parts.some((p) => p === '.' || p === '..' || p.startsWith('.'))) return null;
  if (parts.length === 0) return { file: path.join(root, 'index.html'), trailing: true };
  const allowed = parts.length === 1 ? ROOT_FILES.has(parts[0]) || PUBLIC_DIRS.has(parts[0]) : PUBLIC_DIRS.has(parts[0]);
  if (!allowed) return null;
  const file = path.join(root, ...parts);
  if (file !== root && !file.startsWith(root + path.sep)) return null;
  return { file, trailing: rel.endsWith('/') };
}

export function createLandingServer(options = {}) {
  const root = path.resolve(options.root ?? HERE);
  const leadsFile = path.resolve(options.leadsFile ?? process.env.LEADS_FILE ?? path.join(root, 'leads.jsonl'));
  const now = options.now ?? Date.now;
  const trustProxy = options.trustProxy ?? process.env.TRUST_PROXY === '1';

  // Файл заявок не должен лежать там, откуда сайт отдаёт файлы
  for (const dir of PUBLIC_DIRS) {
    const rel = path.relative(path.join(root, dir), leadsFile);
    if (!rel.startsWith('..') && !path.isAbsolute(rel)) throw new Error(`Файл заявок не может лежать в каталоге «${dir}/»: он отдаётся сайтом.`);
  }
  if (path.dirname(leadsFile) === root && ROOT_FILES.has(path.basename(leadsFile))) {
    throw new Error('Файл заявок не может называться как файл сайта.');
  }

  const store = createStore(leadsFile, root, now);
  const allow = createRateLimiter(options.rateGlobal ?? RATE_GLOBAL, options.rateIp ?? RATE_PER_IP, now);

  async function handleLead(req, res) {
    let raw;
    try {
      raw = await readBody(req, MAX_BODY);
    } catch (err) {
      if (err.code === 'TOO_LARGE') return sendJson(res, 413, { ok: false, error: 'too_large' }, { Connection: 'close' });
      throw err;
    }
    let body = null;
    try { body = JSON.parse(raw); } catch { /* не JSON */ }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return sendJson(res, 400, { ok: false, error: 'bad_request' });

    // Поле-ловушка для ботов: человек его не видит. Отвечаем «ок», но ничего не пишем.
    if (body.website !== undefined && body.website !== null && cleanText(String(body.website), 200)) return sendJson(res, 200, { ok: true });

    const lead = normalizeLead(body);
    if (lead.error) return sendJson(res, 422, { ok: false, error: 'invalid', field: lead.error, reason: lead.reason });
    if (!allow(clientIp(req, trustProxy))) return sendJson(res, 429, { ok: false, error: 'rate' }, { 'Retry-After': String(RATE_WINDOW_MS / 1000) });

    const result = await store.add(lead);
    // В журнал идёт только факт заявки: имени и контакта там нет
    if (!result.duplicate) console.log(`[lead] принята заявка, статус «${result.status}»`);
    return sendJson(res, 200, result.duplicate ? { ok: true, duplicate: true } : { ok: true });
  }

  async function handleStatic(req, res, pathname) {
    let target = resolvePublic(root, pathname);
    if (!target) return sendText(res, 404, 'Not found');
    let stat;
    try {
      stat = await fsp.stat(target.file);
      if (stat.isDirectory()) {
        if (!target.trailing) {
          res.writeHead(301, { ...SECURITY_HEADERS, Location: pathname + '/' });
          return res.end();
        }
        target = { file: path.join(target.file, 'index.html') };
        stat = await fsp.stat(target.file);
      }
    } catch {
      return sendText(res, 404, 'Not found');
    }
    if (!stat.isFile()) return sendText(res, 404, 'Not found');

    const ext = path.extname(target.file).toLowerCase();
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': TYPES[ext] ?? 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
      'Last-Modified': stat.mtime.toUTCString()
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(target.file).on('error', () => res.destroy()).pipe(res);
  }

  async function handle(req, res) {
    const { pathname } = new URL(req.url, 'http://localhost');

    if (pathname === '/api/lead') {
      if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method' }, { Allow: 'POST' });
      return handleLead(req, res);
    }
    if (pathname === '/api/health') return sendJson(res, 200, { ok: true, service: 'lidradar-landing' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendText(res, 405, 'Method not allowed', { Allow: 'GET, HEAD' });
    return handleStatic(req, res, pathname);
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error('[error]', err && err.message ? err.message : err);
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: 'server' });
      else res.destroy();
    });
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  server.leadsFile = leadsFile;
  return server;
}

/* ---------- Запуск ---------- */

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

function main() {
  const port = Number(argValue('--port') ?? process.env.PORT ?? 5180);
  const host = argValue('--host') ?? process.env.HOST ?? '127.0.0.1';
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Неверный порт: ' + port);

  const server = createLandingServer();
  fs.accessSync(path.dirname(server.leadsFile), fs.constants.W_OK); // нет прав на запись: лучше упасть сейчас, чем потерять заявку

  server.listen(port, host, () => {
    console.log(`LidRadar: http://${host}:${port}`);
    console.log(`Заявки пишутся в ${server.leadsFile} (наружу не отдаётся)`);
  });

  const stop = () => {
    server.close(() => process.exit(0));
    server.closeIdleConnections();
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) main();
