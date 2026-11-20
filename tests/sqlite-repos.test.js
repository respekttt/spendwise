import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { DuplicateNameError, ValidationError } from '../server/core/errors.js';
import { openDb } from '../server/db/index.js';
import { createTransactions } from '../server/db/transaction.js';
import {
  SQL as CATEGORIES,
  createCategoriesRepo,
} from '../server/repositories/sqlite/categories.js';
import { createExpensesRepo, SQL as EXPENSES } from '../server/repositories/sqlite/expenses.js';
import {
  createIdempotencyKeysRepo,
  SQL as IDEMPOTENCY,
} from '../server/repositories/sqlite/idempotency-keys.js';

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

describe('sqlite/expenses', () => {
  const now = () => new Date('2026-11-05T10:00:00Z');
  const expenses = () => createExpensesRepo(db, now);
  const input = { category_id: 3, amount: 1.5, description: '', spent_at: '2026-11-05' };

  test('insert: created_at з інжектованого годинника у форматі SQLite (E2)', async () => {
    const repo = expenses();
    expect(await tx.withTransaction(() => repo.insert(input))).toEqual({
      id: 4,
      ...input,
      created_at: '2026-11-05 10:00:00',
    });
  });

  test('SQLITE_CONSTRAINT_FOREIGNKEY на insert і update → ValidationError', async () => {
    const repo = expenses();
    const bad = { ...input, category_id: 999 };
    await expect(tx.withTransaction(() => repo.insert(bad))).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(tx.withTransaction(() => repo.update(1, bad))).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  test('update/delete відсутньої → undefined; порожня сума → 0; moveAll → кількість', async () => {
    const repo = expenses();
    expect(await tx.withTransaction(() => repo.update(999, input))).toBeUndefined();
    expect(await tx.withTransaction(() => repo.delete(999))).toBeUndefined();
    expect(await tx.withRead(() => repo.sumForCategory(3, '2020-01-01', '2020-01-31'))).toBe(0);
    expect(await tx.withTransaction(() => repo.moveAll(2, 1))).toBe(2);
  });

  test('list: spent_at DESC, id DESC; totalsByCategory з назвами за період', async () => {
    const repo = expenses();
    const { list, totals } = await tx.withRead(() => ({
      list: repo.list().map((e) => e.id),
      totals: repo.totalsByCategory('2026-11-01', '2026-11-30'),
    }));
    expect(list).toEqual([3, 1, 2]);
    expect(totals).toEqual([
      { category_id: 2, name: 'Їжа', total: 10 },
      { category_id: 3, name: 'Транспорт', total: 7 },
    ]);
  });

  test('план E1: зворотний обхід expenses_spent_at без TEMP B-TREE', () => {
    const e1 = plan(EXPENSES.list);
    expect(e1).toContain('SCAN expenses USING INDEX expenses_spent_at');
    expect(e1).not.toContain('USE TEMP B-TREE FOR ORDER BY');
  });

  test('плани E2 (сума), R1/R2 (суми за категоріями), C4 (перенесення) — за індексом', () => {
    for (const sql of [EXPENSES.sumForCategory, EXPENSES.totalsByCategory, EXPENSES.moveAll]) {
      const detail = plan(sql);
      expect(detail).toMatch(/USING (COVERING )?INDEX expenses_/);
      expect(detail).not.toMatch(/SCAN (e|expenses)\b/);
    }
    expect(plan(EXPENSES.sumForCategory)).toContain('expenses_category_spent_at');
    expect(plan(EXPENSES.totalsByCategory)).toContain('SEARCH e USING INDEX expenses_spent_at');
    expect(plan(EXPENSES.moveAll)).toContain('expenses_category_spent_at (category_id=?)');
  });
});

describe('sqlite/idempotency-keys', () => {
  const keys = () => createIdempotencyKeysRepo(db);
  const row = (key, created_at) => ({
    initiator: 'local',
    key,
    request_hash: 'a'.repeat(64),
    result: { expense: { id: 1 }, spent: 0.3 },
    created_at,
  });

  test('insert → find повертає розібраний знімок; чужий ініціатор не бачить', async () => {
    const repo = keys();
    await tx.withTransaction(() => repo.insert(row('k', '2026-11-05T10:00:00.000Z')));
    const [mine, other] = await tx.withRead(() => [repo.find('local', 'k'), repo.find('bob', 'k')]);
    expect(mine).toEqual({
      request_hash: 'a'.repeat(64),
      result: { expense: { id: 1 }, spent: 0.3 },
    });
    expect(other).toBeUndefined();
  });

  test('deleteOlderThan: строго менші за cutoff, повертає кількість', async () => {
    const repo = keys();
    await tx.withTransaction(() => {
      repo.insert(row('old', '2026-11-04T09:59:59.999Z'));
      repo.insert(row('edge', '2026-11-04T10:00:00.000Z'));
    });
    expect(await tx.withTransaction(() => repo.deleteOlderThan('2026-11-04T10:00:00.000Z'))).toBe(
      1,
    );
    expect(await tx.withRead(() => repo.find('local', 'edge'))).toBeDefined();
  });

  test('повторний PRIMARY KEY не перекладається (баг, 500)', async () => {
    const repo = keys();
    await tx.withTransaction(() => repo.insert(row('k', '2026-11-05T10:00:00.000Z')));
    await expect(
      tx.withTransaction(() => repo.insert(row('k', '2026-11-05T10:00:00.000Z'))),
    ).rejects.toMatchObject({ code: 'SQLITE_CONSTRAINT_PRIMARYKEY' });
  });

  test('плани I: пошук за PK, видалення за idempotency_keys_created_at', () => {
    expect(plan(IDEMPOTENCY.find)).toContain('USING PRIMARY KEY');
    expect(plan(IDEMPOTENCY.deleteOlderThan)).toContain('USING INDEX idempotency_keys_created_at');
  });
});
