/**
 * Serialization and validation helpers for account backup export/import.
 * These helpers never log or expose raw Cookie values.
 */

import type { AccountBackupEntry, AccountBackupFile } from '@/contracts';
import type { ValidationOutcome } from './validator';

const BACKUP_FORMAT = 'cnb-panel-accounts';
const BACKUP_SCHEMA_VERSION = 1;
const MAX_BACKUP_BYTES = 5 * 1024 * 1024;
const MAX_ACCOUNT_COUNT = 500;
const MAX_USERNAME_LENGTH = 64;
const MAX_REMARK_LENGTH = 120;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Returns the byte length of a UTF-8 string without relying on platform Buffer APIs.
 */
function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

/**
 * Builds the exported backup object from validated account entries.
 */
export function createBackupFile(
  entries: AccountBackupEntry[],
  appVersion: string,
  exportedAt: number,
): AccountBackupFile {
  return {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    appVersion,
    exportedAt,
    accounts: entries,
  };
}

/**
 * Parses and validates a raw backup JSON string, rejecting malformed or unsafe payloads.
 */
export function parseBackupFile(rawJson: string): ValidationOutcome<AccountBackupFile> {
  if (typeof rawJson !== 'string' || rawJson.trim() === '') {
    return { valid: false, message: '备份文件内容为空' };
  }
  if (utf8ByteLength(rawJson) > MAX_BACKUP_BYTES) {
    return { valid: false, message: '备份文件过大（上限 5 MB）' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return { valid: false, message: '备份文件不是有效的 JSON' };
  }

  if (!isPlainObject(parsed)) {
    return { valid: false, message: '备份文件格式无效' };
  }
  if (parsed.format !== BACKUP_FORMAT) {
    return { valid: false, message: '不是 CNB 面板账户备份文件' };
  }
  if (parsed.schemaVersion !== BACKUP_SCHEMA_VERSION) {
    return { valid: false, message: '不支持的备份文件版本' };
  }
  if (typeof parsed.appVersion !== 'string') {
    return { valid: false, message: '备份文件缺少应用版本信息' };
  }
  if (!Number.isFinite(parsed.exportedAt)) {
    return { valid: false, message: '备份文件导出时间无效' };
  }
  if (!Array.isArray(parsed.accounts)) {
    return { valid: false, message: '备份文件账户列表无效' };
  }
  if (parsed.accounts.length > MAX_ACCOUNT_COUNT) {
    return { valid: false, message: `备份文件账户数量超过上限（${MAX_ACCOUNT_COUNT}）` };
  }

  const seenUsernames = new Set<string>();
  const accounts: AccountBackupEntry[] = [];

  for (const rawEntry of parsed.accounts) {
    if (!isPlainObject(rawEntry)) {
      return { valid: false, message: '备份文件包含无效的账户条目' };
    }

    const username = typeof rawEntry.username === 'string' ? rawEntry.username.trim() : '';
    const cookie = typeof rawEntry.cookie === 'string' ? rawEntry.cookie.trim() : '';
    const remark = typeof rawEntry.remark === 'string' ? rawEntry.remark.trim() : '';
    const createdAt = rawEntry.createdAt;
    const updatedAt = rawEntry.updatedAt;
    const lastSyncedAt = rawEntry.lastSyncedAt;

    if (!username) {
      return { valid: false, message: '备份文件中存在空用户名' };
    }
    if (username.length > MAX_USERNAME_LENGTH) {
      return { valid: false, message: `用户名长度不能超过 ${MAX_USERNAME_LENGTH} 个字符` };
    }
    if (seenUsernames.has(username)) {
      return { valid: false, message: `备份文件中用户名重复：${username}` };
    }
    if (!cookie) {
      return { valid: false, message: `账户 "${username}" 的 Cookie 为空` };
    }
    if (remark.length > MAX_REMARK_LENGTH) {
      return { valid: false, message: `账户 "${username}" 的备注过长` };
    }
    if (!Number.isFinite(createdAt) || !Number.isFinite(updatedAt)) {
      return { valid: false, message: `账户 "${username}" 的时间戳无效` };
    }
    if (lastSyncedAt !== null && !Number.isFinite(lastSyncedAt)) {
      return { valid: false, message: `账户 "${username}" 的同步时间无效` };
    }

    seenUsernames.add(username);
    accounts.push({
      username,
      cookie,
      remark,
      createdAt: createdAt as number,
      updatedAt: updatedAt as number,
      lastSyncedAt: lastSyncedAt as number | null,
    });
  }

  return {
    valid: true,
    value: {
      format: BACKUP_FORMAT,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      appVersion: parsed.appVersion,
      exportedAt: parsed.exportedAt as number,
      accounts,
    },
  };
}
