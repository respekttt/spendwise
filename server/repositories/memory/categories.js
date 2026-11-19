import { DuplicateNameError } from '../../core/errors.js';

const NAME_TAKEN = 'name: категорія з такою назвою вже існує';

/** Публічна форма категорії (без `name_normalized`), завжди копія. */
const toCategory = ({ name_normalized: _nn, ...category }) => category;

/** @param {{ enter: (repo: string, method: string) => any }} db */
export function createCategoriesRepo(db) {
  const enter = (method) => db.enter('categories', method);
  const assertUnique = (state, name_normalized, id) => {
    if (state.categories.some((c) => c.name_normalized === name_normalized && c.id !== id)) {
      throw new DuplicateNameError(NAME_TAKEN);
    }
  };

  return {
    /** Усі категорії, без певного порядку (сортує core/). */
    list() {
      return enter('list').categories.map(toCategory);
    },
    getById(id) {
      const found = enter('getById').categories.find((c) => c.id === id);
      return found && toCategory(found);
    },
    getDefault() {
      return toCategory(enter('getDefault').categories.find((c) => c.is_default));
    },
    /** Категорія з тією самою нормалізованою назвою, крім `exceptId`. */
    findByNormalizedName(name_normalized, exceptId) {
      const found = enter('findByNormalizedName').categories.find(
        (c) => c.name_normalized === name_normalized && c.id !== exceptId,
      );
      return found && toCategory(found);
    },
    insert({ name, name_normalized, limit_amount }) {
      const state = enter('insert');
      assertUnique(state, name_normalized);
      const id = ++state.lastId.categories;
      const row = { id, name, limit_amount, is_default: false, name_normalized };
      state.categories.push(row);
      return toCategory(row);
    },
    /** @returns оновлена категорія або `undefined`, якщо її немає */
    update(id, { name, name_normalized, limit_amount }) {
      const state = enter('update');
      const row = state.categories.find((c) => c.id === id);
      if (!row) return undefined;
      assertUnique(state, name_normalized, id);
      Object.assign(row, { name, name_normalized, limit_amount });
      return toCategory(row);
    },
    /** @returns видалена категорія або `undefined` */
    delete(id) {
      const state = enter('delete');
      const index = state.categories.findIndex((c) => c.id === id);
      if (index === -1) return undefined;
      return toCategory(state.categories.splice(index, 1)[0]);
    },
    /** R1, другий запит: категорії з лімітом і сума витрат за `[from, to]`. */
    limitsWithSpent(from, to) {
      const state = enter('limitsWithSpent');
      return state.categories
        .filter((c) => c.limit_amount !== null)
        .map((c) => ({
          category_id: c.id,
          name: c.name,
          limit_amount: c.limit_amount,
          spent: state.expenses
            .filter((e) => e.category_id === c.id && e.spent_at >= from && e.spent_at <= to)
            .reduce((sum, e) => sum + e.amount, 0),
        }));
    },
  };
}
