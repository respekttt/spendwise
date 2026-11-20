// Витрати на SQLite (db.md E1–E4, C4, R1, R2). Лише db.query: його бачить лічильник AC 14 (ADR 008).
import { ValidationError } from '../../core/errors.js';
import { sqliteTimestamp } from '../../core/time.js';

const COLUMNS = 'id, category_id, amount, description, spent_at, created_at';

export const SQL = {
  list: `SELECT ${COLUMNS} FROM expenses ORDER BY spent_at DESC, id DESC`,
  insert: `INSERT INTO expenses (category_id, amount, description, spent_at, created_at)
VALUES ($category_id, $amount, $description, $spent_at, $created_at) RETURNING ${COLUMNS}`,
  update: `UPDATE expenses
SET category_id = $category_id, amount = $amount, description = $description, spent_at = $spent_at
WHERE id = $id RETURNING ${COLUMNS}`,
  delete: `DELETE FROM expenses WHERE id = $id RETURNING ${COLUMNS}`,
  sumForCategory: `SELECT SUM(amount) AS total FROM expenses
WHERE category_id = $category_id AND spent_at BETWEEN $from AND $to`,
  moveAll: 'UPDATE expenses SET category_id = $to WHERE category_id = $from',
  // R1 і R2: monthRange дає `[YYYY-MM-01, YYYY-MM-31]`, тож BETWEEN покриває обидва звіти.
  totalsByCategory: `SELECT e.category_id, c.name, SUM(e.amount) AS total
FROM expenses e JOIN categories c ON c.id = e.category_id
WHERE e.spent_at BETWEEN $from AND $to
GROUP BY e.category_id`,
};

/** Неіснуюча категорія, що оминула перевірку сервісу (db.md: E2, E3 → ValidationError). */
function translateForeignKey(error) {
  if (error?.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
    throw new ValidationError('category_id: категорію не знайдено');
  }
  throw error;
}

/**
 * @param {import('bun:sqlite').Database} db
 * @param {() => Date} now годинник для `created_at` (db.md E2)
 */
export function createExpensesRepo(db, now) {
  const q = (name) => db.query(SQL[name]);

  return {
    /** Нові спочатку: `spent_at` DESC, `id` DESC (E1). @returns {import('../../models.js').Expense[]} */
    list() {
      return q('list').all();
    },
    /** @returns {import('../../models.js').Expense} */
    insert({ category_id, amount, description, spent_at }) {
      const created_at = sqliteTimestamp(now());
      try {
        return q('insert').get({ category_id, amount, description, spent_at, created_at });
      } catch (error) {
        translateForeignKey(error);
      }
    },
    /** @returns {import('../../models.js').Expense | undefined} оновлена витрата або `undefined`, якщо її немає */
    update(id, { category_id, amount, description, spent_at }) {
      try {
        return q('update').get({ id, category_id, amount, description, spent_at }) ?? undefined;
      } catch (error) {
        translateForeignKey(error);
      }
    },
    /** @returns {import('../../models.js').Expense | undefined} видалена витрата або `undefined` */
    delete(id) {
      return q('delete').get({ id }) ?? undefined;
    },
    /** Сума категорії за `[from, to]`, не округлена (E2, E3, C3); `SUM` порожньої вибірки — 0. */
    sumForCategory(category_id, from, to) {
      return q('sumForCategory').get({ category_id, from, to }).total ?? 0;
    },
    /** Переносить усі витрати категорії; повертає кількість перенесених (C4). */
    moveAll(fromCategoryId, toCategoryId) {
      return q('moveAll').run({ from: fromCategoryId, to: toCategoryId }).changes;
    },
    /** Суми за категоріями з назвами за `[from, to]` (R1, R2), без певного порядку. */
    totalsByCategory(from, to) {
      return q('totalsByCategory').all({ from, to });
    },
  };
}
