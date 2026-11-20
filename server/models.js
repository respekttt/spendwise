// Форма моделей (ADR 007, «Моделі й файли»; контракт, «Відповіді»). Лише JSDoc, коду немає.

/**
 * @typedef {object} Expense
 * @property {number} id
 * @property {number} category_id
 * @property {number} amount
 * @property {string} description `""`, якщо не задано
 * @property {string} spent_at `YYYY-MM-DD`
 * @property {string} created_at UTC, `YYYY-MM-DD HH:MM:SS` (формат SQLite)
 */

/**
 * @typedef {object} Category
 * @property {number} id
 * @property {string} name
 * @property {number | null} limit_amount `null` — без ліміту
 * @property {boolean} is_default `true` лише для «Інше»
 */

/**
 * Перевищення ліміту після POST/PUT; поля немає, якщо ліміт не перевищено.
 * @typedef {object} Warning
 * @property {number} category_id
 * @property {number} limit_amount
 * @property {number} spent
 * @property {number} exceeded_by
 */

/**
 * Рядок `categories` звіту: лише категорії з сумою `> 0`, за спаданням суми.
 * @typedef {object} CategoryTotal
 * @property {number} category_id
 * @property {string} name
 * @property {number} total
 * @property {number} share відсоток, 2 знаки
 */

/**
 * Рядок `limits` звіту за 30 днів: усі категорії з лімітом, навіть зі `spent = 0`.
 * @typedef {object} LimitStatus
 * @property {number} category_id
 * @property {string} name
 * @property {number} limit_amount
 * @property {number} spent
 * @property {number} remaining `max(limit - spent, 0)`
 * @property {number} exceeded_by `max(spent - limit, 0)`
 */

/**
 * `GET /reports/last-30-days`.
 * @typedef {object} Last30DaysReport
 * @property {string} from `YYYY-MM-DD`
 * @property {string} to `YYYY-MM-DD`
 * @property {number} total
 * @property {CategoryTotal[]} categories
 * @property {LimitStatus[]} limits
 */

/**
 * `GET /reports/monthly`: без `limits`.
 * @typedef {object} MonthlyReport
 * @property {string} month `YYYY-MM`
 * @property {number} total
 * @property {CategoryTotal[]} categories
 */

// Робить файл модулем, щоб `import('…/models.js').Expense` у JSDoc знаходив типи; у рантаймі нічого не робить.
export {};
