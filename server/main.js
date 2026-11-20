import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { openCheckedDb } from './db/index.js';
import { createLogger } from './logger.js';
import { createSqliteStore } from './repositories/sqlite/index.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

/**
 * Визначає версію застосунку (контракт API, `GET /version`):
 * `GIT_SHA` → `git rev-parse --short HEAD` → `unknown`.
 * Викликається один раз під час старту процесу, а не в `createApp`:
 * HTTP-шар і тести не запускають зовнішніх процесів.
 * @param {{ env?: Record<string, string | undefined>, cwd?: string }} [options]
 * @returns {string}
 */
export function resolveVersion({ env = process.env, cwd = repoRoot } = {}) {
  const fromEnv = env.GIT_SHA?.trim();
  if (fromEnv) return fromEnv;

  try {
    const result = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd,
      env,
      encoding: 'utf8',
      timeout: 5000,
    });
    const sha = result.status === 0 ? result.stdout.trim() : '';
    if (sha) return sha;
  } catch {
    // git не встановлено або недоступний — переходимо до запасного значення.
  }
  return 'unknown';
}

/**
 * Шлях до робочої БД за замовчуванням — поза робочою папкою проєкту (ADR 008).
 * @param {{ env?: Record<string, string | undefined>, platform?: string }} [options]
 */
export function defaultDbPath({ env = process.env, platform = process.platform } = {}) {
  const base =
    platform === 'win32'
      ? (env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'))
      : env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
  return join(base, 'spendwise', 'spendwise.db');
}

// Сервер стартує лише під час запуску файла напряму (`bun server/main.js`);
// імпорт із тестів дає тільки `resolveVersion` і `defaultDbPath`.
if (import.meta.main) {
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? '127.0.0.1';
  const now = () => new Date();
  const logger = createLogger();

  // ADR 008: перевірка БД до listen(); будь-яка помилка — fatal і код виходу 1, порт не відкривається.
  const dbPath = process.env.DB_PATH || defaultDbPath();
  let db;
  try {
    // Каталог створюється лише для шляху за замовчуванням: явний DB_PATH — як є (AC 12).
    if (!process.env.DB_PATH) mkdirSync(dirname(dbPath), { recursive: true });
    db = openCheckedDb(dbPath);
  } catch (error) {
    logger.fatal({ err: error, dbPath }, 'database unavailable');
    process.exit(1);
  }
  logger.info({ dbPath }, 'database opened');

  const store = createSqliteStore({ db, now, logger });
  const app = createApp({ store, now, logger, version: resolveVersion() });
  app.addHook('onClose', () => db.close());

  try {
    await app.listen({ port, host });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, async () => {
      await app.close();
      process.exit(0);
    });
  }
}
