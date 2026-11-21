import { afterEach, describe, expect, test } from 'bun:test';
import { openDb } from '../../server/db/index.js';
import { createTestApp, T } from '../helpers/index.js';

// AC 14 (ADR 008, «Підрахунок запитів»): звіти для 1 і 20 категорій виконують однакову кількість SQL.

const EXECUTE = new Set(['all', 'get', 'run', 'values', 'iterate']);
const bind = (target, value) => (typeof value === 'function' ? value.bind(target) : value);

/** Обгортка над Database: statement-проксі з query/prepare рахують кожне виконання. */
function countingDb(db) {
  const counter = { executed: 0 };
  const statement = (stmt) =>
    new Proxy(stmt, {
      get(target, prop) {
        const value = Reflect.get(target, prop);
        if (!EXECUTE.has(prop)) return bind(target, value);
        return (...args) => {
          counter.executed++;
          return value.apply(target, args);
        };
      },
    });
  const proxy = new Proxy(db, {
    get(target, prop) {
      if (prop === 'query' || prop === 'prepare') return (sql) => statement(target[prop](sql));
      return bind(target, Reflect.get(target, prop));
    },
  });
  return { db: proxy, counter };
}

/** `n` категорій з лімітом, у кожній одна витрата в поточному місяці. */
const seedOf = (n) => {
  const categories = [{ id: 1, name: 'Інше', limit_amount: null, is_default: true }];
  const expenses = [];
  for (let i = 0; i < n; i++) {
    categories.push({ id: i + 2, name: `Категорія ${i}`, limit_amount: 100 });
    expenses.push({ id: i + 1, category_id: i + 2, amount: 10, spent_at: T });
  }
  return { categories, expenses };
};

let raw;
let app;
afterEach(async () => {
  await app.close();
  raw.close();
});

/** Скільки statement-ів виконав один GET. */
async function executedFor(n, url) {
  raw = openDb(':memory:');
  const counting = countingDb(raw);
  ({ app } = createTestApp({ storage: 'sqlite', db: counting.db, seed: seedOf(n) }));
  const before = counting.counter.executed;
  const res = await app.inject({ method: 'GET', url });
  expect(res.statusCode).toBe(200);
  // Звіт справді бачить усі категорії, тобто підрахунок не на порожніх даних.
  expect(res.json().categories).toHaveLength(n);
  return counting.counter.executed - before;
}

describe('AC 14: без N+1', () => {
  test('R1 /reports/last-30-days: 2 запити для 1 і для 20 категорій', async () => {
    expect(await executedFor(1, '/reports/last-30-days')).toBe(2);
    await app.close();
    raw.close();
    expect(await executedFor(20, '/reports/last-30-days')).toBe(2);
  });

  test('R2 /reports/monthly: 1 запит для 1 і для 20 категорій', async () => {
    expect(await executedFor(1, '/reports/monthly?month=2026-11')).toBe(1);
    await app.close();
    raw.close();
    expect(await executedFor(20, '/reports/monthly?month=2026-11')).toBe(1);
  });

  test('лічильник бачить кешований statement повторно (самоперевірка)', () => {
    raw = openDb(':memory:');
    const { db, counter } = countingDb(raw);
    app = { close: async () => {} };
    db.query('SELECT 1').get();
    db.query('SELECT 1').get();
    db.prepare('SELECT 2').all();
    expect(counter.executed).toBe(3);
  });
});
