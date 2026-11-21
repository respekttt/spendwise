import { afterEach, describe, expect, test } from 'bun:test';
import { addDays } from '../../server/core/time.js';
import { createTestApp, expectError, STORAGES, T } from '../helpers/index.js';

describe.each(STORAGES)('%s', (storage) => {
  // Сценарії 1, 2, 6; AC 1, 2, 5, 6 на in-memory і SQLite сховищах (AC 15, 16) (AC 15).

  let app;
  afterEach(() => app?.close());

  /** Застосунок зі статичним набором або власним `seed`. */
  function start(options) {
    ({ app } = createTestApp({ storage, ...options }));
    return app;
  }
  const post = (payload, headers) =>
    app.inject({ method: 'POST', url: '/expenses', payload, headers });
  const put = (id, payload) => app.inject({ method: 'PUT', url: `/expenses/${id}`, payload });
  const list = async () => (await app.inject({ method: 'GET', url: '/expenses' })).json();

  /** Одна категорія з лімітом і, за потреби, витрати в ній. */
  const limitSeed = (limit_amount, expenses = []) => ({
    categories: [
      { id: 1, name: 'Інше', limit_amount: null, is_default: true },
      { id: 2, name: 'Ліміт', limit_amount, is_default: false },
    ],
    expenses: expenses.map((e, i) => ({ id: i + 1, category_id: 2, ...e })),
  });

  describe('POST /expenses', () => {
    test('201: тіло за контрактом, created_at з годинника, без warning без ліміту', async () => {
      start();
      const res = await post({ category_id: 4, amount: 12.345, spent_at: T });

      expect(res.statusCode).toBe(201);
      expect(res.headers['content-type']).toStartWith('application/json');
      expect(res.json()).toEqual({
        expense: {
          id: 6,
          category_id: 4,
          amount: 12.35,
          description: '',
          spent_at: T,
          created_at: '2026-11-05 10:00:00',
        },
      });
    });

    test('AC 1: перевищення зберігає витрату й повертає warning', async () => {
      start();
      const res = await post({ category_id: 2, amount: 10, spent_at: T, description: 'Кава' });

      expect(res.statusCode).toBe(201);
      expect(res.json().warning).toEqual({
        category_id: 2,
        limit_amount: 1000,
        spent: 1030.5,
        exceeded_by: 30.5,
      });
      expect((await list()).length).toBe(6);
    });

    test('AC 1: рівно на ліміті warning немає, на копійку більше — є', async () => {
      start({ seed: limitSeed(100) });
      const exact = await post({ category_id: 2, amount: 100, spent_at: T });
      expect(exact.json()).not.toContainKey('warning');

      const over = await post({ category_id: 2, amount: 0.01, spent_at: T });
      expect(over.json().warning).toEqual({
        category_id: 2,
        limit_amount: 100,
        spent: 100.01,
        exceeded_by: 0.01,
      });
    });

    test('AC 2: 0.10 + 0.20 за ліміту 0.30 — без warning', async () => {
      start({ seed: limitSeed(0.3) });
      await post({ category_id: 2, amount: 0.1, spent_at: T });
      const res = await post({ category_id: 2, amount: 0.2, spent_at: T });
      expect(res.statusCode).toBe(201);
      expect(res.json()).not.toContainKey('warning');
    });

    test('AC 5: T - 29 і T у вікні ліміту, T - 30 — ні', async () => {
      start({ seed: limitSeed(100, [{ amount: 100, spent_at: addDays(T, -30) }]) });
      const edge = await post({ category_id: 2, amount: 100, spent_at: addDays(T, -29) });
      expect(edge.json()).not.toContainKey('warning');

      const today = await post({ category_id: 2, amount: 0.01, spent_at: T });
      expect(today.json().warning.spent).toBe(100.01);
    });

    test('AC 5: межа доби в Києві — літо 201, зима 400', async () => {
      start({ now: () => new Date('2026-07-15T21:30:00Z') });
      expect((await post({ category_id: 1, amount: 1, spent_at: '2026-07-16' })).statusCode).toBe(
        201,
      );
      await app.close();

      start({ now: () => new Date('2026-01-15T21:30:00Z') });
      expectError(expect, await post({ category_id: 1, amount: 1, spent_at: '2026-01-16' }), 400);
    });

    const valid = { category_id: 1, amount: 10, spent_at: T };
    for (const [name, body] of [
      ['amount 0', { ...valid, amount: 0 }],
      ['amount -5', { ...valid, amount: -5 }],
      ['amount 0.004', { ...valid, amount: 0.004 }],
      ['amount "12.5"', { ...valid, amount: '12.5' }],
      ['amount 1e308', { ...valid, amount: 1e308 }],
      ['amount 1000000000.01', { ...valid, amount: 1_000_000_000.01 }],
      ['amount null', { ...valid, amount: null }],
      ['amount відсутній', { category_id: 1, spent_at: T }],
      ['неіснуючий category_id', { ...valid, category_id: 999 }],
      ['category_id рядком', { ...valid, category_id: '1' }],
      ['опис з 501 символу', { ...valid, description: 'x'.repeat(501) }],
      ['опис не рядок', { ...valid, description: 5 }],
      ['дата 2026-02-30', { ...valid, spent_at: '2026-02-30' }],
      ['дата 2026-2-3', { ...valid, spent_at: '2026-2-3' }],
      ['дата 03.02.2026', { ...valid, spent_at: '03.02.2026' }],
      ['дата T + 1', { ...valid, spent_at: addDays(T, 1) }],
      ['тіло-масив', [valid]],
    ]) {
      test(`AC 6: ${name} → 400, дані не змінюються`, async () => {
        start();
        const before = await list();
        expectError(expect, await post(body), 400);
        expect(await list()).toEqual(before);
      });
    }

    test('AC 6: опис рівно 500 символів приймається', async () => {
      start();
      expect((await post({ ...valid, description: 'x'.repeat(500) })).statusCode).toBe(201);
    });

    test('без тіла → 400', async () => {
      start();
      expectError(expect, await app.inject({ method: 'POST', url: '/expenses' }), 400);
    });
  });

  describe('PUT /expenses/:id', () => {
    test('сценарій 1, AC 1: перенесення в іншу категорію — warning для нової', async () => {
      start();
      const res = await put(5, { category_id: 3, amount: 99.99, spent_at: addDays(T, -10) });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        expense: {
          id: 5,
          category_id: 3,
          amount: 99.99,
          description: '',
          spent_at: addDays(T, -10),
          created_at: '2026-11-05 10:00:00',
        },
        warning: { category_id: 3, limit_amount: 300, spent: 399.99, exceeded_by: 99.99 },
      });
    });

    test('повна заміна: відсутній description стає ""', async () => {
      start();
      const res = await put(1, { category_id: 4, amount: 5, spent_at: T });
      expect(res.json()).toEqual({ expense: expect.objectContaining({ description: '' }) });
    });

    test('AC 6: PUT /expenses/999 → 404', async () => {
      start();
      expectError(expect, await put(999, { category_id: 1, amount: 1, spent_at: T }), 404);
    });

    test('неіснуючий :id з неіснуючою категорією → 400, а не 404', async () => {
      start();
      expectError(expect, await put(999, { category_id: 999, amount: 1, spent_at: T }), 400);
    });

    test('невалідне тіло → 400, витрата не змінюється', async () => {
      start();
      const before = await list();
      expectError(expect, await put(1, { category_id: 2, amount: 0, spent_at: T }), 400);
      expect(await list()).toEqual(before);
    });

    for (const id of ['abc', '0', '1.5']) {
      test(`/expenses/${id} → 404`, async () => {
        start();
        expectError(expect, await put(id, { category_id: 1, amount: 1, spent_at: T }), 404);
      });
    }
  });

  describe('GET і DELETE /expenses', () => {
    test('GET: нові спочатку (spent_at DESC, id DESC)', async () => {
      start();
      await post({ category_id: 1, amount: 1, spent_at: T });
      const ids = (await list()).map((e) => e.id);
      expect(ids).toEqual([6, 1, 3, 5, 2, 4]);
    });

    test('сценарій 2: DELETE повертає видалену; повторний DELETE → 404', async () => {
      start();
      const res = await app.inject({ method: 'DELETE', url: '/expenses/3' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        expense: {
          id: 3,
          category_id: 3,
          amount: 300,
          description: 'Проїзний',
          spent_at: addDays(T, -5),
          created_at: '2026-11-05 10:00:00',
        },
      });
      expect((await list()).map((e) => e.id)).not.toContain(3);
      expectError(expect, await app.inject({ method: 'DELETE', url: '/expenses/3' }), 404);
    });

    test('AC 6: DELETE /expenses/abc → 404', async () => {
      start();
      expectError(expect, await app.inject({ method: 'DELETE', url: '/expenses/abc' }), 404);
    });
  });
});
