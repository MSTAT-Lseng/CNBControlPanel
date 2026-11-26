/**
 * React hooks connecting the User Interface Service solely to the Update Exchange Service.
 */

import { useEffect, useSyncExternalStore } from 'react';
import type {
  ExchangeUiState,
  ServiceResult,
  WorkspaceBuildLogDetail,
  WorkspaceBuildLogQueryInput,
  WorkspaceListSnapshot,
  WorkspaceStageLog,
  WorkspaceStageLogQueryInput,
  WorkspaceSyncInput,
} from '@/contracts';
import { exchangeService } from '@/services/exchange';

function unsupportedWorkspaceBridge<T>(): ServiceResult<T> {
  return {
    ok: false,
    error: {
      code: 'EXCHANGE_ERROR',
      message: '更新交换服务尚未接入云原生开发容器接口',
    },
    timestamp: Date.now(),
  };
}

/**
 * Subscribes a screen or component to reactive Exchange state updates.
 */
export function useExchangeState(): ExchangeUiState {
  return useSyncExternalStore(
    exchangeService.subscribe,
    exchangeService.getStateSnapshot,
    exchangeService.getStateSnapshot,
  );
}

/**
 * Initializes the Update Exchange Service once at app root mount.
 */
export function useExchangeBootstrap(): boolean {
  const state = useExchangeState();

  useEffect(() => {
    void exchangeService.initialize();
    return () => {
      exchangeService.shutdown();
    };
  }, []);

  return state.initialized;
}

/**
 * Reads cached workspace list for a user via Exchange when wired.
 */
export async function fetchCachedWorkspacesViaExchange(
  username: string,
): Promise<ServiceResult<WorkspaceListSnapshot | null>> {
  if (!exchangeService.getCachedWorkspaces) {
    return { ok: true, data: null, timestamp: Date.now() };
  }
  return exchangeService.getCachedWorkspaces(username);
}

/**
 * Syncs paginated workspace history for a user via Exchange when wired.
 */
export async function syncWorkspacesViaExchange(
  input: WorkspaceSyncInput,
): Promise<ServiceResult<WorkspaceListSnapshot>> {
  if (!exchangeService.syncAccountWorkspaces) {
    return unsupportedWorkspaceBridge();
  }
  return exchangeService.syncAccountWorkspaces(input);
}

/**
 * Fetches container build summary and optional config keys via Exchange when wired.
 */
export async function fetchWorkspaceBuildLogViaExchange(
  input: WorkspaceBuildLogQueryInput,
): Promise<ServiceResult<WorkspaceBuildLogDetail>> {
  if (!exchangeService.getWorkspaceBuildLog) {
    return unsupportedWorkspaceBridge();
  }
  return exchangeService.getWorkspaceBuildLog(input);
}

/**
 * Fetches ANSI-stripped and secret-redacted stage log lines via Exchange when wired.
 */
export async function fetchWorkspaceStageLogViaExchange(
  input: WorkspaceStageLogQueryInput,
): Promise<ServiceResult<WorkspaceStageLog>> {
  if (!exchangeService.getWorkspaceStageLog) {
    return unsupportedWorkspaceBridge();
  }
  return exchangeService.getWorkspaceStageLog(input);
}
