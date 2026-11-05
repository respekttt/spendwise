# Spendwise — трекер витрат

Вебінструмент для одного користувача: облік витрат за категоріями, ліміти на 30 днів і звіти. Вимоги — у [`spec.md`](spec.md), маршрути й формати — у [`specs/api-contract.md`](specs/api-contract.md), схема БД — у [`server/db/schema.sql`](server/db/schema.sql), стандарти й ADR — у [`standards/`](standards/).

Поточний стан: фундамент проєкту (сервер, БД, `GET /version`, перевірки). Бізнес-логіка витрат, категорій і звітів ще не реалізована.

## Вимоги

- [Bun](https://bun.sh) **1.4.4 або новіший** (зафіксовано в `package.json` → `engines`).
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

## Структура

```text
server/
  main.js          точка входу: env → createApp → listen
  app.js           фабрика createApp({ dbPath, now, version, logger })
  db/index.js      openDb(path): bun:sqlite, PRAGMA foreign_keys = ON, schema.sql
  db/schema.sql    схема БД
  core/time.js     kyivToday(now), addDays (ADR 003)
  routes/version.js  GET /version і визначення версії
public/            статичний UI
tests/             тести Bun
```
