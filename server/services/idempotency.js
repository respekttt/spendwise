// Ідемпотентність POST (ADR 010): пошук ключа, запис ресурсу й запис ключа — в одній межі.
import { requireContext } from '../context.js';
import { IdempotencyMismatchError } from '../core/errors.js';
import { requestHash } from '../core/idempotency.js';

const TTL_MS = 24 * 60 * 60 * 1000;

/**
 * @param {{ store: object, now: () => Date, logger: import('pino').Logger }} deps
 * @returns виконавець `(request, fn) => Promise<{ result, replayed }>`; `fn` — синхронна функція транзакції
 */
export function createIdempotency({ store, now, logger }) {
  const { idempotencyKeys } = store;

  /**
   * @param {{ key?: string, operation: string, body: unknown }} request `operation` — 'POST /expenses'
   * @param {() => object} fn
   */
  return async function idempotent({ key, operation, body }, fn) {
    if (key === undefined) return { result: await store.withTransaction(fn), replayed: false };

    // Усе, що не є роботою зі сховищем, — до входу в межу.
    const initiator = requireContext().user;
    const [method, path] = operation.split(' ');
    const request_hash = requestHash(method, path, body);
    const at = now();
    const created_at = at.toISOString();
    const cutoff = new Date(at.getTime() - TTL_MS).toISOString();

    const outcome = await store.withTransaction(() => {
      idempotencyKeys.deleteOlderThan(cutoff);
      const found = idempotencyKeys.find(initiator, key);
      if (found) {
        if (found.request_hash !== request_hash) {
          throw new IdempotencyMismatchError(
            'Idempotency-Key: ключ уже використано з іншим тілом запиту',
          );
        }
        return { result: found.result, replayed: true };
      }
      const result = fn();
      idempotencyKeys.insert({ initiator, key, request_hash, result, created_at });
      return { result, replayed: false };
    });
    if (outcome.replayed) logger.info('idempotent replay');
    return outcome;
  };
}
