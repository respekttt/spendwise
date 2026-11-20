// Звіти (db.md R1, R2): фіксована кількість викликів репозиторію в одній межі читання.
import { categoryTotals, last30Days, limitStates, monthRange } from '../core/reports.js';
import { parseMonth } from '../core/validation.js';

export function createReportsService({ store }) {
  const { categories, expenses } = store;

  return {
    async last30Days({ today }) {
      const { from, to } = last30Days(today);
      const { totals, limits } = await store.withRead(() => ({
        totals: expenses.totalsByCategory(from, to),
        limits: categories.limitsWithSpent(from, to),
      }));
      return { from, to, ...categoryTotals(totals), limits: limitStates(limits) };
    },

    async monthly(month, { today }) {
      parseMonth(month, today);
      const { from, to } = monthRange(month);
      const totals = await store.withRead(() => expenses.totalsByCategory(from, to));
      return { month, ...categoryTotals(totals) };
    },
  };
}
