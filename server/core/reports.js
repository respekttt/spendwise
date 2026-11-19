// Періоди, ліміти й звіти (ADR 001, ADR 003, контракт «Відповіді»).
import { compareNames } from './categories.js';
import { roundMoney } from './money.js';
import { addDays } from './time.js';

/** Вікно `[today - 29, today]`. */
export const last30Days = (today) => ({ from: addDays(today, -29), to: today });

/** Межі місяця `YYYY-MM` для порівняння рядків дат: будь-яка реальна дата місяця між ними. */
export const monthRange = (month) => ({ from: `${month}-01`, to: `${month}-31` });

/**
 * `warning`, якщо округлена сума за 30 днів строго більша за ліміт; інакше `undefined`.
 * @param {number} category_id
 * @param {number | null} limit_amount
 * @param {number} spent сума з репозиторію, ще не округлена
 */
export function limitWarning(category_id, limit_amount, spent) {
  if (limit_amount === null) return undefined;
  const rounded = roundMoney(spent);
  if (rounded <= limit_amount) return undefined;
  return {
    category_id,
    limit_amount,
    spent: rounded,
    exceeded_by: roundMoney(rounded - limit_amount),
  };
}

/**
 * `total` і `categories` звіту: лише суми `> 0`, за спаданням суми; без витрат — без ділення.
 * @param {{ category_id: number, name: string, total: number }[]} rows
 */
export function categoryTotals(rows) {
  const items = rows
    .map(({ category_id, name, total }) => ({ category_id, name, total: roundMoney(total) }))
    .filter((row) => row.total > 0)
    .sort((a, b) => b.total - a.total || a.category_id - b.category_id);
  const total = roundMoney(items.reduce((sum, row) => sum + row.total, 0));
  return {
    total,
    categories: items.map((row) => ({
      ...row,
      share: Math.round((row.total / total) * 10000) / 100,
    })),
  };
}

/**
 * Стан лімітів: усі категорії з лімітом, навіть зі `spent = 0`, за абеткою.
 * @param {{ category_id: number, name: string, limit_amount: number, spent: number }[]} rows
 */
export function limitStates(rows) {
  return rows
    .map(({ category_id, name, limit_amount, spent }) => {
      const rounded = roundMoney(spent);
      return {
        category_id,
        name,
        limit_amount,
        spent: rounded,
        remaining: roundMoney(Math.max(limit_amount - rounded, 0)),
        exceeded_by: roundMoney(Math.max(rounded - limit_amount, 0)),
      };
    })
    .sort((a, b) => compareNames(a.name, b.name));
}
