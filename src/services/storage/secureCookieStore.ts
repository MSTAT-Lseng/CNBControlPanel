/**
 * Secure Keychain wrapper for sensitive payloads inside the Information Storage Service.
 * Uses deterministic hex-encoded keys so arbitrary usernames remain Expo Go Keychain-safe.
 */

import * as SecureStore from 'expo-secure-store';

const KEYCHAIN_PREFIX = 'cnb.panel.sec';

function encodeHex(raw: string): string {
  const bytes = new TextEncoder().encode(raw);
  let out = '';
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, '0');
  }
  return out;
}

/**
 * Produces a Keychain-compliant key containing only [A-Za-z0-9._-].
 */
export function buildSecureStoreKey(table: string, key: string): string {
  return `${KEYCHAIN_PREFIX}.${encodeHex(table)}.${encodeHex(key)}`;
}

/**
 * Persists a serialized secret payload in iOS Keychain without biometric prompts
 * so it operates reliably inside Expo Go.
 */
export async function saveSecretPayload(
  table: string,
  key: string,
  serializedPayload: string,
): Promise<void> {
  const safeKey = buildSecureStoreKey(table, key);
  await SecureStore.setItemAsync(safeKey, serializedPayload, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
}

/**
 * Reads a serialized secret payload from iOS Keychain.
 */
export async function readSecretPayload(table: string, key: string): Promise<string | null> {
  const safeKey = buildSecureStoreKey(table, key);
  return SecureStore.getItemAsync(safeKey);
}

/**
 * Removes a secret payload from iOS Keychain.
 */
export async function deleteSecretPayload(table: string, key: string): Promise<void> {
  const safeKey = buildSecureStoreKey(table, key);
  await SecureStore.deleteItemAsync(safeKey);
}
