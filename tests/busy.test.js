import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../server/db/index.js';
import { createTestApp, T } from './helpers.js';

// AC 17, сценарій 10 (ADR 010): друге з'єднання тримає BEGIN IMMEDIATE. Перевіряється результат
// і кількість спроб, а не час.

const payload = { category_id: 2, amount: 10, spent_at: T };
let dir;
let other;
let started;

function start(delays) {
  const path = join(dir, 'busy.db');
  started = createTestApp({ storage: 'sqlite', db: openDb(path), delays, level: 'info' });
  other = openDb(path);
  return started;
}
const retries = () => started.records.filter((r) => r.msg === 'transaction retry');
const countExpenses = () => started.db.query('SELECT COUNT(*) AS n FROM expenses').get().n;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'spendwise-ac17-'));
});
afterEach(async () => {
  await started.app.close();
  if (other.inTransaction) other.run('ROLLBACK');
  other.close();
  started.db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('AC 17: БД зайнята іншим процесом', () => {
  test('блокування довше за всі спроби → 503, Retry-After, дані незмінні, 6 спроб', async () => {
    const { app, records } = start([0, 0, 0, 0, 0]);
    const before = countExpenses();
    other.run('BEGIN IMMEDIATE');

    const res = await app.inject({ method: 'POST', url: '/expenses', payload });

    expect(res.statusCode).toBe(503);
    expect(res.headers['retry-after']).toBe('1');
    expect(res.headers['content-type']).toStartWith('application/json');
    expect(res.json()).toEqual({ error: 'База даних зайнята, спробуйте пізніше' });
    expect(retries().map((r) => [r.level, r.attempt, r.reqId])).toEqual(
      [1, 2, 3, 4, 5].map((n) => [40, n, res.headers['x-request-id']]),
    );
    expect(records).toContainEqual(
      expect.objectContaining({ level: 50, msg: 'storage unavailable', attempts: 6 }),
    );
    other.run('ROLLBACK');
    expect(countExpenses()).toBe(before);
  });

  test('блокування знято між спробами → 201; поки запит чекає, GET /version відповідає', async () => {
    const { app } = start([100, 100, 100, 100, 100]);
    const before = countExpenses();
    other.run('BEGIN IMMEDIATE');

    let posted = false;
    const pending = app.inject({ method: 'POST', url: '/expenses', payload }).then((res) => {
      posted = true;
      return res;
    });
    while (retries().length === 0) await Bun.sleep(1);

    // Пауза — await на таймері, а не блокування процесу (ADR 010).
    const version = await app.inject({ method: 'GET', url: '/version' });
    expect(version.statusCode).toBe(200);
    expect(posted).toBe(false);

    other.run('ROLLBACK');
    const res = await pending;
    expect(res.statusCode).toBe(201);
    expect(retries()).toHaveLength(1);
    expect(countExpenses()).toBe(before + 1);
  });
});
