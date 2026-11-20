import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StorageUnavailableError } from '../server/core/errors.js';
import { openDb } from '../server/db/index.js';
import { createTransactions, isBusy } from '../server/db/transaction.js';
import { memoryLogger } from './helpers.js';

// ADR 007, 008, 010: межі транзакції SQLite, thenable, ретраї на SQLITE_BUSY.

const ZERO = [0, 0, 0, 0, 0];
const count = (db) => db.query('SELECT COUNT(*) AS n FROM categories').get().n;
const insert = (db, name) =>
  db.query('INSERT INTO categories (name, name_normalized) VALUES ($name, $name)').run({ name });

describe('withTransaction / withRead на :memory:', () => {
  test('async-функція → TypeError, вставку не закомічено (ADR 008, Context)', async () => {
    const db = openDb(':memory:');
    const { withTransaction, withRead } = createTransactions(db, { logger: memoryLogger().logger });

    await expect(
      withTransaction(async () => {
        insert(db, 'a');
      }),
    ).rejects.toThrow(TypeError);
    await expect(withRead(async () => count(db))).rejects.toThrow(TypeError);

    expect(count(db)).toBe(1);
    expect(db.inTransaction).toBe(false);
    db.close();
  });

  test('виняток у fn → відкат і warn rollback з причиною; не BUSY не повторюється', async () => {
    const db = openDb(':memory:');
    const { records, logger } = memoryLogger('debug');
    const { withTransaction } = createTransactions(db, { logger, delays: ZERO });
    let calls = 0;

    await expect(
      withTransaction(() => {
        calls++;
        insert(db, 'a');
        insert(db, 'a'); // UNIQUE
      }),
    ).rejects.toMatchObject({ code: 'SQLITE_CONSTRAINT_UNIQUE', errno: 2067 });

    expect(calls).toBe(1);
    expect(count(db)).toBe(1);
    expect(records.map((r) => [r.level, r.tx, r.reason])).toEqual([
      [20, 'begin', undefined],
      [40, 'rollback', 'SQLITE_CONSTRAINT_UNIQUE'],
    ]);
    db.close();
  });

  test('успіх → результат fn, begin і commit на debug', async () => {
    const db = openDb(':memory:');
    const { records, logger } = memoryLogger('debug');
    const { withTransaction, withRead } = createTransactions(db, { logger });

    expect(await withTransaction(() => insert(db, 'a').changes)).toBe(1);
    expect(await withRead(() => count(db))).toBe(2);
    expect(records.map((r) => [r.level, r.tx])).toEqual([
      [20, 'begin'],
      [20, 'commit'],
      [20, 'begin'],
      [20, 'commit'],
    ]);
    db.close();
  });

  test('isBusy розпізнає сімейство за errno & 0xff', () => {
    expect(isBusy({ errno: 5 })).toBe(true);
    expect(isBusy({ errno: 517 })).toBe(true); // SQLITE_BUSY_SNAPSHOT
    expect(isBusy({ errno: 2067 })).toBe(false);
    expect(isBusy(new Error('x'))).toBe(false);
  });
});

describe('SQLITE_BUSY від другого з’єднання (файл у mkdtemp)', () => {
  let dir;
  let db;
  let other;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'spendwise-busy-'));
    db = openDb(join(dir, 'busy.db'));
    other = openDb(join(dir, 'busy.db'));
  });
  afterEach(() => {
    if (other.inTransaction) other.run('ROLLBACK');
    other.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('блокування довше за всі спроби → StorageUnavailableError, 6 спроб, error у лозі', async () => {
    const { records, logger } = memoryLogger('info');
    const { withTransaction } = createTransactions(db, { logger, delays: ZERO });
    other.run('BEGIN IMMEDIATE');
    let calls = 0;

    await expect(
      withTransaction(() => {
        calls++;
        insert(db, 'a');
      }),
    ).rejects.toBeInstanceOf(StorageUnavailableError);

    // BEGIN IMMEDIATE падає до виклику fn: спроб 6, а fn не викликалась.
    expect(calls).toBe(0);
    const retries = records.filter((r) => r.msg === 'transaction retry');
    expect(retries.map((r) => [r.level, r.attempt])).toEqual([1, 2, 3, 4, 5].map((n) => [40, n]));
    expect(records).toContainEqual(
      expect.objectContaining({ level: 50, msg: 'storage unavailable', attempts: 6 }),
    );
    other.run('ROLLBACK');
    expect(count(db)).toBe(1);
  });

  test('блокування знято між спробами → успіх з другої спроби', async () => {
    const { records, logger } = memoryLogger('info');
    const { withTransaction } = createTransactions(db, { logger, delays: [100, 100, 100, 100] });
    other.run('BEGIN IMMEDIATE');

    const pending = withTransaction(() => insert(db, 'a').changes);
    while (!records.some((r) => r.msg === 'transaction retry')) await Bun.sleep(1);
    other.run('ROLLBACK');

    expect(await pending).toBe(1);
    expect(records.filter((r) => r.msg === 'transaction retry')).toHaveLength(1);
    expect(count(db)).toBe(2);
  });

  test('BUSY на COMMIT (друге з’єднання читає) не лишає відкритої транзакції', async () => {
    const { logger } = memoryLogger();
    const { withTransaction } = createTransactions(db, { logger, delays: ZERO });
    other.run('BEGIN');
    other.query('SELECT * FROM categories').all(); // SHARED-блокування до кінця транзакції
    let calls = 0;

    const error = await withTransaction(() => {
      calls++;
      insert(db, 'a');
    }).catch((e) => e);

    expect(error).toBeInstanceOf(StorageUnavailableError);
    // fn виконувалась щоразу: BUSY приходить на COMMIT, уже після INSERT.
    expect(calls).toBe(6);
    expect(db.inTransaction).toBe(false);
    other.run('ROLLBACK');
    expect(count(db)).toBe(1);
    // Наступна транзакція починає з чистого стану.
    const { withTransaction: next } = createTransactions(db, { logger });
    expect(await next(() => insert(db, 'b').changes)).toBe(1);
  });
});
