// Назви й порядок категорій (ADR 002, контракт «GET /categories»).

const collator = new Intl.Collator('uk');

/** Єдине правило нормалізації назви (ADR 002). */
export function normalizeCategoryName(name) {
  return name.trim().normalize('NFC').toLocaleLowerCase('uk');
}

/** Порівняння назв за українською абеткою. */
export const compareNames = (a, b) => collator.compare(a, b);

/**
 * Категорії за абеткою, «Інше» (is_default) остання. Вхідний масив не змінюється.
 * @template {{ name: string, is_default: boolean }} T
 * @param {T[]} categories
 * @returns {T[]}
 */
export function sortCategories(categories) {
  return [...categories].sort(
    (a, b) => Number(a.is_default) - Number(b.is_default) || compareNames(a.name, b.name),
  );
}
