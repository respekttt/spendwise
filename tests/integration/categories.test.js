import { afterEach, describe, expect, test } from 'bun:test';
import { createTestApp, expectError, STORAGES } from '../helpers/index.js';

describe.each(STORAGES)('%s', (storage) => {
  // Сценарії 3, 4; AC 3 (без ON DELETE RESTRICT), AC 4, AC 13 на in-memory і SQLite сховищах (AC 15, 16).

  let app;
  let store;
  afterEach(() => app?.close());

  function start(options) {
    ({ app, store } = createTestApp({ storage, ...options }));
  }
  const req = (method, url, payload) => app.inject({ method, url, payload });
  const names = async () => (await req('GET', '/categories')).json().map((c) => c.name);
  const snapshot = async () => ({
    categories: (await req('GET', '/categories')).json(),
    expenses: (await req('GET', '/expenses')).json(),
  });
  const totalAmount = (expenses) => expenses.reduce((sum, e) => sum + e.amount, 0);

  describe('GET /categories', () => {
    test('AC 4: абетка uk, «Авто» перед «Їжа», «Інше» остання', async () => {
      start();
      await req('POST', '/categories', { name: 'Авто' });
      const res = await req('GET', '/categories');

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toStartWith('application/json');
      expect(await names()).toEqual(['Авто', 'Їжа', 'Розваги', 'Транспорт', 'Інше']);
      expect(res.json().at(-1)).toEqual({
        id: 1,
        name: 'Інше',
        limit_amount: null,
        is_default: true,
      });
    });
  });

  describe('POST /categories', () => {
    test('201: категорія за контрактом, назва після trim', async () => {
      start();
      const res = await req('POST', '/categories', { name: '  Авто ', limit_amount: 500 });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toEqual({
        category: { id: 5, name: 'Авто', limit_amount: 500, is_default: false },
      });
    });

    for (const [name, body] of [
      ['"інше"', { name: 'інше' }],
      ['" Інше "', { name: ' Інше ' }],
      ['"їжа" (є "Їжа")', { name: 'їжа' }],
      ['"  ЇЖА "', { name: '  ЇЖА ' }],
      ['""', { name: '' }],
      ['"   "', { name: '   ' }],
      ['51 символ', { name: 'А'.repeat(51) }],
      ['is_default у тілі', { name: 'Авто', is_default: false }],
      ['limit_amount 0', { name: 'Авто', limit_amount: 0 }],
      ['limit_amount рядком', { name: 'Авто', limit_amount: '10' }],
    ]) {
      test(`AC 4, 6: ${name} → 400, дані не змінюються`, async () => {
        start();
        const before = await snapshot();
        expectError(expect, await req('POST', '/categories', body), 400);
        expect(await snapshot()).toEqual(before);
      });
    }

    test('назва в NFD — дублікат тієї самої в NFC', async () => {
      start();
      await req('POST', '/categories', { name: 'Мийка' });
      expectError(
        expect,
        await req('POST', '/categories', { name: 'Мийка'.normalize('NFD') }),
        400,
      );
    });

    test('апострофи різні — різні назви', async () => {
      start();
      expect((await req('POST', '/categories', { name: "Кав'ярня" })).statusCode).toBe(201);
      expect((await req('POST', '/categories', { name: 'Кавʼярня' })).statusCode).toBe(201);
    });
  });

  describe('PUT /categories/:id', () => {
    test('AC 4: "Їжа" → "їжа" тієї ж категорії — 200; перевищення лишається в warning', async () => {
      start();
      const res = await req('PUT', '/categories/2', { name: 'їжа', limit_amount: 1000 });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        category: { id: 2, name: 'їжа', limit_amount: 1000, is_default: false },
        warning: { category_id: 2, limit_amount: 1000, spent: 1020.5, exceeded_by: 20.5 },
      });
    });

    test('сценарій 3, AC 1: зниження ліміту понад поріг → 200 з warning; рівно на ліміті — без', async () => {
      start();
      const lowered = await req('PUT', '/categories/3', { name: 'Транспорт', limit_amount: 299 });
      expect(lowered.json().warning).toEqual({
        category_id: 3,
        limit_amount: 299,
        spent: 300,
        exceeded_by: 1,
      });
      const exact = await req('PUT', '/categories/3', { name: 'Транспорт', limit_amount: 300 });
      expect(exact.json()).not.toContainKey('warning');
    });

    test('повна заміна: відсутній limit_amount знімає ліміт', async () => {
      start();
      const res = await req('PUT', '/categories/2', { name: 'Їжа' });
      expect(res.json()).toEqual({
        category: { id: 2, name: 'Їжа', limit_amount: null, is_default: false },
      });
    });

    test('AC 4: перейменування на назву іншої категорії → 400', async () => {
      start();
      expectError(expect, await req('PUT', '/categories/3', { name: ' їжа ' }), 400);
    });

    for (const body of [{ name: 'Інше' }, { name: 'Інше', limit_amount: 10 }, { name: 'Різне' }]) {
      test(`AC 4: будь-який PUT «Інше» ${JSON.stringify(body)} → 400`, async () => {
        start();
        expectError(expect, await req('PUT', '/categories/1', body), 400);
      });
    }

    test('неіснуючий або нечисловий :id → 404', async () => {
      start();
      expectError(expect, await req('PUT', '/categories/999', { name: 'X' }), 404);
      expectError(expect, await req('PUT', '/categories/abc', { name: 'X' }), 404);
    });
  });

  describe('DELETE /categories/:id', () => {
    test('сценарій 4, AC 3: витрати в «Інше», загальна сума незмінна, moved_expenses', async () => {
      start();
      const before = (await req('GET', '/expenses')).json();
      const res = await req('DELETE', '/categories/2');

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        category: { id: 2, name: 'Їжа', limit_amount: 1000, is_default: false },
        moved_expenses: 2,
      });
      const after = (await req('GET', '/expenses')).json();
      expect(after.filter((e) => e.category_id === 2)).toEqual([]);
      expect(after.filter((e) => [1, 2].includes(e.id)).map((e) => e.category_id)).toEqual([1, 1]);
      expect(totalAmount(after)).toBe(totalAmount(before));
      expect(await names()).not.toContain('Їжа');
      expectError(expect, await req('DELETE', '/categories/2'), 404);
    });

    test('категорія без витрат → moved_expenses: 0', async () => {
      start();
      const { category } = (await req('POST', '/categories', { name: 'Порожня' })).json();
      const res = await req('DELETE', `/categories/${category.id}`);
      expect(res.json().moved_expenses).toBe(0);
    });

    test('AC 4: DELETE «Інше» → 400; неіснуюча або нечислова → 404', async () => {
      start();
      expectError(expect, await req('DELETE', '/categories/1'), 400);
      expectError(expect, await req('DELETE', '/categories/999'), 404);
      expectError(expect, await req('DELETE', '/categories/abc'), 404);
    });

    test('AC 3, AC 13: виняток між перенесенням і видаленням → 500, стан ідентичний', async () => {
      start();
      const before = await snapshot();
      store.categories.delete = () => {
        throw new Error('збій між кроками');
      };

      const res = await req('DELETE', '/categories/2');

      expectError(expect, res, 500);
      expect(res.json()).toEqual({ error: 'Внутрішня помилка сервера' });
      expect(await snapshot()).toEqual(before);
    });
  });
});
