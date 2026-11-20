import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCheckedDb, openDb, verifyDb } from '../server/db/index.js';

// AC 9: ініціалізація на тому самому файлі БД.
describe('ініціалізація БД', () => {
  let dir;
  let dbPath;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'spendwise-db-'));
    dbPath = join(dir, 'test.db');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('повторна ініціалізація лишає «Інше» в одному екземплярі', () => {
    openDb(dbPath).close();
    const db = openDb(dbPath);

    const rows = db.query('SELECT name, is_default, limit_amount FROM categories').all();
    db.close();

    expect(rows).toEqual([{ name: 'Інше', is_default: 1, limit_amount: null }]);
  });

  test('PRAGMA foreign_keys = 1 для кожного нового з’єднання', () => {
    const first = openDb(dbPath);
    const second = openDb(dbPath);

    expect(first.query('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
    expect(second.query('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });

    first.close();
    second.close();
  });

  test(':memory: теж ініціалізується зі «Інше»', () => {
    const db = openDb(':memory:');
    const { count } = db
      .query('SELECT COUNT(*) AS count FROM categories WHERE is_default = 1')
      .get();
    db.close();

    expect(count).toBe(1);
  });

  test('busy_timeout за параметром, за замовчуванням 0 (ADR 010)', () => {
    const zero = openDb(':memory:');
    const custom = openDb(':memory:', { busyTimeoutMs: 20 });
    expect(zero.query('PRAGMA busy_timeout').get()).toEqual({ timeout: 0 });
    expect(custom.query('PRAGMA busy_timeout').get()).toEqual({ timeout: 20 });
    zero.close();
    custom.close();
  });

  test('schema.sql створює idempotency_keys з індексом за created_at', () => {
    const db = openDb(':memory:');
    const names = db
      .query("SELECT name FROM sqlite_master WHERE tbl_name = 'idempotency_keys'")
      .all()
      .map((r) => r.name);
    db.close();
    expect(names).toContain('idempotency_keys');
    expect(names).toContain('idempotency_keys_created_at');
  });
});

// ADR 008, «Перевірка на старті»: чотири кроки, кожен кидає помилку.
describe('перевірка БД на старті', () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'spendwise-start-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('крок 1: неіснуючий каталог → SQLITE_CANTOPEN', () => {
    expect(() => openCheckedDb(join(dir, 'missing', 'x.db'))).toThrow(
      expect.objectContaining({ code: 'SQLITE_CANTOPEN' }),
    );
  });

  test('крок 2: файл з довільними байтами → SQLITE_NOTADB', () => {
    const path = join(dir, 'junk.db');
    writeFileSync(path, 'не база даних '.repeat(400));
    expect(() => openCheckedDb(path)).toThrow(expect.objectContaining({ code: 'SQLITE_NOTADB' }));
  });

  test('крок 3: foreign_keys вимкнено → помилка', () => {
    const db = openDb(':memory:');
    db.run('PRAGMA foreign_keys = OFF');
    expect(() => verifyDb(db)).toThrow(/foreign_keys/);
    db.close();
  });

  test('крок 4: «Інше» відсутня → помилка', () => {
    const db = openDb(':memory:');
    db.run('DELETE FROM categories WHERE is_default = 1');
    expect(() => verifyDb(db)).toThrow(/Інше/);
    db.close();
  });

  test('AC 9: справна БД проходить усі кроки двічі поспіль, «Інше» одна', () => {
    const path = join(dir, 'ok.db');
    openCheckedDb(path).close();
    const db = openCheckedDb(path);
    expect(db.query('SELECT COUNT(*) AS n FROM categories WHERE is_default = 1').get()).toEqual({
      n: 1,
    });
    db.close();
  });
});
