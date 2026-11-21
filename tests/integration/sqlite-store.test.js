import { afterEach, describe, expect, test } from 'bun:test';
import { createSeed } from '../../server/repositories/memory/seed.js';
import { createTestApp, createTestStore, expectError, T } from '../helpers/index.js';

// SQLite-сховище: межі ADR 007, переклад помилок через HTTP (db.md), форма логів як у in-memory (ADR 009).

const seed = createSeed(T);
const dump = (store) =>
  store.withRead(() => ({
    categories: store.categories.list(),
    expenses: store.expenses.list(),
  }));

describe('межі транзакції SQLite-сховища (ADR 007)', () => {
  test('метод репозиторію поза межею кидає помилку', () => {
    const { store, db } = createTestStore({ storage: 'sqlite', seed });
    expect(() => store.expenses.list()).toThrow(/поза withTransaction/);
    expect(() => store.categories.getDefault()).toThrow(/поза withTransaction/);
    expect(() => store.idempotencyKeys.find('local', 'k')).toThrow(/поза withTransaction/);
    db.close();
  });

  test('AC 16: async-функція у withTransaction → TypeError, стан незмінний', async () => {
    const { store, db } = createTestStore({ storage: 'sqlite', seed });
    const before = await dump(store);
    await expect(
      store.withTransaction(async () => {
        store.expenses.delete(1);
        store.categories.insert({ name: 'Нова', name_normalized: 'нова', limit_amount: null });
      }),
    ).rejects.toThrow(TypeError);
    expect(await dump(store)).toEqual(before);
    db.close();
  });

  test('продовження після await звертається до репозиторію вже поза межею', async () => {
    const { store, db } = createTestStore({ storage: 'sqlite', seed });
    let continuation;
    await expect(
      store.withTransaction(() => {
        continuation = Promise.resolve().then(() => store.expenses.list());
        return continuation;
      }),
    ).rejects.toThrow(TypeError);
    await expect(continuation).rejects.toThrow(/поза withTransaction/);
    db.close();
  });

  test('набір: ID і created_at такі самі, як у in-memory', async () => {
    const memory = createTestStore({ storage: 'memory', seed }).store;
    const { store, db } = createTestStore({ storage: 'sqlite', seed });
    expect(await dump(store)).toEqual(await dump(memory));
    db.close();
  });
});

describe('переклад помилок SQLite через HTTP (db.md, «Помилки БД»)', () => {
  let app;
  afterEach(() => app?.close());

  test('перевірка дубліката нічого не знаходить → INSERT падає з UNIQUE → 400', async () => {
    const started = createTestApp({ storage: 'sqlite', level: 'info' });
    app = started.app;
    started.store.categories.findByNormalizedName = () => undefined;

    const res = await app.inject({ method: 'POST', url: '/categories', payload: { name: 'їжа' } });
    expectError(expect, res, 400);
    expect(started.records).toContainEqual(
      expect.objectContaining({
        msg: 'db operation failed',
        method: 'insert',
        err: 'DuplicateNameError',
      }),
    );
    const update = await app.inject({
      method: 'PUT',
      url: '/categories/3',
      payload: { name: 'Їжа' },
    });
    expectError(expect, update, 400);
  });

  test('перевірка категорії пропущена → INSERT/UPDATE падає з FOREIGNKEY → 400', async () => {
    const started = createTestApp({ storage: 'sqlite' });
    app = started.app;
    // Сервіс (services/expenses.js, save) перевіряє категорію раніше; підміна пропускає її до SQL.
    started.store.categories.getById = () => ({ id: 999, limit_amount: null });

    const payload = { category_id: 999, amount: 1, spent_at: T };
    expectError(expect, await app.inject({ method: 'POST', url: '/expenses', payload }), 400);
    expectError(expect, await app.inject({ method: 'PUT', url: '/expenses/1', payload }), 400);
  });

  test('RESTRICT спрацював (перенесення пропущено) → 500, стан незмінний', async () => {
    const started = createTestApp({ storage: 'sqlite' });
    app = started.app;
    const before = await dump(started.store);
    started.store.expenses.moveAll = () => 0;

    expectError(expect, await app.inject({ method: 'DELETE', url: '/categories/2' }), 500);
    expect(await dump(started.store)).toEqual(before);
  });
});

describe('логи операцій БД однакові на обох сховищах (ADR 009)', () => {
  test('ті самі repo, method і result для однакового сценарію', async () => {
    const run = async (storage) => {
      const { app, records } = createTestApp({ storage, level: 'info' });
      const requests = [
        ['POST', '/expenses', { category_id: 2, amount: 5, spent_at: T }],
        ['PUT', '/expenses/1', { category_id: 3, amount: 5, spent_at: T }],
        ['DELETE', '/categories/4'],
        ['GET', '/reports/last-30-days'],
        ['GET', '/reports/monthly?month=2026-10'],
        ['DELETE', '/expenses/999'],
      ];
      for (const [method, url, payload] of requests) await app.inject({ method, url, payload });
      await app.close();
      return records
        .filter((r) => r.msg?.startsWith('db operation'))
        .map(({ level, msg, repo, method, result, err }) => ({
          level,
          msg,
          repo,
          method,
          result,
          err,
        }));
    };
    const memory = await run('memory');
    expect(memory.length).toBeGreaterThan(10);
    expect(await run('sqlite')).toEqual(memory);
  });
});
