/**
 * Information Storage Service.
 * Provides generic table/key/value persistence backed by expo-sqlite and expo-secure-store.
 * Strictly isolated from UI, Parser, and Exchange business rules.
 */

import type {
  LogReporter,
  ServiceResult,
  StorageClearTableData,
  StorageKeyInput,
  StoragePort,
  StorageReadData,
  StorageRemoveData,
  StorageSaveData,
  StorageSaveInput,
  StorageTableRecord,
} from '@/contracts';
import {
  deleteSecretPayload,
  readSecretPayload,
  saveSecretPayload,
} from './secureCookieStore';
import {
  clearSqliteTable,
  deleteSqliteRecord,
  selectSqliteRecord,
  selectSqliteTable,
  upsertSqliteRecord,
} from './sqliteStore';

const SECURE_TABLES = new Set<string>(['accounts_secrets']);

interface SecureEnvelope {
  __secureRef: true;
  updatedAt: number;
}

function makeOk<T>(data: T): ServiceResult<T> {
  return { ok: true, data, timestamp: Date.now() };
}

function makeError<T>(
  code: 'VALIDATION_ERROR' | 'STORAGE_ERROR',
  message: string,
  cause?: unknown,
): ServiceResult<T> {
  return {
    ok: false,
    error: {
      code,
      message,
      cause: cause instanceof Error ? cause.message : cause ? String(cause) : undefined,
    },
    timestamp: Date.now(),
  };
}

function normalizeIdentifier(raw: string): string {
  return typeof raw === 'string' ? raw.trim() : '';
}

function parseJsonValue<T>(rawJson: string): T {
  return JSON.parse(rawJson) as T;
}

/**
 * Creates a StoragePort implementation bound to an injected LogReporter.
 */
export function createStorageService(logger: LogReporter): StoragePort {
  return {
    async save(input: StorageSaveInput): Promise<ServiceResult<StorageSaveData>> {
      const table = normalizeIdentifier(input.table);
      const key = normalizeIdentifier(input.key);

      if (!table || !key) {
        logger.warn('storage.save', 'Rejected save with empty table or key', `table="${table}" key="${key}"`);
        return makeError('VALIDATION_ERROR', 'Table and key must be non-empty strings');
      }

      const savedAt = Date.now();
      logger.verbose('storage.save', `Saving record to table "${table}"`, `key=${key}`);

      try {
        const serialized = JSON.stringify(input.value);
        if (serialized === undefined) {
          logger.warn('storage.save', 'Attempted to serialize undefined value', `table=${table} key=${key}`);
          return makeError('VALIDATION_ERROR', 'Storage value must be JSON-serializable');
        }

        if (SECURE_TABLES.has(table)) {
          await saveSecretPayload(table, key, serialized);
          const indexEnvelope: SecureEnvelope = { __secureRef: true, updatedAt: savedAt };
          await upsertSqliteRecord(table, key, JSON.stringify(indexEnvelope), savedAt);
          logger.info('storage.save', `Saved encrypted secret to Keychain for "${table}"`, `key=${key}`);
        } else {
          await upsertSqliteRecord(table, key, serialized, savedAt);
          logger.info('storage.save', `Saved record to SQLite table "${table}"`, `key=${key}`);
        }

        return makeOk({ table, key, savedAt });
      } catch (err) {
        logger.error('storage.save', `Failed to save record in "${table}"`, String(err));
        return makeError('STORAGE_ERROR', `Failed to persist key "${key}" in table "${table}"`, err);
      }
    },

    async read<T = unknown>(input: StorageKeyInput): Promise<ServiceResult<StorageReadData<T>>> {
      const table = normalizeIdentifier(input.table);
      const key = normalizeIdentifier(input.key);

      if (!table || !key) {
        logger.warn('storage.read', 'Rejected read with empty table or key', `table="${table}" key="${key}"`);
        return makeError('VALIDATION_ERROR', 'Table and key must be non-empty strings');
      }

      logger.verbose('storage.read', `Reading record from table "${table}"`, `key=${key}`);

      try {
        if (SECURE_TABLES.has(table)) {
          const indexRow = await selectSqliteRecord(table, key);
          const secretJson = await readSecretPayload(table, key);
          if (secretJson === null) {
            logger.verbose('storage.read', `No secret entry found in "${table}"`, `key=${key}`);
            return makeOk({ table, key, exists: false, value: null, updatedAt: null });
          }
          const value = parseJsonValue<T>(secretJson);
          const updatedAt = indexRow?.updated_at ?? null;
          logger.info('storage.read', `Read encrypted secret from "${table}"`, `key=${key}`);
          return makeOk({ table, key, exists: true, value, updatedAt });
        }

        const row = await selectSqliteRecord(table, key);
        if (!row) {
          logger.verbose('storage.read', `Record not found in "${table}"`, `key=${key}`);
          return makeOk({ table, key, exists: false, value: null, updatedAt: null });
        }

        const value = parseJsonValue<T>(row.value_json);
        logger.info('storage.read', `Read record from "${table}"`, `key=${key}`);
        return makeOk({ table, key, exists: true, value, updatedAt: row.updated_at });
      } catch (err) {
        logger.error('storage.read', `Failed to read record in "${table}"`, String(err));
        return makeError('STORAGE_ERROR', `Failed to read key "${key}" from table "${table}"`, err);
      }
    },

    async remove(input: StorageKeyInput): Promise<ServiceResult<StorageRemoveData>> {
      const table = normalizeIdentifier(input.table);
      const key = normalizeIdentifier(input.key);

      if (!table || !key) {
        logger.warn('storage.remove', 'Rejected remove with empty table or key');
        return makeError('VALIDATION_ERROR', 'Table and key must be non-empty strings');
      }

      logger.verbose('storage.remove', `Deleting record from "${table}"`, `key=${key}`);

      try {
        if (SECURE_TABLES.has(table)) {
          await deleteSecretPayload(table, key);
        }
        const deleted = await deleteSqliteRecord(table, key);
        logger.info('storage.remove', `Deleted record from "${table}"`, `key=${key} deleted=${deleted}`);
        return makeOk({ table, key, deleted });
      } catch (err) {
        logger.error('storage.remove', `Failed to delete record from "${table}"`, String(err));
        return makeError('STORAGE_ERROR', `Failed to delete key "${key}" from table "${table}"`, err);
      }
    },

    async readTable<T = unknown>(input: {
      table: string;
    }): Promise<ServiceResult<StorageTableRecord<T>[]>> {
      const table = normalizeIdentifier(input.table);
      if (!table) {
        logger.warn('storage.readTable', 'Rejected readTable with empty table name');
        return makeError('VALIDATION_ERROR', 'Table name must be a non-empty string');
      }

      logger.verbose('storage.readTable', `Reading all records from "${table}"`);

      try {
        const rows = await selectSqliteTable(table);
        const records: StorageTableRecord<T>[] = [];

        for (const row of rows) {
          if (SECURE_TABLES.has(table)) {
            const secretJson = await readSecretPayload(table, row.record_key);
            if (secretJson !== null) {
              records.push({
                key: row.record_key,
                value: parseJsonValue<T>(secretJson),
                updatedAt: row.updated_at,
              });
            }
          } else {
            records.push({
              key: row.record_key,
              value: parseJsonValue<T>(row.value_json),
              updatedAt: row.updated_at,
            });
          }
        }

        logger.info('storage.readTable', `Loaded ${records.length} record(s) from "${table}"`);
        return makeOk(records);
      } catch (err) {
        logger.error('storage.readTable', `Failed to read table "${table}"`, String(err));
        return makeError('STORAGE_ERROR', `Failed to read table "${table}"`, err);
      }
    },

    async clearTable(input: { table: string }): Promise<ServiceResult<StorageClearTableData>> {
      const table = normalizeIdentifier(input.table);
      if (!table) {
        logger.warn('storage.clearTable', 'Rejected clearTable with empty table name');
        return makeError('VALIDATION_ERROR', 'Table name must be a non-empty string');
      }

      logger.verbose('storage.clearTable', `Clearing all records in "${table}"`);

      try {
        if (SECURE_TABLES.has(table)) {
          const rows = await selectSqliteTable(table);
          for (const row of rows) {
            await deleteSecretPayload(table, row.record_key);
          }
        }
        const clearedCount = await clearSqliteTable(table);
        logger.info('storage.clearTable', `Cleared ${clearedCount} record(s) from "${table}"`);
        return makeOk({ table, clearedCount });
      } catch (err) {
        logger.error('storage.clearTable', `Failed to clear table "${table}"`, String(err));
        return makeError('STORAGE_ERROR', `Failed to clear table "${table}"`, err);
      }
    },
  };
}
