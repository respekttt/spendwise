# Мутаційне тестування `server/core/`

Правила — [`specs/testing.md`](../specs/testing.md), розд. 3 і сценарій 4; інструмент і конфігурація — [ADR 011](../standards/adr/011-testing-levels-and-mutation.md), [`stryker.config.json`](../stryker.config.json). Машинні звіти (`reports/mutation/mutation.html`, `mutation.json`) у git не потрапляють.

| | |
|---|---|
| Дата | 2026-11-21 |
| Коміт | `b1cd361` (тести після переїзду в каталоги й правил рівнів, без нових тестів) |
| Bun | 1.4.4 |
| Node | 22.20.0 |
| Stryker | `@stryker-mutator/core` 10.1.1, `command`-runner, `coverageAnalysis: off` |
| Команда | `bun run mutation` (`bunx stryker run`), на кожному мутанті — `bun test ./tests/unit` |
| Обсяг | `server/core/**/*.js`, крім `server/core/errors.js` |

## До

Прогін на нинішніх тестах, до нових unit-тестів `reports.js` і будь-яких підсилень (сценарій 4, крок 1). Код виходу `0`: score вище `break: 80`. Прогін — 4 с. Повторний прогін на тому самому коміті дав той самий набір мутантів (сценарій 5).

### Підсумок

| Файл | Усього | Убито | Вижило | Тайм-аут | Без покриття | Score |
|---|---:|---:|---:|---:|---:|---:|
| **Увесь обсяг** | **234** | **196** | **38** | **0** | **0** | **83,76 %** |
| `categories.js` | 15 | 15 | 0 | 0 | 0 | 100,00 % |
| `idempotency.js` | 19 | 0 | 19 | 0 | 0 | 0,00 % |
| `money.js` | 25 | 25 | 0 | 0 | 0 | 100,00 % |
| `reports.js` | 50 | 48 | 2 | 0 | 0 | 96,00 % |
| `time.js` | 19 | 15 | 4 | 0 | 0 | 78,95 % |
| `validation.js` | 106 | 93 | 13 | 0 | 0 | 87,74 % |

«Без покриття» — завжди `0`: з `coverageAnalysis: off` Stryker покриття не знає й запускає тести на кожному мутанті (ADR 011).

### Вижилі мутанти

Порядок — за файлом, рядком і колонкою. «Було» — фрагмент коду, який замінює мутант; довгі фрагменти обрізано (`…`), переноси рядків — пробілами, шаблонні рядки показано в одинарних лапках. Колонки «Класифікація», «Обґрунтування», «Дія» заповнює автор за правилами `specs/testing.md`, розд. 3; позначку «вбиває інтеграційний тест» (ADR 011) — в «Обґрунтуванні».

| № | Файл:рядок | Мутатор | Було → стало | Класифікація | Обґрунтування | Дія |
|---:|---|---|---|---|---|---|
| 1 | `server/core/idempotency.js:5` | BlockStatement | `{ if (Array.isArray(value)) return value.map(sortKeys); if (value !…` → `{}` | | | |
| 2 | `server/core/idempotency.js:6` | ConditionalExpression | `Array.isArray(value)` → `false` | | | |
| 3 | `server/core/idempotency.js:6` | ConditionalExpression | `Array.isArray(value)` → `true` | | | |
| 4 | `server/core/idempotency.js:7` | ConditionalExpression | `value !== null` → `true` | | | |
| 5 | `server/core/idempotency.js:7` | EqualityOperator | `value !== null` → `value === null` | | | |
| 6 | `server/core/idempotency.js:7` | ConditionalExpression | `value !== null && typeof value === 'object'` → `false` | | | |
| 7 | `server/core/idempotency.js:7` | ConditionalExpression | `value !== null && typeof value === 'object'` → `true` | | | |
| 8 | `server/core/idempotency.js:7` | LogicalOperator | `value !== null && typeof value === 'object'` → `value !== null \|\| typeof value === 'object'` | | | |
| 9 | `server/core/idempotency.js:7` | ConditionalExpression | `typeof value === 'object'` → `true` | | | |
| 10 | `server/core/idempotency.js:7` | EqualityOperator | `typeof value === 'object'` → `typeof value !== 'object'` | | | |
| 11 | `server/core/idempotency.js:7` | StringLiteral | `'object'` → `""` | | | |
| 12 | `server/core/idempotency.js:7` | BlockStatement | `{ return Object.fromEntries( Object.keys(value) .sort() .map((key) …` → `{}` | | | |
| 13 | `server/core/idempotency.js:9` | MethodExpression | `Object.keys(value) .sort()` → `Object.keys(value)` | | | |
| 14 | `server/core/idempotency.js:11` | ArrowFunction | `(key) => [key, sortKeys(value[key])]` → `() => undefined` | | | |
| 15 | `server/core/idempotency.js:11` | ArrayDeclaration | `[key, sortKeys(value[key])]` → `[]` | | | |
| 16 | `server/core/idempotency.js:23` | BlockStatement | `{ return createHash('sha256') .update(JSON.stringify(sortKeys({ met…` → `{}` | | | |
| 17 | `server/core/idempotency.js:24` | StringLiteral | `'sha256'` → `""` | | | |
| 18 | `server/core/idempotency.js:25` | ObjectLiteral | `{ method, path, body }` → `{}` | | | |
| 19 | `server/core/idempotency.js:26` | StringLiteral | `'hex'` → `""` | | | |
| 20 | `server/core/reports.js:38` | ConditionalExpression | `b.total - a.total \|\| a.category_id - b.category_id` → `false` | | | |
| 21 | `server/core/reports.js:38` | ArithmeticOperator | `a.category_id - b.category_id` → `a.category_id + b.category_id` | | | |
| 22 | `server/core/time.js:34` | ArrowFunction | `(date) => date.toISOString().replace('T', ' ').slice(0, 19)` → `() => undefined` | | | |
| 23 | `server/core/time.js:34` | MethodExpression | `date.toISOString().replace('T', ' ').slice(0, 19)` → `date.toISOString().replace('T', ' ')` | | | |
| 24 | `server/core/time.js:34` | StringLiteral | `'T'` → `""` | | | |
| 25 | `server/core/time.js:34` | StringLiteral | `' '` → `""` | | | |
| 26 | `server/core/validation.js:6` | Regex | `/^\d{4}-\d{2}-\d{2}$/` → `/\d{4}-\d{2}-\d{2}$/` | | | |
| 27 | `server/core/validation.js:6` | Regex | `/^\d{4}-\d{2}-\d{2}$/` → `/^\d{4}-\d{2}-\d{2}/` | | | |
| 28 | `server/core/validation.js:7` | Regex | `/^\d{4}-(0[1-9]\|1[0-2])$/` → `/\d{4}-(0[1-9]\|1[0-2])$/` | | | |
| 29 | `server/core/validation.js:7` | Regex | `/^\d{4}-(0[1-9]\|1[0-2])$/` → `/^\d{4}-(0[1-9]\|1[0-2])/` | | | |
| 30 | `server/core/validation.js:19` | StringLiteral | `'spent_at'` → `""` | | | |
| 31 | `server/core/validation.js:20` | ConditionalExpression | `typeof value !== 'string'` → `false` | | | |
| 32 | `server/core/validation.js:21` | StringLiteral | `'${field}: очікується реальна дата у форматі YYYY-MM-DD'` → `''` | | | |
| 33 | `server/core/validation.js:24` | StringLiteral | `'${field}: дата не може бути пізнішою за сьогодні'` → `''` | | | |
| 34 | `server/core/validation.js:35` | ConditionalExpression | `typeof value !== 'string'` → `false` | | | |
| 35 | `server/core/validation.js:36` | StringLiteral | `'month: очікується місяць у форматі YYYY-MM'` → `""` | | | |
| 36 | `server/core/validation.js:38` | MethodExpression | `today.slice(0, 7)` → `today` | | | |
| 37 | `server/core/validation.js:39` | StringLiteral | `'month: місяць не може бути пізнішим за поточний'` → `""` | | | |
| 38 | `server/core/validation.js:60` | StringLiteral | `'amount'` → `""` | | | |

## Таблиця гілок `reports.js`

Заповнюється в промпті 0012: гілка в коді → тест → випадок зі `specs/testing.md`, розд. 3 (ADR 011, «Покриття гілок»).

| Гілка в коді (рядок) | Тест | Випадок spec |
|---|---|---|

## Після

Заповнюється після нових тестів і підсилень (сценарій 4, крок 3).
