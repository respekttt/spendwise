// SQLite-сховище (ADR 007, 008): ті самі методи й межі, що й in-memory. З'єднання відкриває викликач.
import { createTransactions } from '../../db/transaction.js';
import { withLog } from '../logging.js';
import { createCategoriesRepo } from './categories.js';
import { createExpensesRepo } from './expenses.js';
import { createIdempotencyKeysRepo } from './idempotency-keys.js';

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

/** Метод поза межею кидає помилку (ADR 007): перевірка `db.inTransaction`. */
function guarded(db, repo, methods) {
  const wrapped = {};
  for (const [method, fn] of Object.entries(methods)) {
    wrapped[method] = (...args) => {
      if (!db.inTransaction) {
        throw new Error(`${repo}.${method}: виклик поза withTransaction/withRead (ADR 007)`);
      }
      return fn(...args);
    };
  }
  return wrapped;
}

/**
 * @param {object} options
 * @param {import('bun:sqlite').Database} options.db з'єднання з `openDb`
 * @param {() => Date} [options.now] годинник для `created_at`
 * @param {{ debug: Function, info: Function, warn: Function, error: Function }} [options.logger] кореневий логер (ADR 009)
 * @param {number[]} [options.delays] паузи ретраїв; лише для тестів (ADR 010)
 */
export function createSqliteStore({ db, now = () => new Date(), logger = silentLogger, delays }) {
  const repo = (name, methods) => withLog(logger, name, guarded(db, name, methods));
  return {
    ...createTransactions(db, { logger, delays }),
    categories: repo('categories', createCategoriesRepo(db)),
    expenses: repo('expenses', createExpensesRepo(db, now)),
    idempotencyKeys: repo('idempotencyKeys', createIdempotencyKeysRepo(db)),
  };
}
