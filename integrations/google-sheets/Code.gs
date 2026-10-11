/**
 * @OnlyCurrentDoc
 *
 * LidRadar: приём заявок на бета-тест в Google Таблицу.
 * (Строка @OnlyCurrentDoc выше ограничивает доступ скрипта только этой таблицей, а не всеми вашими файлами.)
 *
 * Скрипт вставляется в саму таблицу (Расширения → Apps Script), публикуется как веб-приложение,
 * а его адрес (оканчивается на /exec) записывается в FORM_ENDPOINT в assets/app.js.
 * Пошаговая инструкция: README.md рядом с этим файлом.
 *
 * Что делает doPost:
 *  - принимает JSON с формы лендинга (его присылает assets/app.js);
 *  - проверяет поля теми же правилами, что и сайт (имя и компания без белиберды, контакт только Telegram или email),
 *    согласие, отсекает ботов (поле-ловушка), повторную отправку той же заявки и поток мусора;
 *  - дописывает строку в лист «Заявки» (дата, имя, компания, чем занимается, контакт, точек, источник, согласие,
 *    статус, заметки);
 *  - при заданном NOTIFY_EMAIL отправляет вам письмо о новой заявке.
 * Таблицу при этом никто не читает: doGet отвечает только «сервис работает».
 */

var CONFIG = {
  // Лист, куда пишутся заявки. Если его нет, setup() создаст.
  SHEET_NAME: 'Заявки',
  // Куда присылать письмо о каждой новой заявке. Пусто = писем нет, заявки видны только в таблице.
  // Адрес вписывается здесь, в редакторе Apps Script, а не в копии файла на сайте.
  NOTIFY_EMAIL: '',
  // Часовой пояс для письма. В самой таблице время показывается по её настройкам (Файл → Настройки).
  TIMEZONE: 'Europe/Moscow',
  // Не больше стольких заявок за окно RATE_WINDOW_SEC. Защита, если кто-то зальёт форму мусором напрямую.
  RATE_LIMIT: 30,
  RATE_WINDOW_SEC: 600,
  // Сколько последних строк проверять, чтобы пометить повтор того же контакта.
  DUPLICATE_SCAN_ROWS: 500,
  // Варианты «Чем занимаетесь» из формы на сайте. Добавили вариант на сайте: добавьте и сюда.
  BUSINESS_TYPES: ['Автосервис', 'Детейлинг', 'Салон красоты', 'Другое']
};

var COLUMNS = [
  { key: 'date', title: 'Дата', width: 140, format: 'dd.MM.yyyy HH:mm' },
  { key: 'name', title: 'Имя', width: 170, format: '@' },
  { key: 'company', title: 'Компания', width: 210, format: '@' },
  { key: 'business', title: 'Чем занимается', width: 140, format: '@' },
  { key: 'contact', title: 'Telegram или email', width: 200, format: '@' },
  { key: 'locations', title: 'Точек', width: 70, format: '0' },
  { key: 'source', title: 'Источник', width: 170, format: '@' },
  { key: 'consent', title: 'Согласие на обработку', width: 150, format: '@' },
  { key: 'status', title: 'Статус', width: 130, format: '@' },
  { key: 'notes', title: 'Заметки', width: 280, format: '@' }
];
var COL = { contact: 5, status: 9 };
var STATUSES = ['Новая', 'Повтор', 'Связались', 'В бета-тесте', 'Не подошло'];

/* Правила проверки имени, компании и контакта. Это копия assets/validate.js:
   править её здесь не нужно, обновляется командой node integrations/google-sheets/sync-validate.mjs. */
var LidRadarValidate = (function () {
/* BEGIN validate-core */
var UNICODE = (function () {
  try { new RegExp('\\p{L}', 'u'); return true; } catch (err) { return false; }
})();
// Буквы любого алфавита. В старых браузерах без \p{L}: латиница, кириллица и латиница с диакритикой.
var L = UNICODE ? '\\p{L}\\p{M}' : 'A-Za-z\\u00C0-\\u024F\\u0400-\\u04FF';
var N = UNICODE ? '\\p{N}' : '0-9';
function rx(source, flags) { return new RegExp(source, (flags || '') + (UNICODE ? 'u' : '')); }

var KEY_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm', 'йцукенгшщзхъ', 'фывапролджэ', 'ячсмитьбю', '1234567890'];
var VOWELS = 'aeiouyаеёиоуыэюяіїє';
var CONSONANTS_7 = /[bcdfghjklmnpqrstvwxzбвгджзйклмнпрстфхцчшщ]{7,}/;
// Пустые «заглушки», которые вписывают, лишь бы отправить форму. Сравнивается вся строка из одних букв.
var PLACEHOLDERS = {
  test: 1, 'тест': 1, testing: 1, 'тестовый': 1, 'тестовая': 1, asd: 1, asdf: 1, qwe: 1, qwerty: 1, abc: 1, abcd: 1,
  xxx: 1, aaa: 1, zzz: 1, none: 1, 'нет': 1, 'нету': 1, 'ничего': 1, 'фыв': 1, 'фыва': 1, 'йцу': 1, 'йцукен': 1,
  'ячс': 1, 'ааа': 1, 'ббб': 1, 'ввв': 1, 'ыыы': 1, 'ххх': 1, 'лол': 1, name: 1, 'имя': 1, noname: 1, company: 1,
  'компания': 1, 'моякомпания': 1, 'безназвания': 1, 'безимени': 1, 'неизвестно': 1, na: 1, 'null': 1, undefined: 1,
  admin: 1, user: 1
};
// Одна правовая форма без названия («ООО», «ИП») не название компании
var LEGAL_ONLY = { 'ооо': 1, 'ип': 1, 'ао': 1, 'зао': 1, 'пао': 1, 'оао': 1, 'нко': 1, 'чп': 1, 'тсж': 1, ooo: 1, ip: 1 };
var TELEGRAM_PLACEHOLDERS = {
  username: 1, yourusername: 1, your_username: 1, telegram: 1, test: 1, example: 1, nickname: 1, nick: 1, tgusername: 1
};

function has(map, key) { return Object.prototype.hasOwnProperty.call(map, key); }
function fail(reason) { return { ok: false, reason: reason }; }
function pass(value, kind) { return { ok: true, value: value, kind: kind }; }

// Невидимые и управляющие символы: управляющие ASCII, нулевая ширина, разделители строк, BOM
var INVISIBLE = new RegExp('[\\u0000-\\u001f\\u007f\\u200b-\\u200f\\u2028\\u2029\\ufeff]+', 'g');

// Пробелы и переводы строк сводятся к одному пробелу, невидимые и управляющие символы убираются
function clean(value) {
  var text = value === null || value === undefined ? '' : String(value);
  return text.replace(INVISIBLE, ' ').replace(/\s+/g, ' ').trim();
}

function lettersOf(text) { return text.match(rx('[' + L + ']', 'g')) || []; }

// Подряд идущие клавиши одного ряда клавиатуры, вперёд или назад: «йцукен», «asdfg», «54321»
function keyboardRun(token, min) {
  for (var r = 0; r < KEY_ROWS.length; r++) {
    var row = KEY_ROWS[r];
    var back = row.split('').reverse().join('');
    for (var i = 0; i + min <= token.length; i++) {
      var part = token.substr(i, min);
      if (row.indexOf(part) !== -1 || back.indexOf(part) !== -1) return true;
    }
  }
  return false;
}

// Повторы: «аааа», «asdasd», «лолололо». Для имени правило строже, для названия компании мягче («Бонбон», «Тамтам»).
// Слитая строка из нескольких слов (acrossWords) проверяется мягче: на стыке слов буквы могут совпасть случайно.
function repeats(text, strict, acrossWords) {
  if (strict && !acrossWords ? /(.)\1{2,}/.test(text) : /(.)\1{3,}/.test(text)) return true;
  return strict ? /(.{3})\1/.test(text) || /(.{2})\1{2}/.test(text) : /(.{2,3})\1{3}/.test(text);
}

function randomToken(token, strict) {
  if (repeats(token, strict, false)) return true;
  if (token.length >= 5 && keyboardRun(token, 5)) return true;
  var onlyLetters = token.replace(/[^a-zа-яёіїє]/g, '');
  if (onlyLetters.length >= 5 && onlyLetters.length === token.length) {
    var vowel = false;
    for (var i = 0; i < onlyLetters.length; i++) if (VOWELS.indexOf(onlyLetters.charAt(i)) !== -1) vowel = true;
    if (!vowel) return true;
  }
  return CONSONANTS_7.test(token);
}

// «Белиберда»: набор клавиш, повторы, слова без гласных, заглушки вроде «test»
function looksRandom(text, strict) {
  var lower = text.toLowerCase();
  var joined = lower.replace(rx('[^' + L + N + ']', 'g'), '');
  if (has(PLACEHOLDERS, joined)) return true;
  if (repeats(joined, strict, true)) return true;
  var tokens = lower.split(rx('[^' + L + N + ']+'));
  for (var i = 0; i < tokens.length; i++) {
    if (tokens[i] && randomToken(tokens[i], strict)) return true;
  }
  return false;
}

// Имя: только буквы, пробел, дефис, апостроф и точка в инициалах; не меньше двух букв; без белиберды
function checkName(raw) {
  var v = clean(raw);
  if (!v) return fail('empty');
  if (v.length > 60) return fail('long');
  if (!rx('^[' + L + ']+(?:(?:\\. |[ \'’\\-])[' + L + ']+)*\\.?$').test(v)) return fail('chars');
  if (lettersOf(v).length < 2) return fail('short');
  if (looksRandom(v, true)) return fail('gibberish');
  return pass(v, 'name');
}

// Название компании: буквы, цифры и обычная пунктуация («ООО «Авто-24»», «Beauty & Style»); без ссылок и спецсимволов
function checkCompany(raw) {
  var v = clean(raw);
  if (!v) return fail('empty');
  if (v.length > 100) return fail('long');
  if (/https?:|www\.|:\/\//i.test(v)) return fail('chars');
  if (!rx('^[' + L + N + ' .,&()«»"\'’“”/+\\-–—#№:;!?%]+$').test(v)) return fail('chars');
  if (lettersOf(v).length < 2) return fail('short');
  if (has(LEGAL_ONLY, v.toLowerCase().replace(rx('[^' + L + ']', 'g'), ''))) return fail('gibberish');
  if (looksRandom(v, false)) return fail('gibberish');
  return pass(v, 'company');
}

// Telegram: @name, name, t.me/name, https://t.me/name. От 5 до 32 символов, первая буква латинская.
function parseTelegram(v) {
  var s = v.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  if (/^(?:t|telegram)\.me\//i.test(s)) s = s.replace(/^(?:t|telegram)\.me\//i, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
  s = s.replace(/^@/, '');
  return /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(s) ? s : null;
}

// Email: стандартная форма локальная_часть@домен.зона. Допустимы кириллические домены (.рф), длина до 254.
var EMAIL_LOCAL = /^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+$/;
var EMAIL_DOMAIN = /^(?:[A-Za-z0-9Ѐ-ӿ](?:[A-Za-z0-9Ѐ-ӿ-]{0,61}[A-Za-z0-9Ѐ-ӿ])?\.)+[A-Za-zЀ-ӿ]{2,24}$/;
var EXAMPLE_DOMAIN = /^(?:example\.(?:com|org|net)|test\.(?:com|ru)|localhost)$/i;

function isEmail(v) {
  if (v.length > 254) return false;
  var at = v.lastIndexOf('@');
  if (at < 1) return false;
  var local = v.slice(0, at);
  var domain = v.slice(at + 1);
  if (local.length > 64 || !EMAIL_LOCAL.test(local)) return false;
  if (local.charAt(0) === '.' || local.charAt(local.length - 1) === '.' || local.indexOf('..') !== -1) return false;
  return EMAIL_DOMAIN.test(domain);
}

// Контакт: Telegram или email. Телефон не принимается.
function checkContact(raw) {
  var v = clean(raw).replace(/\s+/g, '');
  if (!v) return fail('empty');
  if (v.length > 254) return fail('long');

  var tg = parseTelegram(v);
  if (tg) {
    var low = tg.toLowerCase();
    if (has(TELEGRAM_PLACEHOLDERS, low) || /(.)\1{5,}/.test(low)) return fail('placeholder');
    return pass('@' + tg, 'telegram');
  }
  if (isEmail(v)) {
    var mail = v.toLowerCase();
    if (EXAMPLE_DOMAIN.test(mail.slice(mail.lastIndexOf('@') + 1)) || /(.)\1{5,}/.test(mail.slice(0, mail.lastIndexOf('@')))) {
      return fail('placeholder');
    }
    return pass(mail, 'email');
  }
  if (/^[\d()+\-.]{7,}$/.test(v) && v.replace(/\D/g, '').length >= 7) return fail('phone');
  return fail('format');
}

var api = { clean: clean, checkName: checkName, checkCompany: checkCompany, checkContact: checkContact };
/* END validate-core */
  return api;
})();

/* ---------- Веб-приложение ---------- */

function doPost(e) {
  var lock = LockService.getScriptLock();
  var locked = false;
  try {
    var body = parseBody_(e);
    if (!body) return json_({ ok: false, error: 'bad_request' });

    // Поле-ловушка для ботов: человек его не видит и не заполняет. Отвечаем «ок», но ничего не пишем.
    if (clean_(body.website, 200)) return json_({ ok: true });

    var lead = normalize_(body);
    // field и reason подсказывают, какое поле не прошло проверку (сайт проверяет теми же правилами, так что это для отладки)
    if (lead.error) return json_({ ok: false, error: 'invalid', field: lead.error, reason: lead.reason || '' });

    locked = lock.tryLock(15000);
    if (!locked) return json_({ ok: false, error: 'busy' });

    var cache = CacheService.getScriptCache();
    // Та же заявка пришла второй раз (двойной клик, повтор после обрыва связи): строку не дублируем.
    if (lead.id && cache.get('lead:' + lead.id)) return json_({ ok: true, duplicate: true });
    if (!underRateLimit_(cache)) return json_({ ok: false, error: 'rate' });

    var sheet = getSheet_();
    var status = isRepeat_(sheet, lead.contactKey) ? 'Повтор' : 'Новая';
    appendLead_(sheet, lead, status);
    if (lead.id) cache.put('lead:' + lead.id, '1', 21600);

    notify_(lead, status);
    return json_({ ok: true });
  } catch (err) {
    console.error('doPost: ' + (err && err.stack ? err.stack : err));
    return json_({ ok: false, error: 'server' });
  } finally {
    if (locked) lock.releaseLock();
  }
}

/** Проверка из браузера: открываете адрес /exec и видите, что сервис отвечает. Данные таблицы не отдаются. */
function doGet() {
  return json_({ ok: true, service: 'lidradar-beta-signups' });
}

/* ---------- Запуск вручную из редактора ---------- */

/** Один раз: создаёт лист «Заявки» с заголовками и просит доступ к таблице. */
function setup() {
  var sheet = prepareSheet_(openSpreadsheet_());
  console.log('Готово. Лист «' + sheet.getName() + '» подготовлен.');
}

/** Добавляет в таблицу тестовую заявку (потом строку можно удалить). Проверка до публикации. */
function sendTestLead() {
  var result = doPost({
    postData: {
      contents: JSON.stringify({
        id: 'test-' + Date.now(),
        name: 'Тест Тестов',
        company: 'Проверка формы',
        business: 'Другое',
        contact: '@lidradar_test',
        locations: 1,
        consent: true,
        source: 'landing',
        utm: 'тест / редактор'
      })
    }
  });
  console.log(result.getContent());
}

/* ---------- Внутреннее ---------- */

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function parseBody_(e) {
  if (!e) return null;
  if (e.postData && e.postData.contents) {
    try {
      var parsed = JSON.parse(e.postData.contents);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (err) {
      // Не JSON: возможно, обычная форма. Смотрим параметры ниже.
    }
  }
  if (e.parameter && Object.keys(e.parameter).length) return e.parameter;
  return null;
}

/** Убирает управляющие символы и переводы строк, обрезает длину. */
function clean_(value, max) {
  var text = value === null || value === undefined ? '' : String(value);
  return text.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max || 200);
}

/** Проверяет и приводит заявку к единому виду. При ошибке возвращает { error: поле, reason: причина }. */
function normalize_(b) {
  var V = LidRadarValidate;
  var name = V.checkName(b.name);
  if (!name.ok) return { error: 'name', reason: name.reason };
  var company = V.checkCompany(b.company);
  if (!company.ok) return { error: 'company', reason: company.reason };
  var contact = V.checkContact(b.contact);
  if (!contact.ok) return { error: 'contact', reason: contact.reason };

  var business = clean_(b.business, 60);
  if (CONFIG.BUSINESS_TYPES.indexOf(business) === -1) return { error: 'business', reason: 'unknown' };
  var consent = b.consent === true || b.consent === 'true' || b.consent === 'on';
  if (!consent) return { error: 'consent', reason: 'required' };

  var locations = null;
  var rawLocations = b.locations === null || b.locations === undefined ? '' : String(b.locations).trim();
  if (rawLocations !== '') {
    var n = Number(rawLocations);
    if (!isFinite(n) || Math.floor(n) !== n || n < 1 || n > 999) return { error: 'locations', reason: 'range' };
    locations = n;
  }
  return {
    id: clean_(b.id, 64),
    name: name.value,
    company: company.value,
    business: business,
    contact: contact.value,
    contactKey: contactKey_(contact.value),
    locations: locations,
    source: clean_(b.utm, 120) || clean_(b.referrer, 120) || 'прямой заход'
  };
}

/** Один и тот же контакт в разной записи: «@Name», «t.me/name» и «name» совпадают, email без учёта регистра. */
function contactKey_(contact) {
  var checked = LidRadarValidate.checkContact(contact);
  // Старые строки (например, с телефоном) проверку не проходят: для них ключом остаётся сам текст
  var text = checked.ok ? checked.value : clean_(contact, 254);
  return text.toLowerCase().replace(/^@/, '');
}

/** Окно фиксированной длины: счётчик живёт ровно RATE_WINDOW_SEC и не продлевается новыми заявками. */
function underRateLimit_(cache) {
  var key = 'rate:' + Math.floor(Date.now() / (CONFIG.RATE_WINDOW_SEC * 1000));
  var count = Number(cache.get(key) || 0);
  if (count >= CONFIG.RATE_LIMIT) return false;
  cache.put(key, String(count + 1), CONFIG.RATE_WINDOW_SEC);
  return true;
}

function openSpreadsheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Скрипт не привязан к таблице. Создайте его через Расширения → Apps Script внутри таблицы.');
  return ss;
}

function getSheet_() {
  var ss = openSpreadsheet_();
  return ss.getSheetByName(CONFIG.SHEET_NAME) || prepareSheet_(ss);
}

/** Создаёт лист (или переименовывает пустой «Лист1»), заголовки, форматы столбцов и список статусов. */
function prepareSheet_(ss) {
  var sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) {
    var sheets = ss.getSheets();
    if (sheets.length === 1 && sheets[0].getLastRow() === 0) {
      sheet = sheets[0];
      sheet.setName(CONFIG.SHEET_NAME);
    } else {
      sheet = ss.insertSheet(CONFIG.SHEET_NAME);
    }
  }
  var header = sheet.getRange(1, 1, 1, COLUMNS.length);
  header.setValues([COLUMNS.map(function (c) { return c.title; })]);
  header.setFontWeight('bold').setFontColor('#ffffff').setBackground('#5640d8').setVerticalAlignment('middle');
  sheet.setFrozenRows(1);

  var rows = Math.max(sheet.getMaxRows() - 1, 1);
  COLUMNS.forEach(function (c, i) {
    sheet.setColumnWidth(i + 1, c.width);
    // Текстовый формат: имя, компания и контакт остаются текстом, а не вычисляются как формулы или числа.
    sheet.getRange(2, i + 1, rows, 1).setNumberFormat(c.format);
  });
  var rule = SpreadsheetApp.newDataValidation().requireValueInList(STATUSES, true).setAllowInvalid(true).build();
  sheet.getRange(2, COL.status, rows, 1).setDataValidation(rule);
  return sheet;
}

/** Значение, которое таблица могла бы принять за формулу, помечаем апострофом. */
function safe_(text) {
  return /^=/.test(text) ? "'" + text : text;
}

function isRepeat_(sheet, key) {
  var last = sheet.getLastRow();
  if (last < 2 || !key) return false;
  var from = Math.max(2, last - CONFIG.DUPLICATE_SCAN_ROWS + 1);
  var values = sheet.getRange(from, COL.contact, last - from + 1, 1).getValues();
  for (var i = 0; i < values.length; i++) {
    if (contactKey_(values[i][0]) === key) return true;
  }
  return false;
}

function appendLead_(sheet, lead, status) {
  var row = sheet.getLastRow() + 1;
  // В новой таблице 1000 строк: когда они кончатся, добавляем ещё, иначе запись упадёт.
  if (row > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 500);
  var range = sheet.getRange(row, 1, 1, COLUMNS.length);
  range.setNumberFormats([COLUMNS.map(function (c) { return c.format; })]);
  range.setValues([[
    new Date(),
    safe_(lead.name),
    safe_(lead.company),
    safe_(lead.business),
    safe_(lead.contact),
    lead.locations === null ? '' : lead.locations,
    safe_(lead.source),
    'Да',
    status,
    ''
  ]]);
}

function notify_(lead, status) {
  if (!CONFIG.NOTIFY_EMAIL) return;
  try {
    var now = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'dd.MM.yyyy HH:mm');
    var url = '';
    try { url = openSpreadsheet_().getUrl(); } catch (ignore) { /* ссылка в письме необязательна */ }
    MailApp.sendEmail({
      to: CONFIG.NOTIFY_EMAIL,
      subject: 'Заявка на бета-тест LidRadar: ' + lead.company,
      body: [
        'Новая заявка (' + now + (status === 'Повтор' ? ', повторный контакт' : '') + ')',
        '',
        'Имя: ' + lead.name,
        'Компания: ' + lead.company,
        'Чем занимается: ' + lead.business,
        'Контакт: ' + lead.contact,
        'Точек: ' + (lead.locations === null ? 'не указано' : lead.locations),
        'Источник: ' + lead.source,
        '',
        url ? 'Таблица: ' + url : ''
      ].join('\n')
    });
  } catch (err) {
    // Письмо не должно ломать запись заявки.
    console.error('notify: ' + err);
  }
}
