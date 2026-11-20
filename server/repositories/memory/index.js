// In-memory сховище (ADR 007): ті самі методи й межі, що й майбутнє SQLite-сховище.
import { normalizeCategoryName } from '../../core/categories.js';
import { createCategoriesRepo } from './categories.js';
import { createExpensesRepo, sqliteTimestamp } from './expenses.js';
import { createIdempotencyKeysRepo } from './idempotency-keys.js';

const DEFAULT_CATEGORY = { name: 'Інше', limit_amount: null, is_default: true };
const silentLogger = { debug() {}, info() {}, warn() {} };

// Що з результату методу йде в лог (ADR 009, «Що пишеться»): кількість і факт, без значень полів.
const rows = (value) => ({ rows: value.length });
const found = (value) => ({ found: value !== undefined });
const written = (value) => (value ? { changes: 1, id: value.id } : { changes: 0 });
const RESULTS = {
  categories: {
    list: rows,
    getById: found,
    getDefault: found,
    findByNormalizedName: found,
    insert: written,
    update: written,
    delete: written,
    limitsWithSpent: rows,
  },
  expenses: {
    list: rows,
    insert: written,
    update: written,
    delete: written,
    // Агрегат — один рядок результату; сума в лог не йде.
    sumForCategory: () => ({ rows: 1 }),
    moveAll: (count) => ({ changes: count }),
    totalsByCategory: rows,
  },
  idempotencyKeys: {
    deleteOlderThan: (count) => ({ changes: count }),
    find: found,
    insert: () => ({ changes: 1 }),
  },
};

/** Код SQLite або клас доменної помилки (ADR 009). */
const errorKind = (error) => error?.code ?? error?.name ?? typeof error;

/** Одна обгортка для всіх методів: `info` після виклику, `warn` на помилці. */
function withLog(logger, repo, methods) {
  const wrapped = {};
  for (const [method, fn] of Object.entries(methods)) {
    const describe = RESULTS[repo][method];
    if (!describe) throw new Error(`${repo}.${method}: немає опису результату для логу (RESULTS)`);
    wrapped[method] = (...args) => {
      let value;
      try {
        value = fn(...args);
      } catch (error) {
        logger.warn({ repo, method, err: errorKind(error) }, 'db operation failed');
        throw error;
      }
      logger.info({ repo, method, result: describe(value) }, 'db operation');
      return value;
    };
  }
  return wrapped;
}

/**
 * @param {object} [options]
 * @param {{ categories?: object[], expenses?: object[] }} [options.seed] початковий набір; без нього — лише «Інше»
 * @param {() => Date} [options.now] годинник для `created_at`
 * @param {{ debug: Function, info: Function, warn: Function }} [options.logger] кореневий логер (ADR 009)
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
    /** Перевіряє межу й повертає поточний стан. */
    enter(repo, method) {
      if (!inside) {
        throw new Error(`${repo}.${method}: виклик поза withTransaction/withRead (ADR 007)`);
      }
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
      logger.debug({ tx: 'begin' }, 'transaction');
      try {
        const result = run(fn);
        logger.debug({ tx: 'commit' }, 'transaction');
        return result;
      } catch (error) {
        state = snapshot;
        logger.warn({ tx: 'rollback', reason: errorKind(error) }, 'transaction');
        throw error;
      }
    },
    async withRead(fn) {
      return run(fn);
    },
    categories: withLog(logger, 'categories', createCategoriesRepo(db)),
    expenses: withLog(logger, 'expenses', createExpensesRepo(db)),
    idempotencyKeys: withLog(logger, 'idempotencyKeys', createIdempotencyKeysRepo(db)),
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
