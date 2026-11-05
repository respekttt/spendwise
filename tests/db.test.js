import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../server/db/index.js';

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
});
