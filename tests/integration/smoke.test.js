import { afterAll, expect, test } from 'bun:test';
import { createApp } from '../../server/app.js';
import { createMemoryStore } from '../../server/repositories/memory/index.js';

const app = createApp({ store: createMemoryStore() });

afterAll(() => app.close());

test('smoke: застосунок на in-memory сховищі відповідає на GET /version', async () => {
  const res = await app.inject({ method: 'GET', url: '/version' });

  expect(res.statusCode).toBe(200);
  expect(res.headers['content-type']).toStartWith('text/plain');
  expect(res.body.trim().length).toBeGreaterThan(0);
});
