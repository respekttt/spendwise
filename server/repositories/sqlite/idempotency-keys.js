// Ключі ідемпотентності на SQLite (ADR 010, db.md «Ідемпотентність (I)»).

export const SQL = {
  deleteOlderThan: 'DELETE FROM idempotency_keys WHERE created_at < $cutoff',
  find: 'SELECT request_hash, result FROM idempotency_keys WHERE initiator = $initiator AND key = $key',
  insert: `INSERT INTO idempotency_keys (initiator, key, request_hash, result, created_at)
VALUES ($initiator, $key, $request_hash, $result, $created_at)`,
};

/** @param {import('bun:sqlite').Database} db */
export function createIdempotencyKeysRepo(db) {
  const q = (name) => db.query(SQL[name]);

  return {
    /** Видаляє ключі з `created_at < cutoff` (ISO-рядки UTC порівнюються як рядки); повертає кількість. */
    deleteOlderThan(cutoff) {
      return q('deleteOlderThan').run({ cutoff }).changes;
    },
    /** @returns `{ request_hash, result }` або `undefined` */
    find(initiator, key) {
      const row = q('find').get({ initiator, key });
      return row ? { request_hash: row.request_hash, result: JSON.parse(row.result) } : undefined;
    },
    /** `result` — знімок результату транзакції, зберігається JSON-текстом. */
    insert({ initiator, key, request_hash, result, created_at }) {
      q('insert').run({ initiator, key, request_hash, result: JSON.stringify(result), created_at });
    },
  };
}
