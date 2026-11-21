import { describe, expect, test } from 'bun:test';
import { requestHash } from '../../server/core/idempotency.js';

// Відбиток запиту (ADR 010, контракт «Ідемпотентність»): SHA-256 у hex від методу, шляху й тіла
// з відсортованими ключами.

const BODY = { category_id: 1, amount: 10, spent_at: '2026-11-05' };

describe('requestHash', () => {
  test('рядок з 64 hex-символів, однаковий для однакових аргументів', () => {
    const hash = requestHash('POST', '/expenses', BODY);
    expect(typeof hash).toBe('string');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(requestHash('POST', '/expenses', { ...BODY })).toBe(hash);
  });

  test('порядок ключів на верхньому й вкладеному рівні не впливає', () => {
    expect(requestHash('POST', '/expenses', { a: 1, b: { x: 1, y: 2 } })).toBe(
      requestHash('POST', '/expenses', { b: { y: 2, x: 1 }, a: 1 }),
    );
  });

  test('інша сума, інший метод або інший шлях дають інший відбиток', () => {
    const hash = requestHash('POST', '/expenses', BODY);
    expect(requestHash('POST', '/expenses', { ...BODY, amount: 20 })).not.toBe(hash);
    expect(requestHash('PUT', '/expenses', BODY)).not.toBe(hash);
    expect(requestHash('POST', '/categories', BODY)).not.toBe(hash);
  });

  test('тіло з null у полі не падає й відрізняється від тіла без поля', () => {
    const withNull = requestHash('POST', '/categories', { name: 'Їжа', limit_amount: null });
    expect(withNull).toMatch(/^[0-9a-f]{64}$/);
    expect(withNull).not.toBe(requestHash('POST', '/categories', { name: 'Їжа' }));
  });

  test('масив відрізняється від об’єкта з ключами "0", "1", порядок елементів має значення', () => {
    const array = requestHash('POST', '/x', { list: ['a', 'b'] });
    expect(array).not.toBe(requestHash('POST', '/x', { list: { 0: 'a', 1: 'b' } }));
    expect(array).not.toBe(requestHash('POST', '/x', { list: ['b', 'a'] }));
  });
});
