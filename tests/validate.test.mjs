/**
 * Проверка правил валидации формы: имя, компания, контакт (Telegram или email).
 * Запуск: node --test   (Node 20+)
 *
 * Те же правила (assets/validate.js) работают в браузере и в server.mjs, который принимает заявки.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

const ZW = String.fromCharCode(0x200b); // невидимый пробел нулевой ширины
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const VALIDATE_JS = read('../assets/validate.js');

function loadSite() {
  const ctx = vm.createContext({});
  vm.runInContext(VALIDATE_JS, ctx, { filename: 'validate.js' });
  return ctx.LidRadarValidate;
}
const implementations = { 'сайт (assets/validate.js)': loadSite() };

const NAMES_OK = [
  'Дмитрий', 'Дмитрий Соколов', 'Анна-Мария Петрова', 'Иван С.', 'Иван С. Петров', 'Ли', 'Ян', "O'Brien", 'D’Artagnan',
  'Мария', 'Артём', 'Эльдар', 'Ксения', 'Шпак', 'Мстислав', 'Вячеслав Крестьянинов', 'Жанна', 'Гюльнара', 'Ольга Н.',
  'Саша', 'Tim', 'Ким', 'Aleksandr Kisler', 'José García', 'Zoë Müller', 'Ёжик', 'Тест Тестов', 'Nguyễn Văn An',
  'Иванов Иван Иванович', 'Анна Ааронова', 'Gschwandtner', 'Schwarzkopf Hans', 'Пролог', 'Тамара', 'Лилия', 'Бобби', 'Мама', 'Zhang Wei',
];
const NAMES_BAD = {
  '': 'empty', ' ': 'empty', '   \n\t ': 'empty', 'а': 'short', 'я': 'short', '1': 'chars', '123': 'chars',
  'Иван123': 'chars', '!!!': 'chars', '...': 'chars', '----': 'chars', '<script>': 'chars', 'http://spam.ru': 'chars',
  'Иван_Петров': 'chars', 'Иван@mail.ru': 'chars', '=1+1': 'chars',
  asdfgh: 'gibberish', 'йцукен': 'gibberish', 'ффффф': 'gibberish', 'аааа': 'gibberish', qwerty: 'gibberish',
  'ывапролд': 'gibberish', Qwertyuiop: 'gibberish', asdasd: 'gibberish', 'лоллол': 'gibberish', 'ахахахах': 'gibberish',
  xxxxx: 'gibberish', 'ёёё': 'gibberish', 'жжж': 'gibberish', sdfsdf: 'gibberish', 'ртпрнкг': 'gibberish', 'ааа ааа': 'gibberish', test: 'gibberish',
  'Тест': 'gibberish', 'ничего': 'gibberish', 'нет': 'gibberish', 'Фывапр': 'gibberish', 'Бббббб': 'gibberish',
  ['x'.repeat(61)]: 'long',
};

const COMPANIES_OK = [
  'Студия «Блик»', 'ООО «Автосервис 24»', 'ИП Ким', 'Detailing Pro', 'Авто-Мойка №1', 'Студия на Тверской', 'Beauty & Style',
  'Wheel.ru', "Салон 'Роза'", 'Тамтам', 'Бонбон', 'Взгляд', 'Контрстрой', 'Dr. Auto', 'ГК ТСК Групп', 'Mr. X Garage', 'Кузов+',
  'Центр «Скорость» (Москва)', 'СТО 24/7', 'Хром 100%', 'Bio-Lab', 'ВАЗ 2101', 'Автомойка на Ленина 25', 'Кофе-Лавка',
  'ТехноПарк', 'NailBar', 'Проверка формы', 'Студия “Лотос”',
];
const COMPANIES_BAD = {
  '': 'empty', ' ': 'empty', 'а': 'short', '1': 'short', '123': 'short', '!!!': 'short', '----': 'short',
  '12345 12': 'short', 'http://spam.ru': 'chars', 'www.spam.ru': 'chars', '<b>x</b>': 'chars', '=1+1': 'chars',
  'Авто @mail': 'chars', 'Авто {1}': 'chars',
  'ООО': 'gibberish', 'ип': 'gibberish', test: 'gibberish', 'тест': 'gibberish', 'ничего': 'gibberish', company: 'gibberish',
  asdfgh: 'gibberish', 'йцукен': 'gibberish', 'ффффф': 'gibberish', 'ааа ааа': 'gibberish', 'ртпрнкгшл': 'gibberish',
  qwertyuiop: 'gibberish', 'лолололололо': 'gibberish', 'Авто 12345': 'gibberish',
  ['x'.repeat(101)]: 'long',
};

const CONTACTS_OK = {
  '@dmitry_s': '@dmitry_s', dmitry_s: '@dmitry_s', 't.me/dmitry_s': '@dmitry_s', 'https://t.me/dmitry_s': '@dmitry_s',
  'http://t.me/Dmitry_S/': '@Dmitry_S', 'telegram.me/dmitry_s': '@dmitry_s', '@Dmitry_S': '@Dmitry_S', 'https://t.me/dmitry_s?start=1': '@dmitry_s',
  ' @dmitry_s ': '@dmitry_s',
  'ivan.petrov@mail.ru': 'ivan.petrov@mail.ru', 'a_b+tag@gmail.com': 'a_b+tag@gmail.com', 'info@автосервис.рф': 'info@автосервис.рф',
  'user@sub.domain.co.uk': 'user@sub.domain.co.uk', 'x@y.io': 'x@y.io', 'IVAN@MAIL.RU': 'ivan@mail.ru',
};
const CONTACTS_BAD = {
  '': 'empty', ' ': 'empty', abc: 'format', '@abc': 'format', '+7 900 000-00-00': 'phone', '89001234567': 'phone',
  '8 (900) 123-45-67': 'phone', '@username': 'placeholder', username: 'placeholder', '@your_username': 'placeholder',
  '@test': 'format', 'name@example.com': 'placeholder', 'a@b': 'format', 'a@b.c': 'format', 'a..b@mail.ru': 'format',
  '.a@mail.ru': 'format', 'a.@mail.ru': 'format', 'a@mail..ru': 'format', 'a@-mail.ru': 'format', 'a@mail-.ru': 'format',
  '@@dmitry': 'format', 't.me/+abcdef': 'format', 't.me/joinchat/xyz': 'format', 'https://example.com': 'format',
  'ivan@': 'format', '@mail.ru': 'format', 'aaaaaaaa@mail.ru': 'placeholder', '@aaaaaaaa': 'placeholder',
  'a@b@c.ru': 'format', 'a@localhost': 'format', '<a@b.ru>': 'format',
};

for (const [label, V] of Object.entries(implementations)) {
  test(`имя: допустимые и недопустимые примеры (${label})`, () => {
    for (const v of NAMES_OK) {
      const r = V.checkName(v);
      assert.equal(r.ok, true, `должно пройти: «${v}»`);
      assert.equal(r.value, v.replace(/\s+/g, ' ').trim());
      assert.equal(r.kind, 'name');
    }
    for (const [v, reason] of Object.entries(NAMES_BAD)) {
      const r = V.checkName(v);
      assert.equal(r.ok, false, `должно отклоняться: «${v}»`);
      assert.equal(r.reason, reason, `причина для «${v}»`);
    }
  });

  test(`компания: допустимые и недопустимые примеры (${label})`, () => {
    for (const v of COMPANIES_OK) assert.equal(V.checkCompany(v).ok, true, `должно пройти: «${v}»`);
    for (const [v, reason] of Object.entries(COMPANIES_BAD)) {
      const r = V.checkCompany(v);
      assert.equal(r.ok, false, `должно отклоняться: «${v}»`);
      assert.equal(r.reason, reason, `причина для «${v}»`);
    }
  });

  test(`контакт: только Telegram или email, телефон не принимается (${label})`, () => {
    for (const [v, value] of Object.entries(CONTACTS_OK)) {
      const r = V.checkContact(v);
      assert.equal(r.ok, true, `должно пройти: «${v}»`);
      assert.equal(r.value, value, `нормализация «${v}»`);
      assert.equal(r.kind, v.includes('@') && !/^@?[A-Za-z0-9_]+$/.test(v.trim()) && !/t\.me|telegram\.me/i.test(v) ? 'email' : 'telegram');
    }
    for (const [v, reason] of Object.entries(CONTACTS_BAD)) {
      const r = V.checkContact(v);
      assert.equal(r.ok, false, `должно отклоняться: «${v}»`);
      assert.equal(r.reason, reason, `причина для «${v}»`);
    }
  });

  test(`невидимые и управляющие символы вычищаются (${label})`, () => {
    assert.equal(V.checkName('Иван' + ZW + '\n\tПетров').value, 'Иван Петров');
    assert.equal(V.checkCompany('  Студия\u0000   «Блик»  ').value, 'Студия «Блик»');
    assert.equal(V.checkContact('@dmitry' + ZW + '_s').value, '@dmitry_s');
  });
}
