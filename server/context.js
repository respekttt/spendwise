// Контекст запиту (ADR 009): `{ reqId, bpId, user }` в AsyncLocalStorage.
// Імпортують лише server/app.js, server/logger.js і server/services/ (тест імпортів).
import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage();

/**
 * @param {{ reqId: string, bpId: string, user: string | null }} ctx
 * @param {() => any} fn
 */
export function runWithContext(ctx, fn) {
  return storage.run(Object.freeze({ ...ctx }), fn);
}

/** Контекст або `undefined` поза запитом. Читає лише логер. */
export function currentContext() {
  return storage.getStore();
}

/** Контекст або помилка поза запитом. Читають сервіси. */
export function requireContext() {
  const ctx = storage.getStore();
  if (!ctx) throw new Error('requireContext: виклик поза контекстом запиту (ADR 009)');
  return ctx;
}
