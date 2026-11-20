// Категорії на SQLite (db.md C1–C4, R1). Лише db.query: його бачить лічильник AC 14 (ADR 008).
import { DuplicateNameError } from '../../core/errors.js';

const NAME_TAKEN = 'name: категорія з такою назвою вже існує';
const COLUMNS = 'id, name, limit_amount, is_default';

export const SQL = {
  list: `SELECT ${COLUMNS} FROM categories`,
  getById: `SELECT ${COLUMNS} FROM categories WHERE id = $id`,
  getDefault: `SELECT ${COLUMNS} FROM categories WHERE is_default = 1`,
  findByNormalizedName: `SELECT ${COLUMNS} FROM categories WHERE name_normalized = $nn AND id IS NOT $exceptId`,
  insert: `INSERT INTO categories (name, name_normalized, limit_amount) VALUES ($name, $nn, $limit_amount) RETURNING ${COLUMNS}`,
  update: `UPDATE categories SET name = $name, name_normalized = $nn, limit_amount = $limit_amount WHERE id = $id RETURNING ${COLUMNS}`,
  delete: `DELETE FROM categories WHERE id = $id RETURNING ${COLUMNS}`,
  limitsWithSpent: `SELECT c.id AS category_id, c.name, c.limit_amount, COALESCE(SUM(e.amount), 0) AS spent
FROM categories c
LEFT JOIN expenses e ON e.category_id = c.id AND e.spent_at BETWEEN $from AND $to
WHERE c.limit_amount IS NOT NULL
GROUP BY c.id`,
};

/** `is_default` 0/1 → boolean (ADR 007); `null` від `.get()` → `undefined`, як у memory/. */
const toCategory = (row) => (row ? { ...row, is_default: row.is_default === 1 } : undefined);

/** Дублікат, що оминув перевірку сервісу (db.md: C2, C3 → DuplicateNameError). */
function translateUnique(error) {
  if (error?.code === 'SQLITE_CONSTRAINT_UNIQUE') throw new DuplicateNameError(NAME_TAKEN);
  throw error;
}

/** @param {import('bun:sqlite').Database} db */
export function createCategoriesRepo(db) {
  const q = (name) => db.query(SQL[name]);

  return {
    /** Усі категорії, без певного порядку (сортує core/). @returns {import('../../models.js').Category[]} */
    list() {
      return q('list').all().map(toCategory);
    },
    /** @returns {import('../../models.js').Category | undefined} */
    getById(id) {
      return toCategory(q('getById').get({ id }));
    },
    /** @returns {import('../../models.js').Category} */
    getDefault() {
      return toCategory(q('getDefault').get());
    },
    /** Категорія з тією самою нормалізованою назвою, крім `exceptId`. @returns {import('../../models.js').Category | undefined} */
    findByNormalizedName(name_normalized, exceptId) {
      return toCategory(
        q('findByNormalizedName').get({ nn: name_normalized, exceptId: exceptId ?? null }),
      );
    },
    /** @returns {import('../../models.js').Category} */
    insert({ name, name_normalized, limit_amount }) {
      try {
        return toCategory(q('insert').get({ name, nn: name_normalized, limit_amount }));
      } catch (error) {
        translateUnique(error);
      }
    },
    /** @returns {import('../../models.js').Category | undefined} оновлена категорія або `undefined`, якщо її немає */
    update(id, { name, name_normalized, limit_amount }) {
      try {
        return toCategory(q('update').get({ id, name, nn: name_normalized, limit_amount }));
      } catch (error) {
        translateUnique(error);
      }
    },
    /**
     * RESTRICT (`SQLITE_CONSTRAINT_TRIGGER`, errno 1811) не перекладається: це баг перенесення, `500` (db.md).
     * @returns {import('../../models.js').Category | undefined} видалена категорія або `undefined`
     */
    delete(id) {
      return toCategory(q('delete').get({ id }));
    },
    /** R1, другий запит: категорії з лімітом і сума витрат за `[from, to]`. */
    limitsWithSpent(from, to) {
      return q('limitsWithSpent').all({ from, to });
    },
  };
}
