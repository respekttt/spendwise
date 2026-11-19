// Сценарії категорій (spec, сценарії 3, 4; db.md C1–C4).
import { normalizeCategoryName, sortCategories } from '../core/categories.js';
import { DuplicateNameError, NotFoundError, ValidationError } from '../core/errors.js';
import { last30Days, limitWarning } from '../core/reports.js';
import { parseCategoryInput } from '../core/validation.js';

const NAME_TAKEN = 'name: категорія з такою назвою вже існує';
const DEFAULT_LOCKED = 'Категорію «Інше» не можна змінювати чи видаляти';

export function createCategoriesService({ store, logger }) {
  const { categories, expenses } = store;

  /** Звичайна категорія за `id`; лише всередині межі. */
  function requireEditable(id) {
    const category = categories.getById(id);
    if (!category) throw new NotFoundError('Категорію не знайдено');
    if (category.is_default) throw new ValidationError(DEFAULT_LOCKED);
    return category;
  }

  function assertNameFree(name_normalized, exceptId) {
    if (categories.findByNormalizedName(name_normalized, exceptId)) {
      throw new DuplicateNameError(NAME_TAKEN);
    }
  }

  return {
    list: async () => sortCategories(await store.withRead(() => categories.list())),

    async create(body) {
      const input = parseCategoryInput(body);
      const name_normalized = normalizeCategoryName(input.name);
      const category = await store.withTransaction(() => {
        assertNameFree(name_normalized);
        return categories.insert({ ...input, name_normalized });
      });
      logger.info({ categoryId: category.id }, 'category created');
      return { category };
    },

    async update(id, body, { today }) {
      const input = parseCategoryInput(body);
      const name_normalized = normalizeCategoryName(input.name);
      const { from, to } = last30Days(today);
      const { category, spent } = await store.withTransaction(() => {
        requireEditable(id);
        assertNameFree(name_normalized, id);
        const updated = categories.update(id, { ...input, name_normalized });
        const sum = updated.limit_amount === null ? 0 : expenses.sumForCategory(id, from, to);
        return { category: updated, spent: sum };
      });
      logger.info({ categoryId: id }, 'category updated');
      const warning = limitWarning(id, category.limit_amount, spent);
      return warning ? { category, warning } : { category };
    },

    /** Витрати → «Інше», категорія зникає, в одній межі (ADR 007). */
    async remove(id) {
      const result = await store.withTransaction(() => {
        requireEditable(id);
        const fallback = categories.getDefault();
        const moved_expenses = expenses.moveAll(id, fallback.id);
        return { category: categories.delete(id), moved_expenses };
      });
      logger.info({ categoryId: id, movedExpenses: result.moved_expenses }, 'category deleted');
      return result;
    },
  };
}
