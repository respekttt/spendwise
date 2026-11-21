import { afterEach, describe, expect, test } from 'bun:test';
import { createTestApp, expectError, STORAGES } from '../helpers/index.js';

describe.each(STORAGES)('%s', (storage) => {
  // AC 2, 5, 7 на in-memory і SQLite сховищах (AC 15, 16); T = 2026-11-05.

  let app;
  afterEach(() => app?.close());

  const get = (url) => app.inject({ method: 'GET', url });
  const empty = { categories: [{ id: 1, name: 'Інше', limit_amount: null, is_default: true }] };

  describe('GET /reports/last-30-days', () => {
    test('AC 7: поля за контрактом на статичному наборі', async () => {
      ({ app } = createTestApp({ storage }));
      const res = await get('/reports/last-30-days');

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toStartWith('application/json');
      // Витрата 4 (T - 30) поза вікном, витрата 2 (T - 29) — на межі всередині.
      expect(res.json()).toEqual({
        from: '2026-10-07',
        to: '2026-11-05',
        total: 1420.49,
        categories: [
          { category_id: 2, name: 'Їжа', total: 1020.5, share: 71.84 },
          { category_id: 3, name: 'Транспорт', total: 300, share: 21.12 },
          { category_id: 1, name: 'Інше', total: 99.99, share: 7.04 },
        ],
        limits: [
          {
            category_id: 2,
            name: 'Їжа',
            limit_amount: 1000,
            spent: 1020.5,
            remaining: 0,
            exceeded_by: 20.5,
          },
          {
            category_id: 3,
            name: 'Транспорт',
            limit_amount: 300,
            spent: 300,
            remaining: 0,
            exceeded_by: 0,
          },
        ],
      });
    });

    test('AC 7: період без витрат — total 0, categories [], ліміти зі spent 0', async () => {
      ({ app } = createTestApp({
        storage,
        seed: { categories: [...empty.categories, { id: 2, name: 'Авто', limit_amount: 50 }] },
      }));
      expect((await get('/reports/last-30-days')).json()).toEqual({
        from: '2026-10-07',
        to: '2026-11-05',
        total: 0,
        categories: [],
        limits: [
          {
            category_id: 2,
            name: 'Авто',
            limit_amount: 50,
            spent: 0,
            remaining: 50,
            exceeded_by: 0,
          },
        ],
      });
    });

    test('AC 2: 0.10 + 0.20 у звіті дає 0.30', async () => {
      ({ app } = createTestApp({ storage, seed: empty }));
      for (const amount of [0.1, 0.2]) {
        await app.inject({
          method: 'POST',
          url: '/expenses',
          payload: { category_id: 1, amount, spent_at: '2026-11-05' },
        });
      }
      const report = (await get('/reports/last-30-days')).json();
      expect(report.total).toBe(0.3);
      expect(report.categories[0]).toEqual({
        category_id: 1,
        name: 'Інше',
        total: 0.3,
        share: 100,
      });
    });
  });

  describe('GET /reports/monthly', () => {
    test('AC 5, 7: T - 30 входить у місячний звіт свого місяця; полів лімітів немає', async () => {
      ({ app } = createTestApp({ storage }));
      const res = await get('/reports/monthly?month=2026-10');

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        month: '2026-10',
        total: 969.99,
        categories: [
          { category_id: 4, name: 'Розваги', total: 450, share: 46.39 },
          { category_id: 3, name: 'Транспорт', total: 300, share: 30.93 },
          { category_id: 2, name: 'Їжа', total: 120, share: 12.37 },
          { category_id: 1, name: 'Інше', total: 99.99, share: 10.31 },
        ],
      });
      const raw = res.body;
      for (const field of ['limits', 'limit_amount', 'spent', 'remaining', 'exceeded_by']) {
        expect(raw).not.toContain(field);
      }
    });

    test('поточний місяць і порожній місяць', async () => {
      ({ app } = createTestApp({ storage }));
      expect((await get('/reports/monthly?month=2026-11')).json()).toEqual({
        month: '2026-11',
        total: 900.5,
        categories: [{ category_id: 2, name: 'Їжа', total: 900.5, share: 100 }],
      });
      expect((await get('/reports/monthly?month=2025-01')).json()).toEqual({
        month: '2025-01',
        total: 0,
        categories: [],
      });
    });

    for (const query of ['?month=2026-13', '?month=2026-1', '?month=2026-12', '', '?month=']) {
      test(`AC 6: /reports/monthly${query} → 400`, async () => {
        ({ app } = createTestApp({ storage }));
        expectError(expect, await get(`/reports/monthly${query}`), 400);
      });
    }
  });
});
