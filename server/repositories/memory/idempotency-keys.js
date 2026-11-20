// Ключі ідемпотентності (ADR 010) у Map стану; знімок транзакції включає і її.

const mapKey = (initiator, key) => JSON.stringify([initiator, key]);

/** @param {{ enter: (repo: string, method: string) => any }} db */
export function createIdempotencyKeysRepo(db) {
  const enter = (method) => db.enter('idempotencyKeys', method);

  return {
    /** Видаляє ключі з `created_at < cutoff` (ISO-рядки UTC порівнюються як рядки); повертає кількість. */
    deleteOlderThan(cutoff) {
      const keys = enter('deleteOlderThan').idempotencyKeys;
      let count = 0;
      for (const [k, row] of keys) if (row.created_at < cutoff && keys.delete(k)) count++;
      return count;
    },
    /** @returns `{ request_hash, result }` або `undefined` */
    find(initiator, key) {
      const row = enter('find').idempotencyKeys.get(mapKey(initiator, key));
      return row && { request_hash: row.request_hash, result: JSON.parse(row.result) };
    },
    /** `result` зберігається як JSON-текст, як колонка `result` у SQLite. */
    insert({ initiator, key, request_hash, result, created_at }) {
      enter('insert').idempotencyKeys.set(mapKey(initiator, key), {
        request_hash,
        result: JSON.stringify(result),
        created_at,
      });
    },
  };
}
