// Спільне для HTTP-тестів: застосунок на in-memory або SQLite-сховищі з фіксованим годинником і логом у пам'яті.
import { Writable } from 'node:stream';
import { createApp } from '../server/app.js';
import { normalizeCategoryName } from '../server/core/categories.js';
import { kyivToday, sqliteTimestamp } from '../server/core/time.js';
import { openDb } from '../server/db/index.js';
import { createLogger } from '../server/logger.js';
import { createMemoryStore } from '../server/repositories/memory/index.js';
import { createSeed } from '../server/repositories/memory/seed.js';
import { createSqliteStore } from '../server/repositories/sqlite/index.js';

/** Сховища, на яких проганяються спільні HTTP-тести (ADR 007, AC 16). */
export const STORAGES = ['memory', 'sqlite'];

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
 * Вставляє набір у свіжу БД після schema.sql з явними `id`, як `initialState` in-memory сховища.
 * «Інше» вже створена схемою з `id = 1`, тож пропускається; набір мусить мати її теж з `id = 1`.
 */
export function seedSqlite(db, { categories = [], expenses = [] }, now) {
  const fallback = categories.filter((c) => c.is_default);
  if (fallback.length > 1 || (fallback.length === 1 && fallback[0].id !== 1)) {
    throw new Error('seedSqlite: «Інше» в наборі має бути одна з id = 1');
  }
  const category = db.query(
    'INSERT INTO categories (id, name, name_normalized, limit_amount) VALUES ($id, $name, $nn, $limit_amount)',
  );
  for (const c of categories.filter((c) => !c.is_default)) {
    category.run({
      id: c.id,
      name: c.name,
      nn: normalizeCategoryName(c.name),
      limit_amount: c.limit_amount ?? null,
    });
  }
  const expense = db.query(
    `INSERT INTO expenses (id, category_id, amount, description, spent_at, created_at)
     VALUES ($id, $category_id, $amount, $description, $spent_at, $created_at)`,
  );
  const created_at = sqliteTimestamp(now());
  for (const e of expenses) expense.run({ description: '', created_at, ...e });
}

/**
 * Сховище для тестів. SQLite — власна БД `:memory:` з набором; закривається разом із застосунком.
 * @param {{ storage?: 'memory' | 'sqlite', seed?: object, now?: () => Date, logger?: object, db?: object, delays?: number[] }} options
 */
export function createTestStore({
  storage = 'memory',
  seed = {},
  now = FIXED_NOW,
  logger,
  db,
  delays,
}) {
  if (storage === 'memory') return { store: createMemoryStore({ seed, now, logger }) };
  const conn = db ?? openDb(':memory:');
  seedSqlite(conn, seed, now);
  return { store: createSqliteStore({ db: conn, now, logger, delays }), db: conn };
}

/**
 * @param {{ storage?: 'memory' | 'sqlite', seed?: object, now?: () => Date, level?: string, db?: object, delays?: number[] }} [options]
 *   без `seed` — статичний набір прототипу від `today`; `db` — власне з'єднання SQLite (наприклад, з лічильником)
 */
export function createTestApp({
  storage = 'memory',
  seed,
  now = FIXED_NOW,
  level = 'silent',
  db,
  delays,
} = {}) {
  const { records, lines, logger } = memoryLogger(level);
  const { store, db: conn } = createTestStore({
    storage,
    seed: seed ?? createSeed(kyivToday(now())),
    now,
    logger,
    db,
    delays,
  });
  const app = createApp({ store, now, logger, version: 'test' });
  if (conn && !db) app.addHook('onClose', () => conn.close());
  return { app, store, records, lines, db: conn };
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
