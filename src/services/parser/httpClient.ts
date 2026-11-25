/**
 * HTTP transport helper for the Usage Parser Service.
 * Executes read-only GET requests against cnb.cool with explicit Cookie isolation
 * (credentials: 'omit'), timeout control, and exponential-backoff retries.
 */

export const CNB_BASE_URL = 'https://cnb.cool';

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 800;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

export type ParserFailureKind = 'AUTH' | 'NOT_FOUND' | 'NETWORK' | 'PARSE' | 'UPSTREAM';

export class CnbParserError extends Error {
  readonly kind: ParserFailureKind;
  readonly httpStatus?: number;

  constructor(kind: ParserFailureKind, message: string, httpStatus?: number) {
    super(message);
    this.name = 'CnbParserError';
    this.kind = kind;
    this.httpStatus = httpStatus;
  }
}

export interface HttpGetOptions {
  accept?: string;
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
}

export interface HttpGetResult {
  status: number;
  body: string;
  headers: Headers;
}

export function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Normalizes a user-provided cookie string without logging or persisting it.
 * Strips an optional leading "Cookie:" header prefix and removes line breaks.
 */
export function sanitizeCookieHeader(rawCookie: string): string {
  let cleaned = rawCookie.replace(/[\r\n]+/g, ' ').trim();
  if (cleaned.toLowerCase().startsWith('cookie:')) {
    cleaned = cleaned.slice('cookie:'.length).trim();
  }
  return cleaned;
}

/**
 * Performs a read-only GET request with retry backoff on 429/5xx and network errors.
 * Uses credentials: 'omit' so iOS NSHTTPCookieStorage never mixes cookies across accounts.
 */
export async function cnbHttpGet(
  url: string,
  cookie: string,
  options: HttpGetOptions = {},
): Promise<HttpGetResult> {
  const accept = options.accept ?? 'application/json';
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options.retries ?? DEFAULT_MAX_RETRIES;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

  let lastError: unknown = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'GET',
        credentials: 'omit',
        headers: {
          Cookie: cookie,
          Accept: accept,
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'User-Agent': DEFAULT_USER_AGENT,
          Referer: `${CNB_BASE_URL}/`,
        },
        signal: controller.signal,
      });

      const body = await response.text();
      if (RETRYABLE_STATUSES.has(response.status) && attempt < maxRetries) {
        await delayMs(retryDelayMs * 2 ** attempt);
        continue;
      }

      return {
        status: response.status,
        body,
        headers: response.headers,
      };
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        await delayMs(retryDelayMs * 2 ** attempt);
        continue;
      }
      const detail =
        err instanceof Error && err.name === 'AbortError'
          ? '请求超时'
          : err instanceof Error
            ? err.message
            : String(err);
      throw new CnbParserError('NETWORK', `网络请求失败：${detail}`);
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  const fallbackDetail = lastError instanceof Error ? lastError.message : 'Unknown network failure';
  throw new CnbParserError('NETWORK', `网络请求重试后仍失败：${fallbackDetail}`);
}
