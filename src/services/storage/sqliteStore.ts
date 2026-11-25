/**
 * SQLite persistence adapter for structured table/key/value records.
 * Uses a single SQLite database dedicated to the Information Storage Service.
 */

import * as SQLite from 'expo-sqlite';

const STORAGE_DB_NAME = 'cnb_panel_storage.db';

export interface StoredRecordRow {
  record_key: string;
  value_json: string;
  updated_at: number;
}

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function openAndMigrate(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(STORAGE_DB_NAME);
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS storage_records (
      table_name TEXT NOT NULL,
      record_key TEXT NOT NULL,
      value_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (table_name, record_key)
    );
    CREATE INDEX IF NOT EXISTS idx_storage_records_table
      ON storage_records(table_name);
  `);
  return db;
}

/**
 * Lazily initializes and returns the shared SQLite storage database instance.
 */
export async function getStorageDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = openAndMigrate().catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

/**
 * Upserts a JSON-serialized value into a logical table and key.
 */
export async function upsertSqliteRecord(
  table: string,
  key: string,
  valueJson: string,
  updatedAt: number,
): Promise<void> {
  const db = await getStorageDatabase();
  await db.runAsync(
    `INSERT INTO storage_records (table_name, record_key, value_json, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(table_name, record_key)
     DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    [table, key, valueJson, updatedAt],
  );
}

/**
 * Reads a single record by logical table and key.
 */
export async function selectSqliteRecord(
  table: string,
  key: string,
): Promise<StoredRecordRow | null> {
  const db = await getStorageDatabase();
  return db.getFirstAsync<StoredRecordRow>(
    `SELECT record_key, value_json, updated_at
     FROM storage_records
     WHERE table_name = ? AND record_key = ?`,
    [table, key],
  );
}

/**
 * Deletes a single record and returns whether a row was removed.
 */
export async function deleteSqliteRecord(table: string, key: string): Promise<boolean> {
  const db = await getStorageDatabase();
  const result = await db.runAsync(
    `DELETE FROM storage_records WHERE table_name = ? AND record_key = ?`,
    [table, key],
  );
  return result.changes > 0;
}

/**
 * Lists all records belonging to a logical table.
 */
export async function selectSqliteTable(table: string): Promise<StoredRecordRow[]> {
  const db = await getStorageDatabase();
  return db.getAllAsync<StoredRecordRow>(
    `SELECT record_key, value_json, updated_at
     FROM storage_records
     WHERE table_name = ?
     ORDER BY updated_at ASC`,
    [table],
  );
}

/**
 * Clears all records inside a logical table and returns the number of deleted rows.
 */
export async function clearSqliteTable(table: string): Promise<number> {
  const db = await getStorageDatabase();
  const result = await db.runAsync(
    `DELETE FROM storage_records WHERE table_name = ?`,
    [table],
  );
  return result.changes;
}
