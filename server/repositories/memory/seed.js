// Статичний набір прототипу (prompt 0006, «Статичний набір»). Дати — від `today` (ADR 003).
import { addDays } from '../../core/time.js';

/** @param {string} today `YYYY-MM-DD` за Europe/Kyiv */
export function createSeed(today) {
  return {
    categories: [
      { id: 1, name: 'Інше', limit_amount: null, is_default: true },
      { id: 2, name: 'Їжа', limit_amount: 1000, is_default: false },
      { id: 3, name: 'Транспорт', limit_amount: 300, is_default: false },
      { id: 4, name: 'Розваги', limit_amount: null, is_default: false },
    ],
    expenses: [
      { id: 1, category_id: 2, amount: 900.5, spent_at: today, description: 'Продукти' },
      { id: 2, category_id: 2, amount: 120, spent_at: addDays(today, -29), description: '' },
      { id: 3, category_id: 3, amount: 300, spent_at: addDays(today, -5), description: 'Проїзний' },
      { id: 4, category_id: 4, amount: 450, spent_at: addDays(today, -30), description: 'Концерт' },
      { id: 5, category_id: 1, amount: 99.99, spent_at: addDays(today, -10), description: '' },
    ],
  };
}
