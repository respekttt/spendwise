import { afterAll, expect, test } from 'bun:test';
import { createApp } from '../server/app.js';

const app = createApp({ dbPath: ':memory:' });

afterAll(() => app.close());

test('smoke: застосунок з :memory: відповідає на GET /version', async () => {
  const res = await app.inject({ method: 'GET', url: '/version' });

  expect(res.statusCode).toBe(200);
  expect(res.headers['content-type']).toStartWith('text/plain');
  expect(res.body.trim().length).toBeGreaterThan(0);
});
