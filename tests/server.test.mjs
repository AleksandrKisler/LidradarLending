/**
 * Проверка server.mjs: приём заявок в файл и раздача сайта.
 * Запуск: node --test   (Node 20+)
 *
 * Сервер поднимается на свободном порту, заявки пишутся во временный файл вне репозитория.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLandingServer } from '../server.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lidradar-leads-'));
let counter = 0;

async function start(options = {}) {
  const leadsFile = path.join(TMP, `leads-${++counter}.jsonl`);
  const server = createLandingServer({ root: ROOT, leadsFile, ...options });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const stop = () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); });
  const lines = () => (fs.existsSync(leadsFile) ? fs.readFileSync(leadsFile, 'utf8').split('\n').filter(Boolean) : []);
  return { base, leadsFile, stop, lines };
}

const lead = (extra = {}) => ({
  id: 'id-' + Math.random().toString(36).slice(2),
  name: 'Дмитрий Соколов',
  company: 'Студия «Блик»',
  business: 'Автосервис',
  contact: '@dmitry_s',
  locations: 2,
  consent: true,
  source: 'landing',
  utm: '',
  referrer: '',
  submittedAt: new Date().toISOString(),
  ...extra
});

const post = (base, body, headers = {}) =>
  fetch(base + '/api/lead', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });

after(() => fs.rmSync(TMP, { recursive: true, force: true }));

test('заявка попадает в файл одной строкой JSON с нужными полями', async () => {
  const s = await start();
  try {
    const res = await post(s.base, lead({ utm: 'yandex / cpc', contact: 'https://t.me/Dmitry_S' }));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });

    const rows = s.lines().map((l) => JSON.parse(l));
    assert.equal(rows.length, 1);
    const r = rows[0];
    assert.equal(r.name, 'Дмитрий Соколов');
    assert.equal(r.company, 'Студия «Блик»');
    assert.equal(r.business, 'Автосервис');
    assert.equal(r.contact, '@Dmitry_S');
    assert.equal(r.locations, 2);
    assert.equal(r.source, 'yandex / cpc');
    assert.equal(r.status, 'Новая');
    assert.equal(r.consent, true);
    assert.match(r.date, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    assert.ok(!Number.isNaN(Date.parse(r.receivedAt)));
    assert.match(r.consentDoc, /^sha256:[0-9a-f]{12}$/);
    assert.ok(!('ip' in r) && !('userAgent' in r), 'IP и User-Agent не сохраняются');
    // кириллица лежит в файле как есть, а не \u-последовательностями
    assert.ok(s.lines()[0].includes('Дмитрий Соколов'));
    if (process.platform !== 'win32') assert.equal(fs.statSync(s.leadsFile).mode & 0o777, 0o600);
  } finally { await s.stop(); }
});

test('значения приводятся к единому виду, пустые необязательные поля не мешают', async () => {
  const s = await start();
  try {
    const res = await post(s.base, lead({ name: '  Иван   Петров ', contact: ' IVAN@MAIL.RU ', locations: null }));
    assert.equal(res.status, 200);
    const r = JSON.parse(s.lines()[0]);
    assert.equal(r.name, 'Иван Петров');
    assert.equal(r.contact, 'ivan@mail.ru');
    assert.equal(r.locations, null);
    assert.equal(r.source, 'прямой заход');
  } finally { await s.stop(); }
});

test('повторная отправка той же заявки (тот же id) не дублирует строку', async () => {
  const s = await start();
  try {
    const body = lead({ id: 'same-id' });
    assert.equal((await post(s.base, body)).status, 200);
    const again = await post(s.base, body);
    assert.equal(again.status, 200);
    assert.deepEqual(await again.json(), { ok: true, duplicate: true });
    assert.equal(s.lines().length, 1);
  } finally { await s.stop(); }
});

test('тот же контакт в другой записи получает статус «Повтор»', async () => {
  const s = await start();
  try {
    await post(s.base, lead({ contact: '@Dmitry_S' }));
    await post(s.base, lead({ contact: 't.me/dmitry_s' }));
    await post(s.base, lead({ contact: '@other_person' }));
    const statuses = s.lines().map((l) => JSON.parse(l).status);
    assert.deepEqual(statuses, ['Новая', 'Повтор', 'Новая']);
  } finally { await s.stop(); }
});

test('поле-ловушка: бот получает «ок», но в файл ничего не попадает', async () => {
  const s = await start();
  try {
    const res = await post(s.base, lead({ website: 'http://spam.example' }));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
    assert.equal(s.lines().length, 0);
    assert.equal(fs.existsSync(s.leadsFile), false);
  } finally { await s.stop(); }
});

test('неверные данные отклоняются с указанием поля и ничего не пишут', async () => {
  const s = await start();
  try {
    const cases = [
      [{ contact: '+7 900 000-00-00' }, 'contact', 'phone'],
      [{ contact: 'name@example.com' }, 'contact', 'placeholder'],
      [{ name: 'asdfgh' }, 'name', 'gibberish'],
      [{ company: 'http://spam.ru' }, 'company', 'chars'],
      [{ business: 'Что-то другое' }, 'business', 'unknown'],
      [{ consent: false }, 'consent', 'required'],
      [{ consent: 'true' }, 'consent', 'required'],
      [{ consent: undefined }, 'consent', 'required'],
      [{ locations: 0 }, 'locations', 'range'],
      [{ locations: 1000 }, 'locations', 'range'],
      [{ locations: 1.5 }, 'locations', 'range'],
      [{ name: ['Иван'] }, 'name', 'empty'],
      [{ contact: { a: 1 } }, 'contact', 'empty']
    ];
    for (const [extra, field, reason] of cases) {
      const res = await post(s.base, lead(extra));
      assert.equal(res.status, 422, JSON.stringify(extra));
      const answer = await res.json();
      assert.equal(answer.ok, false);
      assert.equal(answer.field, field, JSON.stringify(extra));
      assert.equal(answer.reason, reason, JSON.stringify(extra));
    }
    assert.equal(s.lines().length, 0);
  } finally { await s.stop(); }
});

test('не JSON, массив и слишком большое тело отклоняются', async () => {
  const s = await start();
  try {
    assert.equal((await post(s.base, 'это не json')).status, 400);
    assert.equal((await post(s.base, '[1,2,3]')).status, 400);
    assert.equal((await post(s.base, 'null')).status, 400);
    const big = await post(s.base, JSON.stringify(lead({ company: 'x'.repeat(20000) })));
    assert.equal(big.status, 413);
    assert.equal(s.lines().length, 0);
  } finally { await s.stop(); }
});

test('ограничение частоты: с одного адреса принимается не больше заданного числа заявок', async () => {
  const s = await start({ rateIp: 3 });
  try {
    for (let i = 0; i < 3; i++) assert.equal((await post(s.base, lead({ contact: `@person_${i}0000` }))).status, 200);
    const res = await post(s.base, lead({ contact: '@person_x0000' }));
    assert.equal(res.status, 429);
    assert.ok(res.headers.get('retry-after'));
    assert.equal(s.lines().length, 3);
  } finally { await s.stop(); }
});

test('ограничение частоты считает окно по часам и сбрасывается', async () => {
  let t = Date.UTC(2026, 9, 17, 12, 0, 0);
  const s = await start({ rateIp: 1, now: () => t });
  try {
    assert.equal((await post(s.base, lead({ contact: '@first_person' }))).status, 200);
    assert.equal((await post(s.base, lead({ contact: '@second_person' }))).status, 429);
    t += 11 * 60 * 1000;
    assert.equal((await post(s.base, lead({ contact: '@second_person' }))).status, 200);
  } finally { await s.stop(); }
});

test('за прокси адрес берётся из X-Forwarded-For, а без доверия к прокси заголовок игнорируется', async () => {
  const trusted = await start({ rateIp: 1, trustProxy: true });
  try {
    assert.equal((await post(trusted.base, lead({ contact: '@aaaa_person' }), { 'X-Forwarded-For': '1.1.1.1' })).status, 200);
    // подделанный левый адрес не помогает: считается правый, его дописал прокси
    assert.equal((await post(trusted.base, lead({ contact: '@bbbb_person' }), { 'X-Forwarded-For': '9.9.9.9, 1.1.1.1' })).status, 429);
    assert.equal((await post(trusted.base, lead({ contact: '@cccc_person' }), { 'X-Forwarded-For': '2.2.2.2' })).status, 200);
  } finally { await trusted.stop(); }

  const direct = await start({ rateIp: 1, trustProxy: false });
  try {
    assert.equal((await post(direct.base, lead({ contact: '@dddd_person' }), { 'X-Forwarded-For': '1.1.1.1' })).status, 200);
    assert.equal((await post(direct.base, lead({ contact: '@eeee_person' }), { 'X-Forwarded-For': '2.2.2.2' })).status, 429);
  } finally { await direct.stop(); }
});

test('одновременные заявки не перемешиваются: каждая строка — целый JSON', async () => {
  const s = await start({ rateIp: 100, rateGlobal: 100 });
  try {
    const answers = await Promise.all(Array.from({ length: 25 }, (_, i) => post(s.base, lead({ contact: `@client_${String(i).padStart(2, '0')}_ab` }))));
    assert.ok(answers.every((r) => r.status === 200));
    const rows = s.lines().map((l) => JSON.parse(l));
    assert.equal(rows.length, 25);
    assert.equal(new Set(rows.map((r) => r.contact)).size, 25);
  } finally { await s.stop(); }
});

test('если в файле нет последнего перевода строки, новая заявка не склеивается со старой', async () => {
  const s = await start();
  try {
    fs.writeFileSync(s.leadsFile, JSON.stringify({ id: 'old', contact: '@old_person', name: 'Старая' }), { mode: 0o600 }); // без \n
    assert.equal((await post(s.base, lead())).status, 200);
    const rows = s.lines().map((l) => JSON.parse(l));
    assert.equal(rows.length, 2);
    assert.equal(rows[0].id, 'old');
  } finally { await s.stop(); }
});

test('испорченная руками строка в файле не мешает приёму', async () => {
  const s = await start();
  try {
    fs.writeFileSync(s.leadsFile, 'тут что-то дописали руками\n' + JSON.stringify({ id: 'x', contact: '@dmitry_s' }) + '\n', { mode: 0o600 });
    const res = await post(s.base, lead({ contact: '@dmitry_s' }));
    assert.equal(res.status, 200);
    const rows = s.lines();
    assert.equal(rows.length, 3);
    assert.equal(JSON.parse(rows[2]).status, 'Повтор');
  } finally { await s.stop(); }
});

test('сайт раздаётся: главная, ресурсы и юридические страницы', async () => {
  const s = await start();
  try {
    for (const [url, type] of [
      ['/', 'text/html'], ['/index.html', 'text/html'], ['/assets/app.js', 'text/javascript'], ['/assets/styles.css', 'text/css'],
      ['/assets/validate.js', 'text/javascript'], ['/assets/img/ui-radar.webp', 'image/webp'],
      ['/legal/', 'text/html'], ['/legal/privacy.html', 'text/html'], ['/legal/consent.html', 'text/html']
    ]) {
      const res = await fetch(s.base + url);
      assert.equal(res.status, 200, url);
      assert.ok(res.headers.get('content-type').startsWith(type), `${url}: ${res.headers.get('content-type')}`);
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
      await res.arrayBuffer();
    }
    const head = await fetch(s.base + '/', { method: 'HEAD' });
    assert.equal(head.status, 200);
    const redirect = await fetch(s.base + '/legal', { redirect: 'manual' });
    assert.equal(redirect.status, 301);
    assert.equal(redirect.headers.get('location'), '/legal/');
    const health = await fetch(s.base + '/api/health');
    assert.deepEqual(await health.json(), { ok: true, service: 'lidradar-landing' });
  } finally { await s.stop(); }
});

test('файл заявок и служебные файлы по адресу сайта недоступны', async () => {
  // Копия структуры сайта во временном каталоге: файл заявок лежит там, где лежит по умолчанию, рядом с index.html
  const root = fs.mkdtempSync(path.join(TMP, 'site-'));
  for (const dir of ['assets', 'legal', '.git', 'tests']) fs.mkdirSync(path.join(root, dir));
  for (const file of ['index.html', 'server.mjs', 'README.md', '.gitignore', 'assets/app.js', 'legal/index.html', '.git/config', 'tests/a.test.mjs']) {
    fs.writeFileSync(path.join(root, file), 'содержимое ' + file);
  }
  const side = path.join(root, 'leads.jsonl');
  fs.writeFileSync(side, JSON.stringify({ name: 'секрет', contact: '@secret_person' }) + '\n', { mode: 0o600 });
  // Для проверки «..» без нормализации клиентом
  fs.writeFileSync(path.join(TMP, 'outside.txt'), 'секрет снаружи');

  const s = await start({ root, leadsFile: side });
  try {
    for (const url of ['/', '/index.html', '/assets/app.js', '/legal/']) assert.equal((await fetch(s.base + url)).status, 200, url);

    for (const url of [
      '/leads.jsonl', '/leads.JSONL', '/leads.jsonl/', '/server.mjs', '/README.md', '/.gitignore', '/.git/config', '/.git/HEAD',
      '/tests/a.test.mjs', '/assets', '/assets/', '/assets/.hidden', '/assets/../leads.jsonl', '/assets/%2e%2e/leads.jsonl',
      '/%2e%2e/leads.jsonl', '/assets%2f..%2fleads.jsonl', '/legal/..%2fleads.jsonl', '/assets\\..\\leads.jsonl',
      '/assets/%00', '/%', '/legal/%zz', '/assets/..%2f..%2foutside.txt', '/assets/%2e%2e/%2e%2e/outside.txt'
    ]) {
      const res = await fetch(s.base + url, { redirect: 'manual' });
      const text = await res.text();
      assert.ok([301, 400, 404].includes(res.status), `${url}: ${res.status}`);
      assert.ok(!text.includes('секрет') && !text.includes('содержимое server.mjs'), `${url}: отдал закрытый файл`);
    }

    // Сырой запрос с «..», который клиент не успел нормализовать
    const { default: net } = await import('node:net');
    for (const raw of ['/assets/../leads.jsonl', '/assets/../../outside.txt', '/legal/../server.mjs']) {
      const answer = await new Promise((resolve, reject) => {
        const sock = net.connect(Number(new URL(s.base).port), '127.0.0.1', () => sock.write(`GET ${raw} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`));
        let data = '';
        sock.on('data', (c) => { data += c; });
        sock.on('end', () => resolve(data));
        sock.on('error', reject);
      });
      assert.match(answer, /^HTTP\/1\.1 404/, raw);
      assert.ok(!answer.includes('секрет') && !answer.includes('содержимое server.mjs'), raw);
    }
  } finally {
    await s.stop();
  }
});

test('на сайт нельзя отправить POST/PUT/DELETE, кроме приёма заявок', async () => {
  const s = await start();
  try {
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const res = await fetch(s.base + '/', { method, body: method === 'DELETE' ? undefined : 'x' });
      assert.equal(res.status, 405, method);
    }
    const get = await fetch(s.base + '/api/lead');
    assert.equal(get.status, 405);
    assert.equal(get.headers.get('allow'), 'POST');
  } finally { await s.stop(); }
});

test('файл заявок нельзя положить туда, откуда сайт отдаёт файлы', () => {
  assert.throws(() => createLandingServer({ root: ROOT, leadsFile: path.join(ROOT, 'assets', 'leads.jsonl') }), /assets/);
  assert.throws(() => createLandingServer({ root: ROOT, leadsFile: path.join(ROOT, 'legal', 'x', 'leads.jsonl') }), /legal/);
  assert.throws(() => createLandingServer({ root: ROOT, leadsFile: path.join(ROOT, 'index.html') }), /файл сайта/);
});
