// Перевірка вхідних полів за контрактом API («Вхідні поля»). Тип тіла (object) перевіряє схема маршруту.
import { ValidationError } from './errors.js';
import { parseMoney } from './money.js';
import { addDays } from './time.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_NAME = 50;
const MAX_DESCRIPTION = 500;

/** Довжина в кодових точках Unicode (контракт, «Відповіді»). */
const length = (s) => [...s].length;

/**
 * Реальна дата `YYYY-MM-DD`, не пізніша за `today` (ADR 003).
 * @param {unknown} value
 * @param {string} today
 */
export function parseDate(value, today, field = 'spent_at') {
  if (typeof value !== 'string' || !DATE.test(value) || addDays(value, 0) !== value) {
    throw new ValidationError(`${field}: очікується реальна дата у форматі YYYY-MM-DD`);
  }
  if (value > today) {
    throw new ValidationError(`${field}: дата не може бути пізнішою за сьогодні`);
  }
  return value;
}

/**
 * Місяць `YYYY-MM`, не пізніший за поточний київський.
 * @param {unknown} value
 * @param {string} today
 */
export function parseMonth(value, today) {
  if (typeof value !== 'string' || !MONTH.test(value)) {
    throw new ValidationError('month: очікується місяць у форматі YYYY-MM');
  }
  // Stryker disable next-line MethodExpression: еквівалентний — value пройшов MONTH і має 7 символів, порівняння з today і з today.slice(0, 7) дає той самий результат
  if (value > today.slice(0, 7)) {
    throw new ValidationError('month: місяць не може бути пізнішим за поточний');
  }
  return value;
}

/**
 * Поля витрати для POST і PUT (PUT — повна заміна, тож правила ті самі).
 * Існування категорії перевіряє сервіс у транзакції.
 * @param {Record<string, unknown>} body
 * @param {string} today
 */
export function parseExpenseInput(body, today) {
  if (!Number.isInteger(body.category_id)) {
    throw new ValidationError('category_id: очікується ціле число');
  }
  const description = body.description ?? '';
  if (typeof description !== 'string' || length(description) > MAX_DESCRIPTION) {
    throw new ValidationError(`description: очікується рядок до ${MAX_DESCRIPTION} символів`);
  }
  return {
    category_id: body.category_id,
    amount: parseMoney(body.amount, 'amount'),
    description,
    spent_at: parseDate(body.spent_at, today),
  };
}

/**
 * Поля категорії для POST і PUT. Унікальність назви перевіряє сервіс у транзакції.
 * @param {Record<string, unknown>} body
 */
export function parseCategoryInput(body) {
  if (Object.hasOwn(body, 'is_default')) {
    throw new ValidationError('is_default: поле встановлюється лише ініціалізацією');
  }
  if (typeof body.name !== 'string') {
    throw new ValidationError('name: очікується рядок');
  }
  const name = body.name.trim().normalize('NFC');
  if (length(name) < 1 || length(name) > MAX_NAME) {
    throw new ValidationError(`name: назва має містити від 1 до ${MAX_NAME} символів`);
  }
  const limit = body.limit_amount ?? null;
  return { name, limit_amount: limit === null ? null : parseMoney(limit, 'limit_amount') };
}
