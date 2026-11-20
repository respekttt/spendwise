// Межі транзакції SQLite (ADR 007, 008, 010): єдине місце, де викликається db.transaction.
import { StorageUnavailableError } from '../core/errors.js';
import { errorKind } from '../repositories/logging.js';

/** Паузи перед повторами, мс (ADR 010); кожна ±50%. */
export const RETRY_DELAYS_MS = [25, 50, 100, 200, 400];

/** Сімейство SQLITE_BUSY, зокрема SQLITE_BUSY_* (db.md, «Помилки БД»). */
export const isBusy = (error) => (error?.errno & 0xff) === 5;

const BUSY_MESSAGE = 'База даних зайнята, спробуйте пізніше';

/**
 * @param {import('bun:sqlite').Database} db
 * @param {object} [options]
 * @param {{ debug: Function, warn: Function, error: Function }} [options.logger]
 * @param {number[]} [options.delays] паузи між спробами; тести передають короткі
 * @returns {{ withTransaction: (fn: () => any) => Promise<any>, withRead: (fn: () => any) => Promise<any> }}
 */
export function createTransactions(db, { logger, delays = RETRY_DELAYS_MS }) {
  /** @param {'immediate' | 'deferred'} mode */
  async function run(mode, fn) {
    // Сюди Bun заходить лише після успішного BEGIN: rollback пишемо, лише якщо транзакція відкрита (ADR 009).
    let opened = false;
    // Перевірка thenable всередині транзакції: інакше Bun закомітить (ADR 008).
    const tx = db.transaction(() => {
      opened = true;
      logger.debug({ tx: 'begin' }, 'transaction');
      const result = fn();
      if (typeof result?.then === 'function') {
        result.then(undefined, () => {});
        throw new TypeError('withTransaction/withRead: функція має бути синхронною (ADR 007)');
      }
      return result;
    });

    for (let attempt = 1; ; attempt++) {
      opened = false;
      try {
        const result = tx[mode]();
        logger.debug({ tx: 'commit' }, 'transaction');
        return result;
      } catch (error) {
        // Bun відкочує сам; це страховка на випадок зміни його поведінки (ADR 010).
        if (db.inTransaction) db.run('ROLLBACK');
        if (opened) logger.warn({ tx: 'rollback', reason: errorKind(error) }, 'transaction');
        if (!isBusy(error)) throw error;
        if (attempt > delays.length) {
          logger.error({ attempts: attempt, err: errorKind(error) }, 'storage unavailable');
          throw new StorageUnavailableError(BUSY_MESSAGE);
        }
        logger.warn({ attempt, err: errorKind(error) }, 'transaction retry');
        await Bun.sleep(delays[attempt - 1] * (0.5 + Math.random()));
      }
    }
  }

  return {
    withTransaction: (fn) => run('immediate', fn),
    withRead: (fn) => run('deferred', fn),
  };
}
