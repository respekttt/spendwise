# Spendwise — трекер витрат

Вебінструмент для одного користувача: облік витрат за категоріями, ліміти на 30 днів і звіти. Вимоги — у [`spec.md`](spec.md), маршрути й формати — у [`specs/api-contract.md`](specs/api-contract.md), схема БД — у [`server/db/schema.sql`](server/db/schema.sql), стандарти й ADR — у [`standards/`](standards/).

Поточний стан: фундамент проєкту (сервер, БД, `GET /version`, перевірки). Бізнес-логіка витрат, категорій і звітів ще не реалізована.

## Вимоги

- [Bun](https://bun.sh) **1.4.4** (точна версія — `package.json` → `packageManager`; мінімальна — `engines.bun`).
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
| `DB_PATH` | `spendwise.db` | Шлях до файла SQLite (відносно поточної директорії). Файл створюється й ініціалізується під час старту; `*.db` не комітиться. |
| `GIT_SHA` | — | Значення для `GET /version`. Якщо не задано — `git rev-parse --short HEAD`, якщо й це недоступне — `unknown`. |

## Перевірки

| Команда | Що робить |
|---|---|
| `bun run check` | Biome: форматування й лінтер для JS/JSON/CSS у всьому проєкті. |
| `bun run check:staged` | Те саме лише для файлів з індексу Git (використовується в hook). |
| `bun test` | Усі тести з `tests/`. |
| `bun run smoke` | Лише smoke-тест (`tests/smoke.test.js`). |
| `bun run build` | Збірка `server/main.js` у `dist/` — перевірка, що імпорти розв'язуються. |
| `bun run ci` | Повна перевірка: Biome, усі тести, збірка. |

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
  main.js          точка входу: env, resolveVersion (GIT_SHA → git → unknown) → createApp → listen
  app.js           фабрика createApp({ dbPath, now, version, logger })
  errors.js        формат помилок: тексти, HttpError, setErrorHandler/setNotFoundHandler
  db/index.js      openDb(path): bun:sqlite, PRAGMA foreign_keys = ON, schema.sql
  db/schema.sql    схема БД
  core/time.js     kyivToday(now), addDays (ADR 003)
  routes/version.js  GET /version (лише віддає передане значення)
public/            статичний UI
tests/             тести Bun (errors.test.js — формат помилок за контрактом)
```

### Помилки API

Тіло будь-якої помилки — `{ "error": "<текст українською>" }` (контракт, «Загальні правила»). Маршрут, якому треба повернути `400` з описом поля або `404`, кидає `HttpError` з [`server/errors.js`](server/errors.js):

```js
import { HttpError } from '../errors.js';

throw new HttpError(400, 'amount: сума має бути більшою за 0');
throw new HttpError(404, 'Витрату не знайдено');
```

Текст `HttpError` віддається клієнту як є, тому він має бути публічним. Будь-яка інша помилка без коду `4xx` стає `500` «Внутрішня помилка сервера», а подробиці потрапляють лише в лог.
