import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { defaultDbPath } from '../../server/main.js';

// Перенесено з e2e/startup.test.js: функція від env і platform, без процесу (specs/testing.md, розд. 2).

describe('DB_PATH за замовчуванням (ADR 008)', () => {
  test('Windows: %LOCALAPPDATA%spendwisespendwise.db', () => {
    expect(defaultDbPath({ env: { LOCALAPPDATA: 'C:L' }, platform: 'win32' })).toBe(
      join('C:L', 'spendwise', 'spendwise.db'),
    );
  });

  test('Linux/macOS: XDG_DATA_HOME або ~/.local/share', () => {
    expect(defaultDbPath({ env: { XDG_DATA_HOME: '/x' }, platform: 'linux' })).toBe(
      join('/x', 'spendwise', 'spendwise.db'),
    );
    expect(defaultDbPath({ env: {}, platform: 'darwin' })).toEndWith(
      join('.local', 'share', 'spendwise', 'spendwise.db'),
    );
  });
});
