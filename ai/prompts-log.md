# Лог роботи з AI

Індекс сесій. Деталі кожної сесії — у `ai/sessions/`.

- [0001](sessions/0001-chat.md) — вибір теми, уточнювальні питання, рев'ю spec.md (чернетка промпту: [prompt-draft-0001.md](prompt-draft-0001.md))
- [0002](sessions/0002-chat.md) — рев'ю власних стандартів (standards/)
- [0003](sessions/0003-chat.md) — коміти документів, фундамент проєкту за промптом setup (промпт: [prompt-0003-setup.md](prompt-0003-setup.md))
- [0004](sessions/0004-chat.md) — формат помилок за контрактом, відповідність checklist, CI (промпт: [prompt-0004-contract-ci.md](prompt-0004-contract-ci.md))
- [0005](sessions/0005-chat.md) — завдання 2: план, рев'ю spec, ADR 007–010, `db.md` і контракту; технічні твердження ADR перевірено запуском (промпт прототипу — `prompt-0006-prototype.md`, наступна сесія)
- [0006](sessions/0006-chat.md) — прототип: усі сценарії через API на in-memory сховищі, контрольна точка `873c53a` (промпт: [prompt-0006-prototype.md](prompt-0006-prototype.md))
- [0007](sessions/0007-chat.md) — виправлення прототипу за рев'ю PR #3: операції з БД у лозі на `info` з результатом, `pino` у залежностях, `server/models.js` (промпт: [prompt-0007-logger-models.md](prompt-0007-logger-models.md))
- [0008](sessions/0008-chat.md) — SQLite-сховище: ті самі сценарії й HTTP-тести на in-memory і SQLite, перевірка старту, ретраї на `SQLITE_BUSY` і `503`, AC 9, 12, 14, 17; контрольна точка `5466f4a` (промпт: [prompt-0008-sqlite-store.md](prompt-0008-sqlite-store.md))
- [0009](sessions/0009-chat.md) — прогалини в тестах: `errno 2067` на справжній `UNIQUE`, правило `.run(`/`.exec(` лише на statement у `repositories/sqlite/`; `rollback` і `begin` у лозі лише для відкритої транзакції (ADR 009) (промпт: [prompt-0009-test-gaps-rollback-log.md](prompt-0009-test-gaps-rollback-log.md))
