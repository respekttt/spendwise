// Гроші (ADR 001): REAL з округленням до копійок у визначених точках.
import { ValidationError } from './errors.js';

export const MAX_MONEY = 1_000_000_000;

export const roundMoney = (value) => Math.round(value * 100) / 100;

/**
 * Вхідна сума: спершу округлення, потім перевірка (ADR 001, контракт «Вхідні поля»).
 * @param {unknown} value
 * @param {string} field назва поля для тексту помилки
 * @returns {number}
 */
export function parseMoney(value, field) {
  if (typeof value !== 'number') {
    throw new ValidationError(`${field}: очікується число`);
  }
  const rounded = roundMoney(value);
  if (!Number.isFinite(rounded) || rounded <= 0) {
    throw new ValidationError(`${field}: сума має бути більшою за 0`);
  }
  if (rounded > MAX_MONEY) {
    throw new ValidationError(`${field}: сума не може перевищувати 1 000 000 000`);
  }
  return rounded;
}
