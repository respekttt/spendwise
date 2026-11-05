import { afterAll, describe, expect, test } from 'bun:test';
import { createApp } from '../server/app.js';

// Фабрика застосунку. Формат помилок — у tests/errors.test.js.
describe('createApp', () => {
  const app = createApp({ dbPath: ':memory:', version: 'test' });

  afterAll(() => app.close());

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
