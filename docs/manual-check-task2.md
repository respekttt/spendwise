# Ручна перевірка — Завдання 2, SQLite-сховище

- **Дата:** 2026-11-20
- **Код:** гілка `task2`, `GET /version` → `1268076` (контрольна точка 0008 — `5466f4a`, далі лише документи)
- **Середовище:** Windows, PowerShell 7, Bun 1.4.4, `curl.exe`
- **Навіщо:** живі докази для AC 9, 10, 11, 12, 17 і поведінки на збоях (ADR 008, 009, 010). Автоматичні тести ті самі випадки покривають; тут — справжній процес, справжній файл БД і другий процес, що його блокує.

Тестова БД — `%TEMP%\spendwise-check.db`, поза OneDrive. Стеки й службові поля логу (`time`, `pid`, `hostname`) обрізано.

## 1. БД за замовчуванням (ADR 008)

`bun run start` без `DB_PATH`:

```
{"level":30,"dbPath":"C:\\Users\\deni5\\AppData\\Local\\spendwise\\spendwise.db","msg":"database opened"}
```

Файл з'явився в `%LOCALAPPDATA%\spendwise`, `git status` нових `.db` не показує.

## 2. AC 12: БД недоступна на старті

| `DB_PATH` | Лог | Код виходу |
|---|---|---|
| `C:\no-such-dir\x.db` | `level 60`, `database unavailable`, `code: SQLITE_CANTOPEN`, `errno: 14` | `1` |
| файл з 4096 випадкових байтів | `level 60`, `database unavailable`, `code: SQLITE_NOTADB`, `errno: 26` | `1` |

В обох випадках порт не відкрився.

## 3. Сценарії й AC 10

`POST /expenses` з `X-User: denys`, `X-Process-Id: flow-1` у категорію з лімітом `100`, сума `150`:

```
HTTP/1.1 201 Created
x-request-id: d714b066-0cc8-49df-ad2c-7b7d7ed307af
x-process-id: flow-1
{"expense":{"id":1,"category_id":2,"amount":150,...},"warning":{"category_id":2,"limit_amount":100,"spent":150,"exceeded_by":50}}
```

Лог цього запиту — однакові `reqId`, `bpId`, `user` в усіх рядках, сум і назв немає:

```
{"reqId":"d714b066-…","bpId":"flow-1","user":"denys","repo":"idempotencyKeys","method":"find","result":{"found":false},"msg":"db operation"}
{"reqId":"d714b066-…","bpId":"flow-1","user":"denys","repo":"categories","method":"getById","result":{"found":true},"msg":"db operation"}
{"reqId":"d714b066-…","bpId":"flow-1","user":"denys","repo":"expenses","method":"insert","result":{"changes":1,"id":1},"msg":"db operation"}
{"reqId":"d714b066-…","bpId":"flow-1","user":"denys","repo":"expenses","method":"sumForCategory","result":{"rows":1},"msg":"db operation"}
{"reqId":"d714b066-…","bpId":"flow-1","user":"denys","expenseId":1,"msg":"expense created"}
{"reqId":"d714b066-…","bpId":"flow-1","user":"denys","res":{"statusCode":201},"msg":"request completed"}
```

Невалідний `X-User` разом з `X-Process-Id: p1`: `400`, у відповіді `x-process-id: p1`, у лозі `"bpId":"p1","user":null`.

Видалення категорії: `{"category":{...},"moved_expenses":2}`, у лозі `moveAll` → `{"changes":2}`.

## 4. AC 9: перезапуск

Після `Ctrl+C` і нового старту на тій самій БД `GET /expenses` повертає обидві витрати (тепер у «Інше»), `GET /categories` — одну «Інше».

## 5. AC 11: ідемпотентність

Три `POST /expenses` з `Idempotency-Key: exp-1` і `X-User: denys`:

| Запит | Відповідь |
|---|---|
| тіло A | `201`, `id: 1` |
| те саме тіло A | `201`, `idempotent-replayed: true`, той самий `id: 1` і `created_at`; у лозі `idempotent replay`, без `insert` |
| тіло B (інша сума) | `422`, «ключ уже використано з іншим тілом запиту» |

`GET /expenses` → один запис.

Побічне спостереження з першого прогону: той самий ключ без `X-User` (тобто від `local`) створив новий запис — область ключа — пара (`X-User`, ключ), як записано в ADR 010.

## 6. AC 17 і поведінка на збоях: `SQLITE_BUSY`

Другий процес тримав `BEGIN IMMEDIATE` на тому самому файлі 15 с:

```
bun -e "import { Database } from 'bun:sqlite'; const db = new Database(process.env.DB); db.run('BEGIN IMMEDIATE'); …"
```

`POST /expenses` у фоні, через 100 мс — `GET /version`. Клієнт:

```
1268076 version 0.002996s
POST 503 0.845083s
```

Лог сервера (`GET /version` обслужено між спробами того самого `POST`):

```
{"level":40,"reqId":"39721eb6-…","tx":"rollback","reason":"SQLITE_BUSY","msg":"transaction"}
{"level":40,"reqId":"39721eb6-…","attempt":1,"err":"SQLITE_BUSY","msg":"transaction retry"}
… attempt 2, attempt 3 …
{"level":30,"reqId":"e0f72fde-…","req":{"method":"GET","url":"/version"},"msg":"incoming request"}
{"level":30,"reqId":"e0f72fde-…","res":{"statusCode":200},"responseTime":0.81,"msg":"request completed"}
… attempt 4, attempt 5 …
{"level":50,"reqId":"39721eb6-…","attempts":6,"err":"SQLITE_BUSY","msg":"storage unavailable"}
{"level":30,"reqId":"39721eb6-…","res":{"statusCode":503},"responseTime":842.5,"msg":"request completed"}
```

Відповідь на `POST`:

```
HTTP/1.1 503 Service Unavailable
retry-after: 1
{"error":"База даних зайнята, спробуйте пізніше"}
```

Під тим самим блокуванням `GET /expenses` → `200`: у режимі журналу `DELETE` читач не блокується, поки інший процес тримає лише `IMMEDIATE`.

Після звільнення той самий `POST` з тим самим `Idempotency-Key: busy-1` → `201`: результат `503` як результат ключа не зберігся.

## 7. Що знайдено

- **Зайвий `rollback` у лозі.** На кожну спробу, де сам `BEGIN IMMEDIATE` упав з `SQLITE_BUSY`, лог пише `warn` `rollback`, хоча транзакція не почалася: на один `503` — шість рядків `rollback`. Уточнено в ADR 009 («`rollback` лише для відкритої транзакції»), виправлення — промпт 0009. **Виправлено в `8962080`:** `rollback` і `begin` пишуться лише для відкритої транзакції.
- **`rollback` на `warn` для `422`.** `IdempotencyMismatchError` — звичайна клієнтська помилка, але транзакція справді відкочується, тож рядок коректний за ADR 009. Лишено як є, записано для аудиту.