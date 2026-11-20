import { createCategoriesService } from './categories.js';
import { createExpensesService } from './expenses.js';
import { createIdempotency } from './idempotency.js';
import { createReportsService } from './reports.js';

/**
 * Сервіси над переданим сховищем (ADR 007). Сервіс не знає, in-memory воно чи SQLite.
 * @param {{ store: object, logger: import('pino').Logger, now: () => Date }} deps
 */
export function createServices(deps) {
  const all = { ...deps, idempotent: createIdempotency(deps) };
  return {
    expenses: createExpensesService(all),
    categories: createCategoriesService(all),
    reports: createReportsService(all),
  };
}
