import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { kyivToday } from './core/time.js';
import { createLogger } from './logger.js';
import { createMemoryStore } from './repositories/memory/index.js';
import { createSeed } from './repositories/memory/seed.js';

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

// Сервер стартує лише під час запуску файла напряму (`bun server/main.js`);
// імпорт із тестів дає тільки `resolveVersion`.
if (import.meta.main) {
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? '127.0.0.1';
  // тимчасово: прототип на in-memory (ADR 007); DB_PATH поки ігнорується.
  const now = () => new Date();
  const logger = createLogger();
  const store = createMemoryStore({ seed: createSeed(kyivToday(now())), now, logger });

  const app = createApp({ store, now, logger, version: resolveVersion() });

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
