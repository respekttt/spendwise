import { describe, expect, test } from 'bun:test';
import { DuplicateNameError, ValidationError } from '../../server/core/errors.js';
import { createMemoryStore } from '../../server/repositories/memory/index.js';
import { createSeed } from '../../server/repositories/memory/seed.js';

const T = '2026-11-05';
const now = () => new Date('2026-11-05T10:00:00Z');
const newStore = () => createMemoryStore({ seed: createSeed(T), now });
/** Повний стан через публічні методи. */
const dump = (store) =>
  store.withRead(() => ({
    categories: store.categories.list(),
    expenses: store.expenses.list(),
    key: store.idempotencyKeys.find('local', 'k1'),
  }));

describe('межі транзакції (ADR 007)', () => {
  test('метод репозиторію поза межею кидає помилку', () => {
    const store = newStore();
    expect(() => store.expenses.list()).toThrow(/поза withTransaction/);
    expect(() => store.categories.getDefault()).toThrow(/поза withTransaction/);
    expect(() => store.idempotencyKeys.find('local', 'k')).toThrow(/поза withTransaction/);
  });

  test('async-функція у withTransaction → TypeError, стан незмінний', async () => {
    const store = newStore();
    const before = await dump(store);

    await expect(
      store.withTransaction(async () => {
        store.expenses.delete(1);
        store.categories.insert({ name: 'Нова', name_normalized: 'нова', limit_amount: null });
      }),
    ).rejects.toThrow(TypeError);

    expect(await dump(store)).toEqual(before);
  });

  test('async-функція у withRead → TypeError', async () => {
    const store = newStore();
    await expect(store.withRead(async () => store.expenses.list())).rejects.toThrow(TypeError);
  });

  test('продовження після await звертається до репозиторію вже поза межею', async () => {
    const store = newStore();
    let continuation;
    await expect(
      store.withTransaction(() => {
        continuation = Promise.resolve().then(() => store.expenses.list());
        return continuation;
      }),
    ).rejects.toThrow(TypeError);
    await expect(continuation).rejects.toThrow(/поза withTransaction/);
  });

  test('виняток у fn → стан ідентичний до виклику, зокрема ключі й лічильники ID', async () => {
    const store = newStore();
    const before = await dump(store);

    await expect(
      store.withTransaction(() => {
        store.expenses.moveAll(2, 1);
        store.expenses.insert({ category_id: 1, amount: 1, description: '', spent_at: T });
        store.idempotencyKeys.insert({
          initiator: 'local',
          key: 'k1',
          request_hash: 'h',
          result: { ok: true },
          created_at: now().toISOString(),
        });
        throw new Error('збій');
      }),
    ).rejects.toThrow('збій');

    expect(await dump(store)).toEqual(before);
    const created = await store.withTransaction(() =>
      store.expenses.insert({ category_id: 1, amount: 1, description: '', spent_at: T }),
    );
    expect(created.id).toBe(6);
  });

  test('withTransaction повертає результат fn', async () => {
    const store = newStore();
    expect(await store.withTransaction(() => 42)).toBe(42);
  });
});

describe('поведінка як у SQLite', () => {
  test('ID не перевикористовуються після видалення', async () => {
    const store = newStore();
    const input = { category_id: 1, amount: 1, description: '', spent_at: T };
    const first = await store.withTransaction(() => store.expenses.insert(input));
    await store.withTransaction(() => store.expenses.delete(first.id));
    const second = await store.withTransaction(() => store.expenses.insert(input));

    expect(first.id).toBe(6);
    expect(second.id).toBe(7);

    const cat = { name: 'А', name_normalized: 'а', limit_amount: null };
    const c1 = await store.withTransaction(() => store.categories.insert(cat));
    await store.withTransaction(() => store.categories.delete(c1.id));
    const c2 = await store.withTransaction(() => store.categories.insert(cat));
    expect([c1.id, c2.id]).toEqual([5, 6]);
  });

  test('created_at з годинника у форматі SQLite (UTC)', async () => {
    const store = newStore();
    const e = await store.withTransaction(() =>
      store.expenses.insert({ category_id: 1, amount: 1, description: '', spent_at: T }),
    );
    expect(e.created_at).toBe('2026-11-05 10:00:00');
  });

  test('репозиторій повертає копії: зміна відповіді не змінює сховище', async () => {
    const store = newStore();
    await store.withRead(() => {
      store.expenses.list()[0].amount = 1;
      store.categories.getById(2).name = 'Змінено';
    });
    const after = await store.withRead(() => ({
      expense: store.expenses.list()[0],
      category: store.categories.getById(2),
    }));
    expect(after.expense.amount).toBe(900.5);
    expect(after.category).toEqual({ id: 2, name: 'Їжа', limit_amount: 1000, is_default: false });
  });

  test('неіснуюча категорія витрати → ValidationError (як FOREIGN KEY)', async () => {
    const store = newStore();
    await expect(
      store.withTransaction(() =>
        store.expenses.insert({ category_id: 99, amount: 1, description: '', spent_at: T }),
      ),
    ).rejects.toThrow(ValidationError);
  });

  test('дублікат name_normalized → DuplicateNameError (як UNIQUE)', async () => {
    const store = newStore();
    await expect(
      store.withTransaction(() =>
        store.categories.insert({ name: 'їжа', name_normalized: 'їжа', limit_amount: null }),
      ),
    ).rejects.toThrow(DuplicateNameError);
  });

  test('без набору створюється лише «Інше»', async () => {
    const store = createMemoryStore();
    const categories = await store.withRead(() => store.categories.list());
    expect(categories).toEqual([{ id: 1, name: 'Інше', limit_amount: null, is_default: true }]);
  });
});

describe('статичний набір', () => {
  test('дати від today, вікно 30 днів', async () => {
    const store = newStore();
    const expenses = await store.withRead(() => store.expenses.list());
    expect(expenses.map((e) => [e.id, e.spent_at])).toEqual([
      [1, '2026-11-05'],
      [3, '2026-10-31'],
      [5, '2026-10-26'],
      [2, '2026-10-07'],
      [4, '2026-10-06'],
    ]);
    const food = await store.withRead(() => store.expenses.sumForCategory(2, '2026-10-07', T));
    expect(food).toBe(1020.5);
  });
});
