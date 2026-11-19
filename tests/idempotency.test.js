import { afterEach, describe, expect, test } from 'bun:test';
import { createTestApp, expectError, T } from './helpers.js';

// Сценарій 8, AC 11 (ADR 010, «Подальші дії», без SQLite-випадків).

let app;
let clock;
afterEach(() => app?.close());

function start() {
  clock = new Date('2026-11-05T10:00:00Z');
  ({ app } = createTestApp({ now: () => clock }));
}
const body = { category_id: 2, amount: 10, spent_at: T };
const post = (url, payload, headers = {}) =>
  app.inject({
    method: 'POST',
    url,
    payload,
    headers: { 'content-type': 'application/json', ...headers },
  });
const count = async () => (await app.inject({ method: 'GET', url: '/expenses' })).json().length;

describe('Idempotency-Key для POST /expenses', () => {
  test('той самий ключ і тіло → один запис, той самий код і тіло, Idempotent-Replayed', async () => {
    start();
    const first = await post('/expenses', body, { 'idempotency-key': 'k-1' });
    const second = await post('/expenses', body, { 'idempotency-key': 'k-1' });

    expect(first.statusCode).toBe(201);
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    expect(second.statusCode).toBe(201);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.headers['content-type']).toStartWith('application/json');
    expect(second.json()).toEqual(first.json());
    expect(first.json().warning).toBeDefined();
    expect(await count()).toBe(6);
  });

  test('пробіли й порядок полів у JSON не впливають на відбиток', async () => {
    start();
    await post('/expenses', '{"category_id":2,"amount":10,"spent_at":"2026-11-05"}', {
      'idempotency-key': 'k',
    });
    const res = await post(
      '/expenses',
      '{ "spent_at": "2026-11-05", "amount": 10.0, "category_id": 2 }',
      {
        'idempotency-key': 'k',
      },
    );
    expect(res.headers['idempotent-replayed']).toBe('true');
    expect(await count()).toBe(6);
  });

  test('ключ у подвійних лапках — той самий ключ', async () => {
    start();
    await post('/expenses', body, { 'idempotency-key': 'abc' });
    const res = await post('/expenses', body, { 'idempotency-key': '"abc"' });
    expect(res.headers['idempotent-replayed']).toBe('true');
  });

  test('той самий ключ з іншим тілом → 422, нового запису немає', async () => {
    start();
    await post('/expenses', body, { 'idempotency-key': 'k' });
    expectError(
      expect,
      await post('/expenses', { ...body, amount: 11 }, { 'idempotency-key': 'k' }),
      422,
    );
    expect(await count()).toBe(6);
  });

  test('явний description: "" і його відсутність — різні відбитки → 422', async () => {
    start();
    await post('/expenses', body, { 'idempotency-key': 'k' });
    const res = await post('/expenses', { ...body, description: '' }, { 'idempotency-key': 'k' });
    expectError(expect, res, 422);
  });

  test('той самий ключ від іншого X-User → новий запис', async () => {
    start();
    await post('/expenses', body, { 'idempotency-key': 'k', 'x-user': 'alice' });
    const res = await post('/expenses', body, { 'idempotency-key': 'k', 'x-user': 'bob' });
    expect(res.headers['idempotent-replayed']).toBeUndefined();
    expect(await count()).toBe(7);
  });

  test('без ключа → два записи', async () => {
    start();
    await post('/expenses', body);
    await post('/expenses', body);
    expect(await count()).toBe(7);
  });

  test('ключ старший за 24 год → новий запис; молодший — повтор', async () => {
    start();
    await post('/expenses', body, { 'idempotency-key': 'k' });

    clock = new Date('2026-11-06T10:00:00Z'); // рівно 24 год — ще дійсний
    expect(
      (await post('/expenses', body, { 'idempotency-key': 'k' })).headers['idempotent-replayed'],
    ).toBe('true');

    clock = new Date('2026-11-06T10:00:01Z');
    const res = await post('/expenses', body, { 'idempotency-key': 'k' });
    expect(res.statusCode).toBe(201);
    expect(res.headers['idempotent-replayed']).toBeUndefined();
    expect(await count()).toBe(7);
  });

  test('повтор віддає warning на момент першого запису', async () => {
    start();
    const first = await post('/expenses', body, { 'idempotency-key': 'k' });
    await app.inject({ method: 'DELETE', url: '/expenses/1' });
    const replay = await post('/expenses', body, { 'idempotency-key': 'k' });
    expect(replay.json().warning).toEqual(first.json().warning);
  });

  test('невдалий запит (400) ключ не зберігає: той самий ключ обробляється наново', async () => {
    start();
    expectError(
      expect,
      await post('/expenses', { ...body, amount: 0 }, { 'idempotency-key': 'k' }),
      400,
    );
    const res = await post('/expenses', body, { 'idempotency-key': 'k' });
    expect(res.statusCode).toBe(201);
    expect(res.headers['idempotent-replayed']).toBeUndefined();
  });

  for (const key of ['має пробіл', 'a'.repeat(129), '"abc', '', 'кирилиця']) {
    test(`невалідний Idempotency-Key ${JSON.stringify(key.slice(0, 10))} → 400`, async () => {
      start();
      expectError(expect, await post('/expenses', body, { 'idempotency-key': key }), 400);
      expect(await count()).toBe(5);
    });
  }

  test('128 символів — валідний ключ', async () => {
    start();
    expect((await post('/expenses', body, { 'idempotency-key': 'a'.repeat(128) })).statusCode).toBe(
      201,
    );
  });

  test('на PUT заголовок ігнорується', async () => {
    start();
    const res = await app.inject({
      method: 'PUT',
      url: '/expenses/1',
      payload: body,
      headers: { 'idempotency-key': 'має пробіл' },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('Idempotency-Key для POST /categories', () => {
  test('повтор → той самий 201 і тіло, одна категорія', async () => {
    start();
    const first = await post('/categories', { name: 'Авто' }, { 'idempotency-key': 'c' });
    const second = await post('/categories', { name: 'Авто' }, { 'idempotency-key': 'c' });

    expect(second.statusCode).toBe(201);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.json()).toEqual(first.json());
    const names = (await app.inject({ method: 'GET', url: '/categories' }))
      .json()
      .map((c) => c.name);
    expect(names.filter((n) => n === 'Авто')).toHaveLength(1);
  });

  test('той самий ключ на іншому маршруті → 422: область — (X-User, ключ), шлях входить у відбиток', async () => {
    start();
    await post('/expenses', body, { 'idempotency-key': 'shared' });
    expectError(
      expect,
      await post('/categories', { name: 'Авто' }, { 'idempotency-key': 'shared' }),
      422,
    );
  });
});
