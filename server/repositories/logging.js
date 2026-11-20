// Логування операцій сховища (ADR 009, «Що пишеться»): спільне для memory/ і sqlite/.

// Що з результату методу йде в лог: кількість і факт, без значень полів.
const rows = (value) => ({ rows: value.length });
const found = (value) => ({ found: value !== undefined });
const written = (value) => (value ? { changes: 1, id: value.id } : { changes: 0 });
export const RESULTS = {
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
export const errorKind = (error) => error?.code ?? error?.name ?? typeof error;

/** Одна обгортка для всіх методів: `info` після виклику, `warn` на помилці. */
export function withLog(logger, repo, methods) {
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
