/**
 * React hooks connecting the User Interface Service solely to the Update Exchange Service.
 */

import { useEffect, useSyncExternalStore } from 'react';
import type { ExchangeUiState } from '@/contracts';
import { exchangeService } from '@/services/exchange';

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
