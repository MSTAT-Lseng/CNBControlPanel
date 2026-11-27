/**
 * Foreground-only log retention checks, independent of account refresh settings.
 * Expo Go cannot guarantee timers while suspended; activation catches up instead.
 */

import { AppState, type NativeEventSubscription } from 'react-native';
import type { AppSettings, LogReporter, ServiceResult } from '@/contracts';

const CLEANUP_CHECK_INTERVAL_MS = 5 * 60_000;
const HOUR_MS = 60 * 60_000;

type CleanupOperation = (
  cutoff: number,
  shouldRun: () => boolean,
) => Promise<ServiceResult<{ deletedCount: number }>>;

export class LogCleanupScheduler {
  private settings: AppSettings;
  private subscription: NativeEventSubscription | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private currentAppState = AppState.currentState;
  private started = false;
  private running = false;
  private revision = 0;
  private failureReported = false;

  constructor(
    initialSettings: AppSettings,
    private readonly logger: LogReporter,
    private readonly cleanup: CleanupOperation,
  ) {
    this.settings = initialSettings;
  }

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    this.currentAppState = AppState.currentState;
    this.subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === this.currentAppState) {
        return;
      }
      this.currentAppState = nextState;
      this.reconfigure();
    });
    this.reconfigure();
  }

  updateSettings(nextSettings: AppSettings): void {
    const changed =
      nextSettings.autoLogCleanupEnabled !== this.settings.autoLogCleanupEnabled ||
      nextSettings.logRetentionHours !== this.settings.logRetentionHours;
    this.settings = nextSettings;
    if (changed) {
      this.reconfigure();
    }
  }

  stop(): void {
    this.started = false;
    this.revision += 1;
    this.clearTimer();
    this.subscription?.remove();
    this.subscription = null;
  }

  private canRun(): boolean {
    return this.started && this.settings.autoLogCleanupEnabled && this.currentAppState === 'active';
  }

  private reconfigure(): void {
    this.revision += 1;
    this.clearTimer();
    if (!this.canRun()) {
      return;
    }
    void this.check();
    this.timer = setInterval(() => void this.check(), CLEANUP_CHECK_INTERVAL_MS);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async check(): Promise<void> {
    if (!this.canRun() || this.running) {
      return;
    }
    this.running = true;
    const revision = this.revision;
    const cutoff = Date.now() - this.settings.logRetentionHours * HOUR_MS;
    try {
      const result = await this.cleanup(cutoff, () => this.canRun() && revision === this.revision);
      if (!result.ok) {
        this.reportFailure(result.error.message);
      } else if (this.canRun() && revision === this.revision) {
        this.failureReported = false;
        if (result.data.deletedCount > 0) {
          this.logger.info(
            'logger.autoCleanup',
            `Deleted ${result.data.deletedCount} expired local log entries`,
          );
        }
      }
    } catch (err) {
      this.reportFailure(err instanceof Error ? err.message : String(err));
    } finally {
      this.running = false;
      // Apply a policy or foreground change that arrived while a previous check was awaiting I/O.
      if (revision !== this.revision && this.canRun()) {
        void this.check();
      }
    }
  }

  private reportFailure(message: string): void {
    if (!this.failureReported) {
      this.failureReported = true;
      this.logger.warn('logger.autoCleanup', 'Automatic log cleanup failed; will retry later', message);
    }
  }
}
