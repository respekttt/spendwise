// In-memory сховище (ADR 007): ті самі методи й межі, що й майбутнє SQLite-сховище.
import { normalizeCategoryName } from '../../core/categories.js';
import { createCategoriesRepo } from './categories.js';
import { createExpensesRepo, sqliteTimestamp } from './expenses.js';
import { createIdempotencyKeysRepo } from './idempotency-keys.js';

const DEFAULT_CATEGORY = { name: 'Інше', limit_amount: null, is_default: true };
const silentLogger = { debug() {} };

/**
 * @param {object} [options]
 * @param {{ categories?: object[], expenses?: object[] }} [options.seed] початковий набір; без нього — лише «Інше»
 * @param {() => Date} [options.now] годинник для `created_at`
 * @param {{ debug: Function }} [options.logger] кореневий логер (ADR 009); репозиторії пишуть `debug`
 */
export function createMemoryStore({
  seed = {},
  now = () => new Date(),
  logger = silentLogger,
} = {}) {
  let state = initialState(seed, now);
  let inside = false;

  const db = {
    now,
    /** Перевіряє межу, пише рядок логу й повертає поточний стан. */
    enter(repo, method) {
      if (!inside) {
        throw new Error(`${repo}.${method}: виклик поза withTransaction/withRead (ADR 007)`);
      }
      logger.debug({ repo, method }, 'repository call');
      return state;
    },
  };

  /** Синхронний виклик `fn` у межі; thenable → TypeError ще всередині межі. */
  function run(fn) {
    inside = true;
    try {
      const result = fn();
      if (typeof result?.then === 'function') {
        // Продовження async-функції вже поза межею й упаде на першому виклику репозиторію;
        // його відмову гасимо, щоб вона не стала необробленою.
        result.then(undefined, () => {});
        throw new TypeError('withTransaction/withRead: функція має бути синхронною (ADR 007)');
      }
      return result;
    } finally {
      inside = false;
    }
  }

  return {
    async withTransaction(fn) {
      const snapshot = structuredClone(state);
      try {
        return run(fn);
      } catch (error) {
        state = snapshot;
        throw error;
      }
    },
    async withRead(fn) {
      return run(fn);
    },
    categories: createCategoriesRepo(db),
    expenses: createExpensesRepo(db),
    idempotencyKeys: createIdempotencyKeysRepo(db),
  };
}

function initialState({ categories = [], expenses = [] }, now) {
  const rows = categories.map((c) => ({ ...c, name_normalized: normalizeCategoryName(c.name) }));
  const maxId = (list) => list.reduce((max, row) => Math.max(max, row.id), 0);
  // Як schema.sql: «Інше» створюється, якщо її немає.
  if (!rows.some((c) => c.is_default)) {
    const id = maxId(rows) + 1;
    rows.push({ id, ...DEFAULT_CATEGORY, name_normalized: normalizeCategoryName('Інше') });
  }
  const createdAt = sqliteTimestamp(now());
  return {
    categories: rows,
    expenses: expenses.map((e) => ({ description: '', created_at: createdAt, ...e })),
    idempotencyKeys: new Map(),
    // Як AUTOINCREMENT: ID не перевикористовуються, лічильник входить у знімок.
    lastId: { categories: maxId(rows), expenses: maxId(expenses) },
  };
}
