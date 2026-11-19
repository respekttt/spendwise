// Логер (ADR 009, «Логер як залежність»): pino з mixin, що додає контекст запиту в кожен рядок.
// shortcut: pino — залежність Fastify, а не пряма в package.json; якщо Fastify її змінить, додати явно.
import pino from 'pino';
import { currentContext } from './context.js';

/**
 * @param {{ level?: string, stream?: import('pino').DestinationStream }} [options]
 *   без `stream` пише в stdout; тести передають власний потік
 */
export function createLogger({ level = 'info', stream } = {}) {
  const options = {
    level,
    // Новий об'єкт, а не контекст: pino дописує поля в повернений об'єкт, а контекст заморожений.
    mixin(_mergeObject, _level, logger) {
      const ctx = currentContext();
      if (!ctx) return {};
      const { reqId, bpId, user } = ctx;
      // Дочірній логер Fastify уже має reqId у bindings, а pino не прибирає дублікати.
      return 'reqId' in logger.bindings() ? { bpId, user } : { reqId, bpId, user };
    },
  };
  return stream ? pino(options, stream) : pino(options);
}
