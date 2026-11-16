# LidRadar — лендинг R8

Статический HTML/CSS/JavaScript без сборки и зависимостей. Реализация утверждённого Founder 16.11.2026 R8: 12 секций, адаптивы 1440/834/390 и промежуточные ширины, локальный Inter, статичный светлый градиент. Основной CTA ведёт к форме демонстрации.

Источники: backend `docs/marketing/approvals/LANDING-R8-APPROVAL-2026-11-16.md`, `docs/marketing/briefs/LANDING-FRONTEND-IMPLEMENTATION-PLAN-2026-11-16.md` и `artifacts/marketing/landing-frontend-plan-2026-11-16/r1/APPROVED-COPY-R8.json`, `APPROVED-STATES-R8.json`. Figma: файл `jN8Hhzn6ObIAEi7FoY9kPu`, утверждённые frames `1999:5613/5614/5615`. Frozen PNG: соседний frontend `artifacts/frontend-v2/landing-design-2026-11-15/r8-marketing-copy/`.

## Локальный запуск и проверки

Нужен Node 20+; текущая проверка использует Node 24.19.0. Для проверки формы используйте отдельный временный файл заявок и согласованный свободный порт:

```sh
landing_qa_dir="$(mktemp -d "${TMPDIR:-/tmp}/lidradar-r8-qa.XXXXXX")"
LEADS_FILE="$landing_qa_dir/leads.jsonl" HOST=127.0.0.1 PORT=5180 node server.mjs
```

Откройте `http://127.0.0.1:5180`. В совместной работе порт назначает Lead. Статический сервер показывает страницу, но не принимает POST `/api/lead`.

```sh
node --test
node --test tests/slideshow.test.mjs tests/landing-ui.test.mjs tests/validate.test.mjs
node --check assets/app.js
node --check assets/slideshow.js
```

`slideshow.test.mjs` проверяет 7000 мс, цикл пяти сцен, согласованность изображения/заголовка/подписи, один таймер, скрытие/возврат вкладки и cleanup. `landing-ui.test.mjs` проверяет связь разметки с контролами формы, исходные business options, native FAQ, валидацию/select/focus, неоднозначный ответ, retry/id, отправку, honeypot и меню. Unit-проверки не заменяют browser/functional проверки и независимую визуальную приёмку.

## Структура и поведение R8

- `index.html`: landmarks, 12 секций, все 12 ответов FAQ, native details/summary, native select, меню и форма.
- `assets/styles.css`: токены R8, Inter через `@font-face`, адаптивные grid/flex, focus и состояния формы.
- `assets/app.js`: меню, интеграция автопоказа и общего валидатора, POST `/api/lead`.
- `assets/slideshow.js`: пять синхронных сцен, 7 секунд, без ручных контролов и анимации. При скрытии вкладки таймер останавливается; после возврата начинается новый интервал. В HTML есть полное статическое описание сценария для screen reader без live-объявлений смены сцены.
- `assets/fonts/InterVariable.woff2` и `LICENSE-Inter.txt`: локальный шрифт с лицензией. Брендовая иконка — точный локальный `assets/img/landing-r8/logo.svg`, остальные простые маркеры — CSS; внешних Google Fonts и Material Symbols нет.

Форма сохраняет поля/обязательность, общий `assets/validate.js`, четыре business options и honeypot. Во время запроса поля и отправка блокируются. Успех требует HTTP success и JSON `{ok:true}`; сеть, таймаут 20 секунд, неожиданный JSON и HTTP ошибки оставляют ввод и предлагают повтор. Неизменённая заявка повторяется с тем же id; изменение поля создаёт новую попытку. Пять состояний: исходное, ошибки полей, отправка, ошибка/повтор и успех по принятой копии.

## Учебные изображения

`assets/img/landing-r8/phone-scene-{1..5}@2x.png` — пять утверждённых iPhone 15 сцен. PNG включает корпус и боковые клавиши: 872×1782, body 432×891, render bounds 436×891. CSS сохраняет body 342×705.375 и выступ клавиш на 1.5833 px с каждой стороны. Первый кадр доступен сразу, остальные декодируются до показа.

`trust-{desktop,tablet,mobile}-{telegram,risk}@2x.png` — утверждённые фрагменты для трёх ширин. На desktop/tablet они рядом, на mobile последовательно. Ниже первого экрана используется lazy loading. Подписи сохраняют учебный характер и AI-оговорки. Старые `ui-*.webp` в R8 не используются. Учебные изображения не доказывают клиентские результаты; элементы интерфейса внутри них не являются контролами сайта.

Изменение принятой копии, композиции, поведения, API или юридических документов требует отдельного поручения. Визуальные результаты, APCA, browser matrix, layout shifts и реальные размеры страницы фиксируются Lead/QA на замороженном snapshot; README не заявляет их PASS. Push/merge/deploy выполняются по отдельному поручению; production требует отдельного разрешения владельца.

## Приём заявок

Форма отправляет заявку на `/api/lead`. `server.mjs` проверяет поля теми же правилами, что и браузер (`assets/validate.js`), и дописывает одну строку JSON в файл **`leads.jsonl` рядом с `index.html`**. Файл создаётся при первой заявке с правами `600`, лежит в `.gitignore` и в репозиторий не попадает.

**Файл не отдаётся по адресу сайта.** Сервер отвечает 404 на всё, кроме `index.html`, `assets/` и `legal/`, поэтому `leads.jsonl`, `server.mjs`, `README.md` и `.git` снаружи недоступны. Это важно: в файле персональные данные. Если перед сервером стоит nginx или Caddy, проксируйте на `server.mjs` весь сайт (пример ниже), а не раздавайте каталог напрямую.

Строка заявки:

```json
{
  "date": "2026-10-17 14:34:14",
  "receivedAt": "2026-10-17T11:34:14.904Z",
  "id": "6c1f…",
  "name": "Дмитрий Соколов",
  "company": "Студия «Блик»",
  "business": "Автосервис",
  "contact": "@dmitry_s",
  "locations": 3,
  "source": "yandex / cpc",
  "status": "Новая",
  "consent": true,
  "consentDoc": "sha256:8fa85f82d4a3"
}
```

`date` — московское время, `receivedAt` — UTC. `status`: «Новая» или «Повтор» (тот же контакт уже оставлял заявку). `source` — метки рекламы или сайт-источник, иначе «прямой заход». `consentDoc` — отпечаток текста `legal/consent.html`, который видел посетитель: по нему видно, на какую редакцию согласия он согласился (меняется при любой правке этой страницы). IP-адрес и User-Agent не сохраняются, в журнал сервера имя и контакт не попадают.

Читать на сервере:

```bash
tail -f leads.jsonl                       # новые заявки по мере поступления
wc -l leads.jsonl                         # сколько всего
jq -r '[.date,.name,.company,.business,.contact,(.locations//""),.source,.status]|@tsv' leads.jsonl   # таблицей
```

Файл можно править руками: сервер переживает пропавший перевод строки в конце и испорченные строки.

**Защита от мусора:** поле-ловушка для ботов, повторная отправка той же заявки не создаёт вторую строку, не больше 5 заявок с одного адреса и 30 со всего сайта за 10 минут, тело запроса до 8 КБ.

**Настройки** (переменные окружения): `PORT` (5180), `HOST` (127.0.0.1; `0.0.0.0` открывает порт наружу), `LEADS_FILE` (другой путь к файлу; внутри `assets/` и `legal/` нельзя), `TRUST_PROXY=1` (за nginx или Caddy: адрес посетителя для лимита берётся из `X-Forwarded-For`).

**Production (Docker).** В боевом стеке лендинг запускается контейнером `landing` рядом с приложением, за общим Caddy на своём домене (`lid-radar.online`). `Dockerfile` кладёт в образ только `server.mjs`, `index.html`, `assets/` и `legal/` (`.dockerignore` не пускает туда `leads.jsonl`, тесты и `.git`), заявки пишутся в том `/data/leads.jsonl`. Образ собирает `scripts/build-landing-image.sh` из репозитория бэкенда (`--landing-dir` с путём к этому каталогу): тег образа — первые 12 символов git sha этого репозитория, собирать можно только из закоммиченного дерева. Развёртывание, чтение заявок, копии и очистка по сроку — `Lidradar/docs/runbooks/vps-spaceweb-deployment.md`. Примеры ниже (systemd, nginx) нужны, если запускать без Docker.

Пример для systemd (`/etc/systemd/system/lidradar-landing.service`):

```ini
[Unit]
Description=LidRadar landing
After=network.target

[Service]
WorkingDirectory=/srv/lidradar-landing
ExecStart=/usr/bin/node server.mjs
Environment=PORT=5180 HOST=127.0.0.1 TRUST_PROXY=1
User=lidradar
Restart=on-failure
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

Пример для nginx (весь сайт идёт через `server.mjs`):

```nginx
location / {
    proxy_pass http://127.0.0.1:5180;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    client_max_body_size 16k;
}
```

**Что нужно делать с файлом, раз он ваш:**

- Хранить не дольше 12 месяцев (так обещает политика сайта). Оставить свежие: `jq -c 'select(.receivedAt > "2026-01-01")' leads.jsonl > leads.new && mv leads.new leads.jsonl` (подставьте дату на год назад, сделайте копию перед правкой, на время замены лучше остановить сервер).
- Отзыв согласия: удалить строки человека в течение 30 дней, например `jq -c 'select(.contact != "@name")' leads.jsonl > leads.new && mv leads.new leads.jsonl`.
- Резервные копии файла содержат персональные данные: хранить на территории РФ и под тот же срок.
- Журналы веб-сервера (nginx, journald) хранить не дольше 30 дней, как сказано в политике сайта.
- Сервер должен находиться в РФ (часть 5 статьи 18 152-ФЗ), провайдера записать в `docs/legal/requisites.json` репозитория backend.

## Юридические страницы

Пользовательское соглашение, политика конфиденциальности и согласие на обработку данных лежат в `legal/` (`terms.html`, `privacy.html`, `consent.html`, `index.html`). Это **сгенерированные файлы**: руками их не правят. Источник — Markdown в `docs/legal/landing/` репозитория backend (`Lidradar`) и реквизиты в `docs/legal/requisites.json`. Пересборка из каталога backend:

```bash
node scripts/build-legal.mjs --app <каталог веб-клиента> --landing <каталог этого лендинга>
```

Ссылки на них стоят у чекбокса согласия в форме и в футере. Подробности, список действий перед публикацией и правила изменения: `docs/legal/README.md` в репозитории backend.
