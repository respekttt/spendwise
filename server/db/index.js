import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Шлях відносно цього модуля, а не поточної директорії процесу.
const schemaPath = fileURLToPath(new URL('./schema.sql', import.meta.url));

/**
 * Відкриває з'єднання з SQLite за ADR 008: `foreign_keys`, `busy_timeout`, `schema.sql`.
 * schema.sql ідемпотентний, тож повторне відкриття тієї ж БД нічого не дублює.
 * @param {string} path шлях до файла БД або `:memory:`
 * @param {{ busyTimeoutMs?: number }} [options] ADR 010: `0`, чекання лише через ретраї
 * @returns {Database}
 */
export function openDb(path, { busyTimeoutMs = 0 } = {}) {
  const db = new Database(path, { create: true, strict: true });
  try {
    // Прагми діють лише на поточне з'єднання, тому виконуються для кожного.
    db.run('PRAGMA foreign_keys = ON');
    db.run(`PRAGMA busy_timeout = ${Math.trunc(Number(busyTimeoutMs))}`);
    db.run(readFileSync(schemaPath, 'utf8'));
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}

/**
 * Перевірка БД на старті (ADR 008, чотири кроки): відкрити файл, виконати схему,
 * `PRAGMA foreign_keys = 1`, «Інше» рівно одна. Кидає помилку, процес не завершує.
 * @param {string} path
 * @param {{ busyTimeoutMs?: number }} [options]
 * @returns {Database} відкрите й перевірене з'єднання
 */
export function openCheckedDb(path, options) {
  const db = openDb(path, options); // кроки 1–2: SQLITE_CANTOPEN, SQLITE_NOTADB, помилка схеми
  try {
    verifyDb(db);
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}

/** Кроки 3–4 перевірки старту на вже відкритому з'єднанні. @param {Database} db */
export function verifyDb(db) {
  const { foreign_keys } = db.query('PRAGMA foreign_keys').get();
  if (foreign_keys !== 1) throw new Error(`PRAGMA foreign_keys = ${foreign_keys}, очікується 1`);
  const defaults = db.query('SELECT id FROM categories WHERE is_default = 1').all();
  if (defaults.length !== 1) {
    throw new Error(`категорій «Інше»: ${defaults.length}, очікується рівно одна`);
  }
}
