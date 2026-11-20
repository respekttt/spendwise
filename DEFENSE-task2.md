# DEFENSE — Завдання 2: Робочий застосунок (прототип → БД)

**1. Що я просив у AI.** Спершу провести всі сценарії spec через API на in-memory сховищі, потім перенести їх на SQLite з тими самими HTTP-тестами, контекстом запиту в кожному рядку логу, ідемпотентним `POST` і `503` на зайняту БД. Промпти: [`ai/prompt-0006-prototype.md`](ai/prompt-0006-prototype.md) → [`0007`](ai/prompt-0007-logger-models.md) → [`0008`](ai/prompt-0008-sqlite-store.md) → [`0009`](ai/prompt-0009-test-gaps-rollback-log.md), сесії — `ai/sessions/`.

**2. Топ-3 розбіжності, які я знайшов і виправив** (spec ↔ вихід AI):

| # | Що було не так (проти якого пункту spec) | Мій слід | Виправлення |
| - | --- | --- | --- |
| 1 | Операцій з БД не видно в лозі (вимога завдання, AC 10): рядок писався до виклику, на `debug`, без результату. Агент зробив точно за ADR 009 — помилявся мій документ | коментар у [PR #3](https://github.com/respekttt/spendwise/pull/3) до `memory/index.js:31` · ADR 009 `a9dfbf1` · AC 10 `2e1cd0b` · промпт 0007 | `4d7219c` |
| 2 | `specs/db.md` чекав `SQLITE_CONSTRAINT_FOREIGNKEY` для `ON DELETE RESTRICT`, а SQLite дає `SQLITE_CONSTRAINT_TRIGGER` (1811). На рев'ю `db.md` я це пропустив, знайшов тест агента | коментар у PR #3 до `sqlite/categories.js:71` | `ef7e342` (документ, код без змін) |
| 3 | Лог писав `rollback` на кожну спробу, де падав сам `BEGIN`, — шість рядків на один `503` (ADR 009, «Що пишеться») | ручна перевірка [`docs/manual-check-task2.md`](docs/manual-check-task2.md), розд. 7 · ADR 009 `4009831` · промпт 0009 | `8962080` |

**3. Ключове рішення:** як чекати на зайняту БД — `busy_timeout = 0` і асинхронні ретраї, потім `503` з `Retry-After`. `bun:sqlite` синхронний, тож поки SQLite чекає блокування, стоїть увесь сервер; заміри показали, що `busy_timeout = 50` реально блокує на 109–125 мс, і блокування накопичуються між запитами. Відкинуто: `5000` і `500`, `50` з ретраями ([`standards/adr/010-idempotency-and-busy-retries.md`](standards/adr/010-idempotency-and-busy-retries.md), `12a7c9a`).

**4. Перевірка:** `bun run ci` → `349 pass, 0 fail`, код виходу `0`; CI у PR #3 зелений. Ручний прогін на запущеному сервері з тестовою БД — [`docs/manual-check-task2.md`](docs/manual-check-task2.md). Версія `/version` → `ac923ea`.

## Аудит

**Зрізані кути й крайові випадки:**

- `db.transaction()` у Bun мовчки комітить, якщо передати `async`-функцію (перевірено запуском). Обгортка перевіряє thenable всередині транзакції — ADR 008, `10183a9`.
- `busy_timeout` блокує довше, ніж задано, і заморожує весь процес — див. ключове рішення, `12a7c9a`.
- Тести старту падали за таймаутом: цикл очікування (5 с) дорівнював таймауту тесту, а Windows ще тримав файл БД. Явний таймаут 20 с і `rmSync` з повторами — `d748c51`.

**N+1:** не виник. Звіти спроєктовано як фіксовану кількість запитів з `GROUP BY` ([`specs/db.md`](specs/db.md)), AC 14 закріплює це тестом: R1 = 2, R2 = 1 і для 1, і для 20 категорій (`5946a35`).

**Поведінка на збоях** (докази — [`docs/manual-check-task2.md`](docs/manual-check-task2.md)):

| Збій | Клієнт | Лог |
| --- | --- | --- |
| БД недоступна на старті | порт не відкривається, `exit 1` | `fatal` `database unavailable`, `SQLITE_CANTOPEN` / `SQLITE_NOTADB` |
| БД заблокована іншим процесом | `503`, `Retry-After: 1` за ~0,85 с; `GET /version` тим часом — за 3 мс | 5× `warn` `transaction retry`, `error` `storage unavailable` |
| Виняток посеред транзакції (AC 13) | `500`, стан БД незмінний | `warn` `rollback` з причиною |
| Повтор `POST` з тим самим ключем / з іншим тілом | той самий `201` + `Idempotent-Replayed` / `422` | `idempotent replay` / `rollback` з `IdempotencyMismatchError` |

Відомі обмеження: `rollback` на `warn` для клієнтської `422`; правило `.run(` у `tests/layers.test.js` не ловить виклик, перенесений на новий рядок.