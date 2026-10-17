/* LidRadar: проверка полей формы заявки.
   Один и тот же код работает на сайте (assets/app.js) и на сервере приёма заявок (server.mjs),
   поэтому заявку нельзя обойти прямым запросом. Примеры допустимых и недопустимых значений: tests/validate.test.mjs. */
(function (root) {
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

if (typeof module === 'object' && module.exports) module.exports = api;
else root.LidRadarValidate = api;
})(typeof self !== 'undefined' ? self : this);
