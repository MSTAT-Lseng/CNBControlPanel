/**
 * Structured service result envelopes and storage payload contracts.
 */

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'ALREADY_EXISTS'
  | 'STORAGE_ERROR'
  | 'PARSER_ERROR'
  | 'EXCHANGE_ERROR'
  | 'LOGGER_ERROR'
  | 'UNKNOWN_ERROR';

export interface ServiceError {
  code: ErrorCode;
  message: string;
  cause?: string;
}

export type ServiceResult<T> =
  | {
      ok: true;
      data: T;
      timestamp: number;
    }
  | {
      ok: false;
      error: ServiceError;
      timestamp: number;
    };

export interface StorageSaveInput {
  table: string;
  key: string;
  value: unknown;
}

export interface StorageSaveData {
  table: string;
  key: string;
  savedAt: number;
}

export interface StorageKeyInput {
  table: string;
  key: string;
}

export interface StorageReadData<T> {
  table: string;
  key: string;
  exists: boolean;
  value: T | null;
  updatedAt: number | null;
}

export interface StorageRemoveData {
  table: string;
  key: string;
  deleted: boolean;
}

export interface StorageTableRecord<T> {
  key: string;
  value: T;
  updatedAt: number;
}

export interface StorageClearTableData {
  table: string;
  clearedCount: number;
}
