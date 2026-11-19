// Доменні помилки (ADR 007). HTTP-кодів тут немає: їх призначає лише setErrorHandler (server/errors.js).

export class DomainError extends Error {
  /** @param {string} message публічний текст українською */
  constructor(message) {
    super(message);
    this.name = new.target.name;
  }
}

/** Невалідні вхідні дані або порушення бізнес-правила. */
export class ValidationError extends DomainError {}

/** Ресурс за `:id` не існує. */
export class NotFoundError extends DomainError {}

/** Назва категорії збігається з іншою за `name_normalized` (ADR 002). */
export class DuplicateNameError extends DomainError {}

/** `Idempotency-Key` уже використано з іншим тілом запиту (ADR 010). */
export class IdempotencyMismatchError extends DomainError {}
