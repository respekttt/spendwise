import { ValidationError } from '../../core/errors.js';
import { sqliteTimestamp } from '../../core/time.js';

const inRange = (e, from, to) => e.spent_at >= from && e.spent_at <= to;

/** @param {{ enter: (repo: string, method: string) => any, now: () => Date }} db */
export function createExpensesRepo(db) {
  const enter = (method) => db.enter('expenses', method);
  // Як FOREIGN KEY у SQLite (db.md, «Помилки БД»).
  const assertCategory = (state, category_id) => {
    if (!state.categories.some((c) => c.id === category_id)) {
      throw new ValidationError('category_id: категорію не знайдено');
    }
  };

  return {
    /** Нові спочатку: `spent_at` DESC, `id` DESC (E1). @returns {import('../../models.js').Expense[]} */
    list() {
      return enter('list')
        .expenses.map((e) => ({ ...e }))
        .sort((a, b) => b.spent_at.localeCompare(a.spent_at) || b.id - a.id);
    },
    /** @returns {import('../../models.js').Expense} */
    insert({ category_id, amount, description, spent_at }) {
      const state = enter('insert');
      assertCategory(state, category_id);
      const row = {
        id: ++state.lastId.expenses,
        category_id,
        amount,
        description,
        spent_at,
        created_at: sqliteTimestamp(db.now()),
      };
      state.expenses.push(row);
      return { ...row };
    },
    /** @returns {import('../../models.js').Expense | undefined} оновлена витрата або `undefined`, якщо її немає */
    update(id, { category_id, amount, description, spent_at }) {
      const state = enter('update');
      const row = state.expenses.find((e) => e.id === id);
      if (!row) return undefined;
      assertCategory(state, category_id);
      Object.assign(row, { category_id, amount, description, spent_at });
      return { ...row };
    },
    /** @returns {import('../../models.js').Expense | undefined} видалена витрата або `undefined` */
    delete(id) {
      const state = enter('delete');
      const index = state.expenses.findIndex((e) => e.id === id);
      if (index === -1) return undefined;
      return { ...state.expenses.splice(index, 1)[0] };
    },
    /** Сума категорії за `[from, to]`, не округлена (E2, E3, C3). */
    sumForCategory(category_id, from, to) {
      return enter('sumForCategory')
        .expenses.filter((e) => e.category_id === category_id && inRange(e, from, to))
        .reduce((sum, e) => sum + e.amount, 0);
    },
    /** Переносить усі витрати категорії; повертає кількість перенесених (C4). */
    moveAll(fromCategoryId, toCategoryId) {
      const moved = enter('moveAll').expenses.filter((e) => e.category_id === fromCategoryId);
      for (const e of moved) e.category_id = toCategoryId;
      return moved.length;
    },
    /** Суми за категоріями з назвами за `[from, to]` (R1, R2), без певного порядку. */
    totalsByCategory(from, to) {
      const state = enter('totalsByCategory');
      const totals = new Map();
      for (const e of state.expenses) {
        if (inRange(e, from, to))
          totals.set(e.category_id, (totals.get(e.category_id) ?? 0) + e.amount);
      }
      return [...totals].map(([category_id, total]) => ({
        category_id,
        name: state.categories.find((c) => c.id === category_id).name,
        total,
      }));
    },
  };
}
