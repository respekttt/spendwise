// JSON Schema HTTP-формату (ADR 007). Правила полів перевіряє core/validation.js:
// ajv Fastify за замовчуванням приводить типи ("12.5" → 12.5), а контракт вимагає 400.

/** `:id` — додатне ціле; помилка схеми params → 404 (контракт, «Загальні правила»). */
export const idParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'integer', minimum: 1 } },
};

/** Тіло — JSON-об'єкт; без значень за замовчуванням, щоб хеш ідемпотентності бачив тіло як є. */
export const objectBody = { type: 'object' };
