// Спільне для HTTP-тестів: застосунок на in-memory сховищі з фіксованим годинником і логом у пам'яті.
import { Writable } from 'node:stream';
import { createApp } from '../server/app.js';
import { kyivToday } from '../server/core/time.js';
import { createLogger } from '../server/logger.js';
import { createMemoryStore } from '../server/repositories/memory/index.js';
import { createSeed } from '../server/repositories/memory/seed.js';

/** У Києві 2026-11-05, як у прикладі контракту. */
export const FIXED_NOW = () => new Date('2026-11-05T10:00:00Z');
export const T = '2026-11-05';

/** Логер, що пише JSON-рядки pino в масив, а не в stdout. */
export function memoryLogger(level = 'silent') {
  const records = [];
  const lines = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      for (const line of chunk.toString().split('\n')) {
        if (!line.trim()) continue;
        lines.push(line);
        records.push(JSON.parse(line));
      }
      callback();
    },
  });
  return { records, lines, logger: createLogger({ level, stream }) };
}

/**
 * @param {{ seed?: object, now?: () => Date, level?: string }} [options]
 *   без `seed` — статичний набір прототипу від `today`
 */
export function createTestApp({ seed, now = FIXED_NOW, level = 'silent' } = {}) {
  const { records, lines, logger } = memoryLogger(level);
  const store = createMemoryStore({ seed: seed ?? createSeed(kyivToday(now())), now, logger });
  const app = createApp({ store, now, logger, version: 'test' });
  return { app, store, records, lines };
}

/** Перевіряє код, `Content-Type` і тіло рівно `{ error: <непорожній рядок> }`. */
export function expectError(expect, res, status) {
  expect(res.statusCode).toBe(status);
  expect(res.headers['content-type']).toStartWith('application/json');
  const body = res.json();
  expect(Object.keys(body)).toEqual(['error']);
  expect(typeof body.error).toBe('string');
  expect(body.error.trim().length).toBeGreaterThan(0);
  return body;
}
