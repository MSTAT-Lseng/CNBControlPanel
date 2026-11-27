/**
 * Isolated SQLite persistence driver for the Exchange Log Subsystem.
 * Uses a dedicated database file completely independent from the Information Storage Service.
 */

import * as SQLite from 'expo-sqlite';
import type { LogEntry, LogLevel, LogQueryFilter, LogUpdateInput, ServiceSource } from '@/contracts';

const LOG_DB_NAME = 'cnb_panel_logs.db';
const MAX_RETAINED_LOGS = 5000;

interface LogRow {
  id: string;
  timestamp: number;
  level: string;
  source: string;
  action: string;
  message: string;
  details: string | null;
  note: string | null;
}

let logDbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
let insertCounter = 0;

async function openAndMigrateLogDb(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(LOG_DB_NAME);
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS app_logs (
      id TEXT PRIMARY KEY NOT NULL,
      timestamp INTEGER NOT NULL,
      level TEXT NOT NULL,
      source TEXT NOT NULL,
      action TEXT NOT NULL,
      message TEXT NOT NULL,
      details TEXT,
      note TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_app_logs_timestamp ON app_logs(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_app_logs_level ON app_logs(level);
  `);
  return db;
}

async function getLogDb(): Promise<SQLite.SQLiteDatabase> {
  if (!logDbPromise) {
    logDbPromise = openAndMigrateLogDb().catch((err) => {
      logDbPromise = null;
      throw err;
    });
  }
  return logDbPromise;
}

function mapRowToLogEntry(row: LogRow): LogEntry {
  return {
    id: row.id,
    timestamp: row.timestamp,
    level: row.level as LogLevel,
    source: row.source as ServiceSource,
    action: row.action,
    message: row.message,
    details: row.details ?? undefined,
    note: row.note ?? undefined,
  };
}

/**
 * Inserts a batch of log entries inside a single SQLite transaction
 * and periodically prunes records exceeding the retention cap.
 */
export async function insertLogBatch(entries: LogEntry[]): Promise<void> {
  if (entries.length === 0) {
    return;
  }
  const db = await getLogDb();
  await db.withExclusiveTransactionAsync(async (txn) => {
    for (const entry of entries) {
      await txn.runAsync(
        `INSERT OR REPLACE INTO app_logs (id, timestamp, level, source, action, message, details, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          entry.id,
          entry.timestamp,
          entry.level,
          entry.source,
          entry.action,
          entry.message,
          entry.details ?? null,
          entry.note ?? null,
        ],
      );
    }

    insertCounter += entries.length;
    if (insertCounter >= 100) {
      insertCounter = 0;
      await txn.runAsync(
        `DELETE FROM app_logs
         WHERE id NOT IN (
           SELECT id FROM app_logs ORDER BY timestamp DESC LIMIT ?
         )`,
        [MAX_RETAINED_LOGS],
      );
    }
  });
}

/**
 * Queries log entries ordered newest-first with optional filters.
 */
export async function selectLogEntries(filter: LogQueryFilter = {}): Promise<LogEntry[]> {
  const db = await getLogDb();
  const clauses: string[] = [];
  const params: (string | number)[] = [];

  if (filter.levels && filter.levels.length > 0) {
    const placeholders = filter.levels.map(() => '?').join(', ');
    clauses.push(`level IN (${placeholders})`);
    params.push(...filter.levels);
  }

  if (filter.sources && filter.sources.length > 0) {
    const placeholders = filter.sources.map(() => '?').join(', ');
    clauses.push(`source IN (${placeholders})`);
    params.push(...filter.sources);
  }

  const trimmedSearch = filter.search?.trim();
  if (trimmedSearch) {
    const pattern = `%${trimmedSearch}%`;
    clauses.push(`(action LIKE ? OR message LIKE ? OR details LIKE ? OR note LIKE ?)`);
    params.push(pattern, pattern, pattern, pattern);
  }

  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.max(1, Math.min(filter.limit ?? 500, 2000));
  const offset = Math.max(0, filter.offset ?? 0);

  const rows = await db.getAllAsync<LogRow>(
    `SELECT id, timestamp, level, source, action, message, details, note
     FROM app_logs
     ${whereSql}
     ORDER BY timestamp DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  return rows.map(mapRowToLogEntry);
}

/**
 * Updates editable fields (note, level, message) on an existing log entry.
 */
export async function updateLogRow(input: LogUpdateInput): Promise<LogEntry | null> {
  const db = await getLogDb();
  const existing = await db.getFirstAsync<LogRow>(
    `SELECT id, timestamp, level, source, action, message, details, note FROM app_logs WHERE id = ?`,
    [input.id],
  );
  if (!existing) {
    return null;
  }

  const nextLevel = input.level ?? (existing.level as LogLevel);
  const nextMessage = input.message ?? existing.message;
  const nextNote = input.note !== undefined ? input.note : existing.note;

  await db.runAsync(
    `UPDATE app_logs SET level = ?, message = ?, note = ? WHERE id = ?`,
    [nextLevel, nextMessage, nextNote ?? null, input.id],
  );

  return {
    id: existing.id,
    timestamp: existing.timestamp,
    level: nextLevel,
    source: existing.source as ServiceSource,
    action: existing.action,
    message: nextMessage,
    details: existing.details ?? undefined,
    note: nextNote ?? undefined,
  };
}

/**
 * Deletes specific log entries by their IDs.
 */
export async function deleteLogRowsByIds(ids: string[]): Promise<number> {
  if (ids.length === 0) {
    return 0;
  }
  const db = await getLogDb();
  const placeholders = ids.map(() => '?').join(', ');
  const result = await db.runAsync(
    `DELETE FROM app_logs WHERE id IN (${placeholders})`,
    ids,
  );
  return result.changes;
}

/**
 * Deletes only entries strictly older than the supplied epoch-millisecond cutoff.
 */
export async function deleteLogRowsBefore(
  cutoff: number,
  shouldRun: () => boolean,
): Promise<number | null> {
  const db = await getLogDb();
  // Opening SQLite can yield long enough for the policy or foreground state to change.
  if (!shouldRun()) {
    return null;
  }
  const result = await db.runAsync('DELETE FROM app_logs WHERE timestamp < ?', [cutoff]);
  return result.changes;
}

/**
 * Deletes every record in the log database and returns the removed count.
 */
export async function clearAllLogRows(): Promise<number> {
  const db = await getLogDb();
  const result = await db.runAsync(`DELETE FROM app_logs`);
  return result.changes;
}
