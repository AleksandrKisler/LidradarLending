/**
 * Копирует блок validate-core из assets/validate.js в Code.gs, чтобы правила на сайте и в скрипте Google совпадали.
 * Запуск после любой правки правил: node integrations/google-sheets/sync-validate.mjs
 * (validate.test.mjs падает, если блоки разошлись).
 */
import fs from 'node:fs';

const validate = fs.readFileSync(new URL('../../assets/validate.js', import.meta.url), 'utf8');
const codeUrl = new URL('./Code.gs', import.meta.url);
const code = fs.readFileSync(codeUrl, 'utf8');
const block = /\/\* BEGIN validate-core \*\/[\s\S]*?\/\* END validate-core \*\//;

if (!block.test(validate)) throw new Error('В assets/validate.js нет блока validate-core');
if (!block.test(code)) throw new Error('В Code.gs нет маркеров validate-core');
fs.writeFileSync(codeUrl, code.replace(block, () => validate.match(block)[0]));
console.log('Code.gs: блок validate-core обновлён из assets/validate.js');
