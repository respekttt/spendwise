import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { DuplicateNameError } from '../server/core/errors.js';
import { openDb } from '../server/db/index.js';
import { createTransactions } from '../server/db/transaction.js';
import {
  SQL as CATEGORIES,
  createCategoriesRepo,
} from '../server/repositories/sqlite/categories.js';

// SQLite-репозиторії: переклад помилок (db.md, «Помилки БД») і плани запитів («Тести, що випливають»).

const silent = { debug() {}, info() {}, warn() {}, error() {} };
let db;
let tx;
beforeEach(() => {
  db = openDb(':memory:');
  tx = createTransactions(db, { logger: silent });
  db.run(`INSERT INTO categories (id, name, name_normalized, limit_amount) VALUES
    (2, 'Їжа', 'їжа', 1000), (3, 'Транспорт', 'транспорт', NULL)`);
  db.run(`INSERT INTO expenses (category_id, amount, spent_at) VALUES
    (2, 10, '2026-11-01'), (2, 5, '2026-10-01'), (3, 7, '2026-11-02')`);
});
afterEach(() => db.close());

/** Деталі плану запиту одним рядком. */
const plan = (sql) =>
  db
    .query(`EXPLAIN QUERY PLAN ${sql}`)
    .all()
    .map((r) => r.detail)
    .join('; ');

describe('sqlite/categories', () => {
  const categories = () => createCategoriesRepo(db);

  test('is_default — boolean; відсутній id → undefined', async () => {
    const repo = categories();
    const { other, missing } = await tx.withRead(() => ({
      other: repo.getDefault(),
      missing: repo.getById(999),
    }));
    expect(other).toEqual({ id: 1, name: 'Інше', limit_amount: null, is_default: true });
    expect(missing).toBeUndefined();
  });

  test('findByNormalizedName: без exceptId шукає всіх, з exceptId — крім себе', async () => {
    const repo = categories();
    const [any, self] = await tx.withRead(() => [
      repo.findByNormalizedName('їжа'),
      repo.findByNormalizedName('їжа', 2),
    ]);
    expect(any?.id).toBe(2);
    expect(self).toBeUndefined();
  });

  test('SQLITE_CONSTRAINT_UNIQUE на insert і update → DuplicateNameError', async () => {
    const repo = categories();
    const dup = { name: 'їжа', name_normalized: 'їжа', limit_amount: null };
    await expect(tx.withTransaction(() => repo.insert(dup))).rejects.toBeInstanceOf(
      DuplicateNameError,
    );
    await expect(tx.withTransaction(() => repo.update(3, dup))).rejects.toBeInstanceOf(
      DuplicateNameError,
    );
  });

  test('update/delete відсутньої → undefined', async () => {
    const repo = categories();
    const input = { name: 'X', name_normalized: 'x', limit_amount: null };
    expect(await tx.withTransaction(() => repo.update(999, input))).toBeUndefined();
    expect(await tx.withTransaction(() => repo.delete(999))).toBeUndefined();
  });

  test('AC 3: прямий DELETE категорії з витратами відхиляє ON DELETE RESTRICT', async () => {
    const repo = categories();
    // RESTRICT у SQLite реалізовано тригером: код TRIGGER (1811), а не FOREIGNKEY, як у db.md.
    await expect(tx.withTransaction(() => repo.delete(2))).rejects.toMatchObject({
      code: 'SQLITE_CONSTRAINT_TRIGGER',
      errno: 1811,
      message: 'FOREIGN KEY constraint failed',
    });
    expect(db.query('SELECT COUNT(*) AS n FROM categories WHERE id = 2').get().n).toBe(1);
  });

  test('limitsWithSpent: лише категорії з лімітом, сума за вікно', async () => {
    const repo = categories();
    expect(await tx.withRead(() => repo.limitsWithSpent('2026-10-07', '2026-11-05'))).toEqual([
      { category_id: 2, name: 'Їжа', limit_amount: 1000, spent: 10 },
    ]);
  });

  test('плани: C4 «Інше» за індексом; R1 (другий) — SEARCH e за expenses_category_spent_at', () => {
    expect(plan(CATEGORIES.getDefault)).toContain('USING INDEX categories_single_default');
    const r1 = plan(CATEGORIES.limitsWithSpent);
    expect(r1).toContain('SEARCH e USING INDEX expenses_category_spent_at');
    expect(r1).not.toMatch(/SCAN (e|expenses)\b/);
  });
});
