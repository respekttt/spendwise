// Відбиток запиту для Idempotency-Key (ADR 010, контракт «Ідемпотентність»).
import { createHash } from 'node:crypto';

/** Копія з відсортованими ключами об'єктів на всіх рівнях. */
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeys(value[key])]),
    );
  }
  return value;
}

/**
 * SHA-256 (hex) від методу, шляху й розібраного тіла як є, без значень за замовчуванням.
 * @param {string} method
 * @param {string} path
 * @param {unknown} body
 */
export function requestHash(method, path, body) {
  return createHash('sha256')
    .update(JSON.stringify(sortKeys({ method, path, body })))
    .digest('hex');
}
