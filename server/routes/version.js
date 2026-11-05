import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

/**
 * Визначає версію застосунку (контракт API, `GET /version`):
 * `GIT_SHA` → `git rev-parse --short HEAD` → `unknown`.
 * Викликається один раз під час створення застосунку.
 * @param {{ env?: Record<string, string | undefined>, cwd?: string }} [options]
 * @returns {string}
 */
export function resolveVersion({ env = process.env, cwd = repoRoot } = {}) {
  const fromEnv = env.GIT_SHA?.trim();
  if (fromEnv) return fromEnv;

  try {
    const result = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd,
      env,
      encoding: 'utf8',
      timeout: 5000,
    });
    const sha = result.status === 0 ? result.stdout.trim() : '';
    if (sha) return sha;
  } catch {
    // git не встановлено або недоступний — переходимо до запасного значення.
  }
  return 'unknown';
}

/**
 * @param {import('fastify').FastifyInstance} app
 * @param {{ version: string }} options
 */
export async function versionRoutes(app, { version }) {
  app.get('/version', async (_request, reply) => {
    reply.type('text/plain; charset=utf-8');
    return version;
  });
}
