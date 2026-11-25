/**
 * Auto-refresh scheduler inside the Update Exchange Service.
 * Handles background refresh on app launch/activation and interval-based periodic syncs
 * cleanly within Expo Go lifecycle boundaries.
 */

import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';
import type { AppSettings, LogReporter } from '@/contracts';

const FOREGROUND_DEBOUNCE_MS = 15_000;

function normalizeAppState(raw: string | null | undefined): AppStateStatus {
  if (
    raw === 'active' ||
    raw === 'background' ||
    raw === 'inactive' ||
    raw === 'extension' ||
    raw === 'unknown'
  ) {
    return raw;
  }
  return 'active';
}

export class RefreshScheduler {
  private readonly logger: LogReporter;
  private readonly onTriggerRefresh: (
    reason: 'launch' | 'foreground' | 'interval',
  ) => Promise<void>;

  private settings: AppSettings;
  private appStateSubscription: NativeEventSubscription | null = null;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private currentAppState: AppStateStatus = normalizeAppState(AppState.currentState);
  private lastForegroundTriggerAt = 0;
  private hasTriggeredLaunch = false;
  private started = false;

  constructor(
    initialSettings: AppSettings,
    logger: LogReporter,
    onTriggerRefresh: (reason: 'launch' | 'foreground' | 'interval') => Promise<void>,
  ) {
    this.settings = initialSettings;
    this.logger = logger;
    this.onTriggerRefresh = onTriggerRefresh;
  }

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    this.currentAppState = normalizeAppState(AppState.currentState);

    this.appStateSubscription = AppState.addEventListener('change', (nextState) => {
      const wasInactiveOrBg =
        this.currentAppState === 'background' || this.currentAppState === 'inactive';
      this.currentAppState = nextState;

      if (nextState === 'active') {
        this.armIntervalTimer();
        if (wasInactiveOrBg && this.settings.autoRefreshOnLaunch) {
          const now = Date.now();
          if (now - this.lastForegroundTriggerAt >= FOREGROUND_DEBOUNCE_MS) {
            this.lastForegroundTriggerAt = now;
            this.logger.info('scheduler.appState', 'Triggering silent background refresh on foreground');
            void this.onTriggerRefresh('foreground');
          }
        }
      } else {
        this.clearIntervalTimer();
      }
    });

    this.armIntervalTimer();

    if (!this.hasTriggeredLaunch && this.settings.autoRefreshOnLaunch) {
      this.hasTriggeredLaunch = true;
      this.lastForegroundTriggerAt = Date.now();
      this.logger.info('scheduler.launch', 'Triggering silent background refresh on launch');
      void this.onTriggerRefresh('launch');
    }
  }

  updateSettings(nextSettings: AppSettings): void {
    this.settings = nextSettings;
    if (this.started) {
      this.armIntervalTimer();
    }
  }

  stop(): void {
    this.clearIntervalTimer();
    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
      this.appStateSubscription = null;
    }
    this.started = false;
  }

  private armIntervalTimer(): void {
    this.clearIntervalTimer();
    if (!this.settings.autoRefreshEnabled || this.currentAppState !== 'active') {
      return;
    }

    const intervalMs = Math.max(1, this.settings.autoRefreshIntervalMinutes) * 60_000;
    this.logger.verbose(
      'scheduler.interval',
      `Armed auto-refresh timer every ${this.settings.autoRefreshIntervalMinutes} minute(s)`,
    );

    this.intervalHandle = setInterval(() => {
      this.logger.info('scheduler.interval', 'Executing scheduled auto-refresh');
      void this.onTriggerRefresh('interval');
    }, intervalMs);
  }

  private clearIntervalTimer(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }
}
