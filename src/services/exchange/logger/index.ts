/**
 * Log Subsystem belonging to the Update Exchange Service.
 * Provides queued, crash-resilient V/I/W/E logging with full CRUD operations
 * physically isolated from the Information Storage Service.
 */

import type {
  LogEntry,
  LogLevel,
  LogQueryFilter,
  LogReporter,
  LogUpdateInput,
  ServiceResult,
  ServiceSource,
} from '@/contracts';
import {
  clearAllLogRows,
  deleteLogRowsByIds,
  deleteLogRowsBefore,
  insertLogBatch,
  selectLogEntries,
  updateLogRow,
} from './logDatabase';

const FALLBACK_BUFFER_LIMIT = 400;

export class LogSubsystem {
  private pendingQueue: LogEntry[] = [];
  private fallbackBuffer: LogEntry[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private mutationTail: Promise<void> = Promise.resolve();
  private sequence = 0;
  private listeners = new Set<() => void>();

  /**
   * Returns a LogReporter bound to a specific service source.
   */
  createReporter(source: ServiceSource): LogReporter {
    return {
      verbose: (action, message, details) => this.record('V', source, action, message, details),
      info: (action, message, details) => this.record('I', source, action, message, details),
      warn: (action, message, details) => this.record('W', source, action, message, details),
      error: (action, message, details) => this.record('E', source, action, message, details),
    };
  }

  /**
   * Appends a structured log entry asynchronously without throwing to callers.
   */
  record(
    level: LogLevel,
    source: ServiceSource,
    action: string,
    message: string,
    details?: string,
  ): void {
    const timestamp = Date.now();
    this.sequence = (this.sequence + 1) % 100_000;
    const id = `${timestamp}_${this.sequence.toString().padStart(5, '0')}`;

    const entry: LogEntry = {
      id,
      timestamp,
      level,
      source,
      action,
      message,
      details,
    };

    this.fallbackBuffer.unshift(entry);
    if (this.fallbackBuffer.length > FALLBACK_BUFFER_LIMIT) {
      this.fallbackBuffer.length = FALLBACK_BUFFER_LIMIT;
    }

    this.pendingQueue.push(entry);
    this.scheduleFlush();
    this.notifyListeners();
  }

  /**
   * Flushes all queued entries immediately to the isolated SQLite log database.
   */
  flush(): Promise<void> {
    return this.serializeMutation(() => this.flushPending());
  }

  private async flushPending(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.pendingQueue.length === 0) {
      return;
    }

    try {
      while (this.pendingQueue.length > 0) {
        const batch = this.pendingQueue.splice(0, 100);
        await insertLogBatch(batch);
      }
    } catch (err) {
      // Keep recent entries in fallbackBuffer if SQLite fails temporarily.
      if (__DEV__) {
        console.warn('[LogSubsystem] Failed to flush logs to SQLite:', err);
      }
    } finally {
      if (this.pendingQueue.length > 0) {
        this.scheduleFlush();
      }
    }
  }

  async queryLogs(filter: LogQueryFilter = {}): Promise<ServiceResult<LogEntry[]>> {
    try {
      await this.flush();
      const rows = await selectLogEntries(filter);
      return { ok: true, data: rows, timestamp: Date.now() };
    } catch (err) {
      const filteredFallback = this.filterFallbackLogs(filter);
      if (filteredFallback.length > 0) {
        return { ok: true, data: filteredFallback, timestamp: Date.now() };
      }
      return {
        ok: false,
        error: {
          code: 'LOGGER_ERROR',
          message: 'Failed to query application logs',
          cause: err instanceof Error ? err.message : String(err),
        },
        timestamp: Date.now(),
      };
    }
  }

  updateLog(input: LogUpdateInput): Promise<ServiceResult<LogEntry>> {
    return this.serializeMutation(() => this.updateLogExclusive(input));
  }

  private async updateLogExclusive(input: LogUpdateInput): Promise<ServiceResult<LogEntry>> {
    const id = input.id.trim();
    if (!id) {
      return {
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: 'Log ID is required' },
        timestamp: Date.now(),
      };
    }

    try {
      await this.flushPending();
      const updated = await updateLogRow({ ...input, id });
      if (!updated) {
        return {
          ok: false,
          error: { code: 'NOT_FOUND', message: `Log entry "${id}" not found` },
          timestamp: Date.now(),
        };
      }
      const fallbackItem = this.fallbackBuffer.find((item) => item.id === id);
      if (fallbackItem) {
        fallbackItem.level = updated.level;
        fallbackItem.message = updated.message;
        fallbackItem.note = updated.note;
      }
      this.notifyListeners();
      return { ok: true, data: updated, timestamp: Date.now() };
    } catch (err) {
      return {
        ok: false,
        error: {
          code: 'LOGGER_ERROR',
          message: 'Failed to update log entry',
          cause: err instanceof Error ? err.message : String(err),
        },
        timestamp: Date.now(),
      };
    }
  }

  deleteLogs(ids: string[]): Promise<ServiceResult<{ deletedCount: number }>> {
    return this.serializeMutation(() => this.deleteLogsExclusive(ids));
  }

  private async deleteLogsExclusive(ids: string[]): Promise<ServiceResult<{ deletedCount: number }>> {
    const cleanIds = ids.map((id) => id.trim()).filter(Boolean);
    if (cleanIds.length === 0) {
      return {
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: 'At least one log ID must be provided' },
        timestamp: Date.now(),
      };
    }

    try {
      await this.flushPending();
      const deletedCount = await deleteLogRowsByIds(cleanIds);
      const idSet = new Set(cleanIds);
      this.fallbackBuffer = this.fallbackBuffer.filter((item) => !idSet.has(item.id));
      this.notifyListeners();
      return { ok: true, data: { deletedCount }, timestamp: Date.now() };
    } catch (err) {
      return {
        ok: false,
        error: {
          code: 'LOGGER_ERROR',
          message: 'Failed to delete selected logs',
          cause: err instanceof Error ? err.message : String(err),
        },
        timestamp: Date.now(),
      };
    }
  }

  clearLogs(): Promise<ServiceResult<{ clearedCount: number }>> {
    return this.serializeMutation(() => this.clearLogsExclusive());
  }

  private async clearLogsExclusive(): Promise<ServiceResult<{ clearedCount: number }>> {
    try {
      if (this.flushTimer) {
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
      }
      const pendingCount = this.pendingQueue.length;
      this.pendingQueue = [];
      this.fallbackBuffer = [];
      const dbCount = await clearAllLogRows();
      this.notifyListeners();
      return {
        ok: true,
        data: { clearedCount: dbCount + pendingCount },
        timestamp: Date.now(),
      };
    } catch (err) {
      return {
        ok: false,
        error: {
          code: 'LOGGER_ERROR',
          message: 'Failed to clear logs',
          cause: err instanceof Error ? err.message : String(err),
        },
        timestamp: Date.now(),
      };
    }
  }

  /**
   * Serializes expiration with pending writes and manual clearing so old batches cannot reappear.
   * The guard rechecks lifecycle and settings after waiting for earlier database operations.
   */
  deleteExpiredLogs(
    cutoff: number,
    shouldRun: () => boolean,
  ): Promise<ServiceResult<{ deletedCount: number }>> {
    return this.serializeMutation(async () => {
      if (!shouldRun()) {
        return { ok: true, data: { deletedCount: 0 }, timestamp: Date.now() };
      }
      if (!Number.isFinite(cutoff) || cutoff <= 0) {
        return {
          ok: false,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid log expiration cutoff' },
          timestamp: Date.now(),
        };
      }
      try {
        const dbCount = await deleteLogRowsBefore(cutoff, shouldRun);
        if (dbCount === null) {
          return { ok: true, data: { deletedCount: 0 }, timestamp: Date.now() };
        }
        const pendingCount = this.pendingQueue.filter((entry) => entry.timestamp < cutoff).length;
        const hadExpiredFallback = this.fallbackBuffer.some((entry) => entry.timestamp < cutoff);
        this.pendingQueue = this.pendingQueue.filter((entry) => entry.timestamp >= cutoff);
        this.fallbackBuffer = this.fallbackBuffer.filter((entry) => entry.timestamp >= cutoff);
        if (dbCount > 0 || pendingCount > 0 || hadExpiredFallback) {
          this.notifyListeners();
        }
        return {
          ok: true,
          data: { deletedCount: dbCount + pendingCount },
          timestamp: Date.now(),
        };
      } catch (err) {
        return {
          ok: false,
          error: {
            code: 'LOGGER_ERROR',
            message: 'Failed to delete expired application logs',
            cause: err instanceof Error ? err.message : String(err),
          },
          timestamp: Date.now(),
        };
      }
    });
  }

  private serializeMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(operation);
    this.mutationTail = result.then(() => undefined, () => undefined);
    return result;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private scheduleFlush(): void {
    if (this.flushTimer) {
      return;
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, 60);
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private filterFallbackLogs(filter: LogQueryFilter): LogEntry[] {
    const search = filter.search?.trim().toLowerCase();
    return this.fallbackBuffer.filter((entry) => {
      if (filter.levels && filter.levels.length > 0 && !filter.levels.includes(entry.level)) {
        return false;
      }
      if (filter.sources && filter.sources.length > 0 && !filter.sources.includes(entry.source)) {
        return false;
      }
      if (search) {
        const haystack = `${entry.action} ${entry.message} ${entry.details ?? ''} ${entry.note ?? ''}`.toLowerCase();
        if (!haystack.includes(search)) {
          return false;
        }
      }
      return true;
    });
  }
}
