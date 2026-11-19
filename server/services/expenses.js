// Сценарії витрат (spec, сценарії 1, 2; db.md E1–E4).
import { NotFoundError, ValidationError } from '../core/errors.js';
import { last30Days, limitWarning } from '../core/reports.js';
import { parseExpenseInput } from '../core/validation.js';

/** Тіло відповіді POST/PUT з результату транзакції `{ expense, limit_amount, spent }`. */
const toResponse = ({ expense, limit_amount, spent }) => {
  const warning = limitWarning(expense.category_id, limit_amount, spent);
  return warning ? { expense, warning } : { expense };
};

export function createExpensesService({ store, logger, idempotent }) {
  const { expenses, categories } = store;

  /** Запис і стан ліміту цільової категорії; лише всередині межі. Категорія — раніше за витрату. */
  function save(input, today, write) {
    const category = categories.getById(input.category_id);
    if (!category) throw new ValidationError('category_id: категорію не знайдено');
    const expense = write();
    const { from, to } = last30Days(today);
    const spent =
      category.limit_amount === null ? 0 : expenses.sumForCategory(category.id, from, to);
    return { expense, limit_amount: category.limit_amount, spent };
  }

  return {
    list: () => store.withRead(() => expenses.list()),

    /** @returns `{ body, replayed }`; повтор будує тіло зі збереженого знімка (ADR 010) */
    async create(body, { today, idempotencyKey }) {
      const input = parseExpenseInput(body, today);
      const { result, replayed } = await idempotent(
        { key: idempotencyKey, operation: 'POST /expenses', body },
        () => save(input, today, () => expenses.insert(input)),
      );
      if (!replayed) logger.info({ expenseId: result.expense.id }, 'expense created');
      return { body: toResponse(result), replayed };
    },

    async update(id, body, { today }) {
      const input = parseExpenseInput(body, today);
      const result = await store.withTransaction(() =>
        save(input, today, () => {
          const expense = expenses.update(id, input);
          if (!expense) throw new NotFoundError('Витрату не знайдено');
          return expense;
        }),
      );
      logger.info({ expenseId: id }, 'expense updated');
      return toResponse(result);
    },

    async remove(id) {
      const expense = await store.withTransaction(() => {
        const deleted = expenses.delete(id);
        if (!deleted) throw new NotFoundError('Витрату не знайдено');
        return deleted;
      });
      logger.info({ expenseId: id }, 'expense deleted');
      return { expense };
    },
  };
}
