-- Схема БД Expense Tracker — джерело істини для обмежень даних.
-- Пов'язано: spec.md (розд. 3), ADR 001 (гроші), ADR 002 (назви категорій).
-- Скрипт ідемпотентний: повторний запуск нічого не дублює.
-- PRAGMA foreign_keys = ON сюди не входить: прагма діє на з'єднання, тож
-- server/db/ виконує її одразу після відкриття кожного з'єднання.

CREATE TABLE IF NOT EXISTS categories (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT    NOT NULL,              -- trim() + NFC, як ввів користувач
  name_normalized TEXT    NOT NULL UNIQUE,       -- trim().normalize('NFC').toLocaleLowerCase('uk'), ADR 002
  limit_amount    REAL    CHECK (limit_amount IS NULL OR limit_amount > 0),
  is_default      INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  CHECK (is_default = 0 OR limit_amount IS NULL) -- «Інше» без ліміту
);

-- Не більше однієї системної категорії
CREATE UNIQUE INDEX IF NOT EXISTS categories_single_default
  ON categories (is_default) WHERE is_default = 1;

CREATE TABLE IF NOT EXISTS expenses (
  id          INTEGER  PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER  NOT NULL REFERENCES categories (id) ON DELETE RESTRICT,
  amount      REAL     NOT NULL CHECK (amount > 0), -- округлено до 2 знаків, ADR 001
  description TEXT     NOT NULL DEFAULT '',
  spent_at    TEXT     NOT NULL
              CHECK (spent_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP -- UTC
);

CREATE INDEX IF NOT EXISTS expenses_category_spent_at ON expenses (category_id, spent_at);
CREATE INDEX IF NOT EXISTS expenses_spent_at ON expenses (spent_at);

-- Системна категорія «Інше» — лише якщо її ще немає
INSERT INTO categories (name, name_normalized, is_default)
SELECT 'Інше', 'інше', 1
WHERE NOT EXISTS (SELECT 1 FROM categories WHERE is_default = 1);
