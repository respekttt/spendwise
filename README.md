# Spendwise — трекер витрат

**Захист:** [Завдання 1 — DEFENSE.md](DEFENSE.md) · [Завдання 2 — DEFENSE-task2.md](DEFENSE-task2.md) · [Завдання 3 — DEFENSE-task3.md](DEFENSE-task3.md)

Вебінструмент для одного користувача: облік витрат за категоріями, ліміти на 30 днів і звіти. Вимоги — у [`spec.md`](spec.md), маршрути й формати — у [`specs/api-contract.md`](specs/api-contract.md), схема БД — у [`server/db/schema.sql`](server/db/schema.sql), стандарти й ADR — у [`standards/`](standards/).

Поточний стан: API витрат, категорій і звітів працює на SQLite (`bun:sqlite`); in-memory сховище лишається тестовим дублером, і ті самі HTTP-тести проходять на обох (ADR 007). UI ще не оновлено під API.

## Вимоги

- [Bun](https://bun.sh) **1.4.4** (точна версія — `package.json` → `packageManager`; мінімальна — `engines.bun`).
- [Node.js](https://nodejs.org) **22** (перевірено 22.20.0) — лише для `bun run mutation`: Stryker запускається в Node, тести однаково виконує `bun test` (ADR 011). Застосунку, тестам і CI Node не потрібен.
- Git — для `GET /version` і pre-commit hook.

## Встановлення

```bash
bun install
```

## Запуск

```bash
bun run start
# або
bun server/main.js
```

Сервер слухає `http://127.0.0.1:3000`. Перевірка: `curl http://127.0.0.1:3000/version`.

### Змінні оточення

| Змінна | За замовчуванням | Призначення |
|---|---|---|
| `PORT` | `3000` | Порт HTTP-сервера. |
| `HOST` | `127.0.0.1` | Адреса, на якій слухає сервер. |
| `DB_PATH` | див. нижче | Шлях до файла SQLite. Явно заданий шлях використовується як є: його каталог має існувати, інакше процес завершується з кодом 1 і порт не відкривається (AC 12). |
| `GIT_SHA` | — | Значення для `GET /version`. Якщо не задано — `git rev-parse --short HEAD`, якщо й це недоступне — `unknown`. |

### Де лежить БД

Без `DB_PATH` робоча БД лежить поза робочою папкою (ADR 008), щоб її не синхронізував OneDrive і не зачепив git; каталог створюється під час старту:

- Windows: `%LOCALAPPDATA%\spendwise\spendwise.db`;
- Linux і macOS: `${XDG_DATA_HOME:-~/.local/share}/spendwise/spendwise.db`.

Шлях пишеться в лог рядком `database opened`. Інший файл, наприклад окрема БД для гілки:

```bash
DB_PATH=./task2.db bun run start          # bash
$env:DB_PATH = 'C:\data\task2.db'; bun run start   # PowerShell
```

На старті сервер відкриває файл, виконує [`schema.sql`](server/db/schema.sql) (створює відсутні таблиці й «Інше»), перевіряє `PRAGMA foreign_keys = 1` і що «Інше» одна. Будь-яка помилка — рядок `fatal` `database unavailable` і код виходу 1 до `listen()`. Демо-даних робоча БД не отримує. БД, створена раніше як `spendwise.db` у робочій папці, сама не підхопиться: вкажіть її в `DB_PATH`.

Якщо інший процес тримає файл БД (наприклад, `sqlite3` CLI з відкритою транзакцією), сервер повторює операцію до 5 разів і віддає `503` з `Retry-After: 1` (ADR 010).

## Перевірки

| Команда | Що робить |
|---|---|
| `bun run check` | Biome: форматування й лінтер для JS/JSON/CSS у всьому проєкті. |
| `bun run check:staged` | Те саме лише для файлів з індексу Git (використовується в hook). |
| `bun test` | Усі тести з `tests/`. |
| `bun run test:unit` | Unit-тести `tests/unit/`: чисті функції `server/core/`. |
| `bun run test:integration` | Інтеграційні тести `tests/integration/`: `createApp`, сховища, SQLite. |
| `bun run test:e2e` | E2E-тести `tests/e2e/`: окремий процес `bun server/main.js` через HTTP. |
| `bun run test:all` (`make test`) | Unit, потім інтеграційні, потім E2E; зупиняється на першому рівні, що впав. |
| `bun run mutation` (`make mutation`) | Мутаційне тестування `server/core/` (StrykerJS, unit-тести на кожному мутанті); звіти — у `reports/mutation/`, поза git. **Потрібен Node 22** — лише для цієї команди. |
| `bun run smoke` | Лише smoke-тест (`tests/integration/smoke.test.js`). |
| `bun run build` | Збірка `server/main.js` у `dist/` — перевірка, що імпорти розв'язуються. |
| `bun run ci` | Повна перевірка: Biome, `test:all`, збірка. |

Рівні тестів і правила мутацій — [`specs/testing.md`](specs/testing.md), [ADR 011](standards/adr/011-testing-levels-and-mutation.md); результати мутацій — [`docs/mutation-report.md`](docs/mutation-report.md). `make` у Windows за замовчуванням немає — там ті самі команди через `bun run`.

Автоматичне виправлення форматування: `bun x biome check --write .`

## Pre-commit hook

Hook лежить у `.githooks/pre-commit` і запускає Biome (staged), smoke-тест, усі тести та збірку. Увімкнути його один раз після клонування:

```bash
git config core.hooksPath .githooks
```

Не обходьте hook через `git commit --no-verify` без задокументованої причини.

## CI

Workflow — [`.github/workflows/ci.yml`](.github/workflows/ci.yml) (GitHub Actions). Запускається на кожен `push` і `pull_request` на `ubuntu-latest`, з правами лише `contents: read`:

1. checkout репозиторію;
2. встановлення Bun через `oven-sh/setup-bun` — версія береться з `package.json` (`packageManager: "bun@1.4.4"`, та сама, що локально), окремо в workflow не дублюється;
3. `bun install --frozen-lockfile` — залежності строго за `bun.lock`;
4. `GIT_SHA=$(git rev-parse --short HEAD)` записується в `$GITHUB_ENV`, тож усі наступні кроки бачать цю змінну, і `GET /version` у тестах повертає саме її (див. «Змінні оточення»);
5. `bun run ci` — Biome, усі тести, збірка.

Локальний еквівалент — `bun run ci`. Результат видно на вкладці **Actions** репозиторію; завдання не Done, поки job не зелений для останнього коміту гілки.

### Кінці рядків

`.gitattributes` задає `* text=auto eol=lf`: у робочій копії всі текстові файли мають LF навіть на Windows з `core.autocrlf=true`. Інакше Biome (очікує LF) падає на чистому checkout у Windows, хоча в CI на Linux проходить. Якщо у старому клоні файли досі з CRLF, оновіть їх після pull: `git rm --cached -r -q . && git reset --hard` (втратите незакомічені зміни — спершу закомітьте їх).

## Структура

```text
.github/workflows/ci.yml  CI (GitHub Actions)
.githooks/pre-commit      pre-commit hook
server/
  main.js          точка входу: env, версія, відкриття й перевірка БД → createSqliteStore → createApp → listen
  app.js           фабрика createApp({ store, now, version, logger }); БД не відкриває
  errors.js        формат помилок: доменні помилки → HTTP-коди, setErrorHandler/setNotFoundHandler
  routes/          HTTP: схеми форми запиту, today, виклик сервісу
  services/        сценарії й межі транзакцій (withTransaction / withRead)
  core/            чисті правила: гроші, час, назви, валідація, звіти, доменні помилки
  repositories/
    logging.js     withLog і мапа RESULTS: рядок `db operation` для кожного методу (ADR 009)
    sqlite/        SQL за specs/db.md, переклад кодів SQLite у доменні помилки
    memory/        in-memory дублер з тими самими методами (тести)
  db/index.js      openDb(path, { busyTimeoutMs }), openCheckedDb — перевірка старту (ADR 008)
  db/transaction.js  BEGIN IMMEDIATE / DEFERRED, захист від async-функцій, ретраї на SQLITE_BUSY (ADR 010)
  db/schema.sql    схема БД
public/            статичний UI
tests/             тести Bun: unit/, integration/, e2e/, helpers/ (ADR 011)
```

### Помилки API

Тіло будь-якої помилки — `{ "error": "<текст українською>" }` (контракт, «Загальні правила»). Маршрут, якому треба повернути `400` з описом поля або `404`, кидає `HttpError` з [`server/errors.js`](server/errors.js):

```js
import { HttpError } from '../errors.js';

throw new HttpError(400, 'amount: сума має бути більшою за 0');
throw new HttpError(404, 'Витрату не знайдено');
```

Текст `HttpError` віддається клієнту як є, тому він має бути публічним. Будь-яка інша помилка без коду `4xx` стає `500` «Внутрішня помилка сервера», а подробиці потрапляють лише в лог.
