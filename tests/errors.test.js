import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Writable } from 'node:stream';
import { createApp } from '../server/app.js';
import { HttpError } from '../server/errors.js';

// Формат помилок за контрактом API («Загальні правила»).
// Точний текст перевіряється лише для 500 — його фіксує контракт; для решти — код і непорожній рядок.

const SECRET =
  'SQLITE_ERROR: no such table: expenses_secret at C:\\srv\\spendwise\\server\\db\\index.js:42';

/** Логер у пам'яті: Fastify пише в цей потік JSON-рядки pino, stdout не читається. */
function memoryLogger() {
  const records = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      for (const line of chunk.toString().split('\n')) {
        if (line.trim()) records.push(JSON.parse(line));
      }
      callback();
    },
  });
  return { records, options: { level: 'error', stream } };
}

/** Перевіряє код, `Content-Type` і тіло рівно `{ error: <непорожній рядок> }`. */
function expectErrorResponse(res, status) {
  expect(res.statusCode).toBe(status);
  expect(res.headers['content-type']).toStartWith('application/json');
  const body = res.json();
  expect(Object.keys(body)).toEqual(['error']);
  expect(typeof body.error).toBe('string');
  expect(body.error.trim().length).toBeGreaterThan(0);
  return body;
}

describe('обробка помилок', () => {
  const log = memoryLogger();
  const app = createApp({ dbPath: ':memory:', version: 'test', logger: log.options });

  beforeAll(async () => {
    // Тимчасові маршрути лише для перевірки обробників помилок; у робочому застосунку їх немає.
    app.get(
      '/__test/items/:id',
      {
        schema: {
          params: {
            type: 'object',
            required: ['id'],
            properties: { id: { type: 'integer', minimum: 1 } },
          },
        },
      },
      async () => ({ ok: true }),
    );
    app.post(
      '/__test/items',
      {
        schema: {
          body: {
            type: 'object',
            required: ['amount'],
            properties: { amount: { type: 'number' } },
          },
        },
      },
      async () => ({ ok: true }),
    );
    app.get('/__test/field-error', async () => {
      throw new HttpError(400, 'amount: сума має бути більшою за 0');
    });
    app.get('/__test/missing', async () => {
      throw new HttpError(404, 'Витрату не знайдено');
    });
    app.get('/__test/boom', async () => {
      throw new Error(SECRET);
    });
    app.get('/__test/boom-text', async (_request, reply) => {
      reply.type('text/plain');
      throw new Error(SECRET);
    });
    app.get('/__test/boom-5xx', async () => {
      throw Object.assign(new Error(SECRET), { statusCode: 503 });
    });
    app.get('/__test/boom-3xx', async () => {
      throw Object.assign(new Error(SECRET), { statusCode: 302 });
    });
    app.get('/__test/fastify-4xx', async () => {
      throw Object.assign(new Error('Some English internal text'), { statusCode: 409 });
    });
    await app.ready();
  });

  afterAll(() => app.close());

  test('невідомий маршрут → 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/no-such-route' });
    expectErrorResponse(res, 404);
  });

  for (const id of ['abc', '0', '-1', '1.5']) {
    test(`:id = ${id} (помилка схеми params) → 404, а не 400`, async () => {
      const res = await app.inject({ method: 'GET', url: `/__test/items/${id}` });
      expectErrorResponse(res, 404);
    });
  }

  test('валідний :id проходить схему params', async () => {
    const res = await app.inject({ method: 'GET', url: '/__test/items/1' });
    expect(res.statusCode).toBe(200);
  });

  test('помилка схеми тіла → 400', async () => {
    const res = await app.inject({ method: 'POST', url: '/__test/items', payload: {} });
    expectErrorResponse(res, 400);
  });

  test('невалідний JSON → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/__test/items',
      headers: { 'content-type': 'application/json' },
      payload: '{ not json',
    });
    expectErrorResponse(res, 400);
  });

  test('порожнє тіло з application/json → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/__test/items',
      headers: { 'content-type': 'application/json' },
      payload: '',
    });
    expectErrorResponse(res, 400);
  });

  test('непідтримуваний Content-Type → 415', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/__test/items',
      headers: { 'content-type': 'application/xml' },
      payload: '<amount>1</amount>',
    });
    expectErrorResponse(res, 415);
  });

  test('тіло понад bodyLimit → 413', async () => {
    // Ліміт Fastify за замовчуванням — 1 MiB.
    const res = await app.inject({
      method: 'POST',
      url: '/__test/items',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ amount: 1, pad: 'x'.repeat(1024 * 1024) }),
    });
    expectErrorResponse(res, 413);
  });

  test('інша 4xx зберігає код, англійський текст не потрапляє у відповідь', async () => {
    const res = await app.inject({ method: 'GET', url: '/__test/fastify-4xx' });
    const body = expectErrorResponse(res, 409);
    expect(body.error).not.toContain('English');
  });

  test('HttpError 400 з текстом поля → 400 з цим текстом', async () => {
    const res = await app.inject({ method: 'GET', url: '/__test/field-error' });
    const body = expectErrorResponse(res, 400);
    expect(body.error).toBe('amount: сума має бути більшою за 0');
  });

  test('HttpError 404 → 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/__test/missing' });
    expectErrorResponse(res, 404);
  });

  test('HttpError приймає лише 4xx', () => {
    expect(() => new HttpError(500, 'x')).toThrow(TypeError);
    expect(() => new HttpError(200)).toThrow(TypeError);
    expect(new HttpError(404).message.length).toBeGreaterThan(0);
  });

  for (const [name, url] of [
    ['неочікуваний виняток', '/__test/boom'],
    ['виняток після reply.type(text/plain)', '/__test/boom-text'],
    ['помилка з кодом >= 500', '/__test/boom-5xx'],
    ['помилка з кодом < 400', '/__test/boom-3xx'],
  ]) {
    test(`${name} → 500 без деталей`, async () => {
      const res = await app.inject({ method: 'GET', url });

      expectErrorResponse(res, 500);
      expect(res.json()).toEqual({ error: 'Внутрішня помилка сервера' });
      expect(res.body).not.toContain('SQLITE');
      expect(res.body).not.toContain('spendwise');
    });
  }

  test('500 логується через логер, переданий у фабрику', async () => {
    log.records.length = 0;
    await app.inject({ method: 'GET', url: '/__test/boom' });

    const errors = log.records.filter((r) => r.level >= 50);
    expect(errors.length).toBe(1);
    expect(errors[0].err.message).toBe(SECRET);
    expect(errors[0].err.stack).toContain('Error');
  });

  test('клієнтські помилки не логуються як error', async () => {
    log.records.length = 0;
    await app.inject({ method: 'GET', url: '/__test/field-error' });
    await app.inject({ method: 'GET', url: '/__test/items/abc' });

    expect(log.records.filter((r) => r.level >= 50)).toEqual([]);
  });
});
