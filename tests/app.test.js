import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createApp } from '../server/app.js';

// Формат помилок за контрактом API («Загальні правила»).
describe('обробка помилок', () => {
  const app = createApp({ dbPath: ':memory:', version: 'test' });

  beforeAll(async () => {
    // Тимчасові маршрути лише для перевірки обробників помилок каркаса.
    app.get(
      '/__test/items/:id',
      {
        schema: { params: { type: 'object', properties: { id: { type: 'integer', minimum: 1 } } } },
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
    app.get('/__test/boom', async () => {
      throw new Error('boom');
    });
    await app.ready();
  });

  afterAll(() => app.close());

  test('невідомий маршрут → 404 з тілом { error }', async () => {
    const res = await app.inject({ method: 'GET', url: '/no-such-route' });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: expect.any(String) });
  });

  test('помилка валідації тіла → 400 з тілом { error }', async () => {
    const res = await app.inject({ method: 'POST', url: '/__test/items', payload: {} });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: expect.any(String) });
  });

  test('некоректний JSON → 400 з тілом { error }', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/__test/items',
      headers: { 'content-type': 'application/json' },
      payload: '{ not json',
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: expect.any(String) });
  });

  test('нечисловий :id (помилка схеми params) → 404, а не 400', async () => {
    const res = await app.inject({ method: 'GET', url: '/__test/items/abc' });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: expect.any(String) });
  });

  test('неочікуваний виняток → 500 без деталей', async () => {
    const res = await app.inject({ method: 'GET', url: '/__test/boom' });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'Внутрішня помилка сервера' });
  });

  test('public/index.html віддається як статика', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toStartWith('text/html');
  });

  test('годинник з фабрики доступний маршрутам', () => {
    const fixed = new Date('2026-07-15T21:30:00Z');
    const clocked = createApp({ dbPath: ':memory:', version: 'test', now: () => fixed });

    expect(clocked.now()).toBe(fixed);
    return clocked.close();
  });
});
