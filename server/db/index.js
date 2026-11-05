import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Шлях відносно цього модуля, а не поточної директорії процесу.
const schemaPath = fileURLToPath(new URL('./schema.sql', import.meta.url));

/**
 * Відкриває з'єднання з SQLite, вмикає зовнішні ключі й ініціалізує схему.
 * schema.sql ідемпотентний, тож повторне відкриття тієї ж БД нічого не дублює.
 * @param {string} path шлях до файла БД або `:memory:`
 * @returns {Database}
 */
export function openDb(path) {
  const db = new Database(path, { create: true, strict: true });
  // Прагма діє лише на поточне з'єднання, тому виконується для кожного.
  db.run('PRAGMA foreign_keys = ON');
  db.run(readFileSync(schemaPath, 'utf8'));
  return db;
}
