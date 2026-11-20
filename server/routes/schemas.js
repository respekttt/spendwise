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

/** `Idempotency-Key`: 1–128 символів `[A-Za-z0-9._:-]`, без лапок або в подвійних лапках (контракт). */
export const idempotencyHeaders = {
  type: 'object',
  properties: {
    'idempotency-key': {
      type: 'string',
      pattern: '^(?:[A-Za-z0-9._:-]{1,128}|"[A-Za-z0-9._:-]{1,128}")$',
    },
  },
};

/** Ключ без лапок RFC 8941 або `undefined`. */
export const idempotencyKey = (request) =>
  request.headers['idempotency-key']?.replace(/^"(.*)"$/, '$1');

/** Відповідь POST: 201, а для повтору ще `Idempotent-Replayed: true`. */
export function sendCreated(reply, { body, replayed }) {
  if (replayed) reply.header('Idempotent-Replayed', 'true');
  return reply.code(201).send(body);
}
