/**
 * HTTP transport helper for the Cloud Native Dev Parser Service.
 * Executes read-only GET requests against cnb.cool with explicit Cookie isolation
 * (credentials: 'omit'), exact Accept: application/json content negotiation,
 * timeout control, and exponential-backoff retries.
 */

export const CNB_BASE_URL = 'https://cnb.cool';

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 800;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

export type WorkspaceParserFailureKind =
  | 'VALIDATION'
  | 'AUTH'
  | 'NOT_FOUND'
  | 'NETWORK'
  | 'PARSE'
  | 'UPSTREAM';

export class WorkspaceParserError extends Error {
  readonly kind: WorkspaceParserFailureKind;
  readonly httpStatus?: number;

  constructor(kind: WorkspaceParserFailureKind, message: string, httpStatus?: number) {
    super(message);
    this.name = 'WorkspaceParserError';
    this.kind = kind;
    this.httpStatus = httpStatus;
  }
}

export interface WorkspaceHttpGetOptions {
  referer?: string;
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
}

export function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Encodes each slash-separated path segment individually so repository slugs
 * retain path slashes while special characters are percent-encoded.
 */
export function encodePathSegments(pathValue: string): string {
  return pathValue
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

/**
 * Normalizes a user-provided cookie header without logging or persisting it.
 * Strips optional "Cookie:" prefix, collapses line breaks, and prepends
 * "CNBSESSION=" when given a bare session token.
 */
export function normalizeWorkspaceCookie(rawCookie: string): string {
  let cleaned = rawCookie.replace(/[\r\n]+/g, ' ').trim();
  if (cleaned.toLowerCase().startsWith('cookie:')) {
    cleaned = cleaned.slice('cookie:'.length).trim();
  }
  if (!cleaned) {
    return '';
  }
  if (!cleaned.includes('=')) {
    return `CNBSESSION=${cleaned}`;
  }
  return cleaned;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Executes a read-only GET request requiring an exact "application/json"
 * Accept header so CNB content negotiation never falls back to HTML pages.
 */
export async function cnbWorkspaceGetJson<T = unknown>(
  url: string,
  cookie: string,
  options: WorkspaceHttpGetOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options.retries ?? DEFAULT_MAX_RETRIES;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const referer = options.referer ?? `${CNB_BASE_URL}/`;

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
          // Must be exact application/json; wildcards like */* return 200 HTML.
          Accept: 'application/json',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'User-Agent': DEFAULT_USER_AGENT,
          Referer: referer,
          'X-Requested-With': 'XMLHttpRequest',
        },
        signal: controller.signal,
      });

      const body = await response.text();
      const status = response.status;

      if (RETRYABLE_STATUSES.has(status) && attempt < maxRetries) {
        await delayMs(retryDelayMs * 2 ** attempt);
        continue;
      }

      if (status >= 300 && status < 400) {
        throw new WorkspaceParserError(
          'AUTH',
          `Cookie 无效或已过期（HTTP ${status} 重定向）`,
          status,
        );
      }

      if (status === 401 || status === 403) {
        throw new WorkspaceParserError(
          'AUTH',
          `Cookie 无效、已过期或无访问权限（HTTP ${status}）`,
          status,
        );
      }

      if (response.url && response.url.includes('/login')) {
        throw new WorkspaceParserError('AUTH', 'Cookie 无效或已过期（被跳转至登录页）', status);
      }

      if (status === 404) {
        throw new WorkspaceParserError('NOT_FOUND', '请求的容器或构建日志不存在（HTTP 404）', 404);
      }

      const contentType = (response.headers.get('content-type') ?? '').toLowerCase();

      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        if (!contentType.includes('json')) {
          throw new WorkspaceParserError(
            'PARSE',
            `期望 JSON 响应但收到非 JSON 内容（HTTP ${status}, Content-Type: ${contentType || 'unknown'}）`,
            status,
          );
        }
        throw new WorkspaceParserError(
          'PARSE',
          `响应 JSON 解析失败（HTTP ${status}）`,
          status,
        );
      }

      if (isRecord(parsed)) {
        const errcode = parsed.errcode;
        if (errcode !== undefined && errcode !== null && errcode !== 0) {
          const errmsg = typeof parsed.errmsg === 'string' ? parsed.errmsg : '';
          if (errcode === 16) {
            throw new WorkspaceParserError('AUTH', 'Cookie 无效或已过期（errcode=16）', status);
          }
          if (errcode === 404) {
            throw new WorkspaceParserError(
              'NOT_FOUND',
              errmsg || '请求的资源不存在（errcode=404）',
              404,
            );
          }
          throw new WorkspaceParserError(
            'UPSTREAM',
            `CNB 接口返回错误（errcode=${String(errcode)}）${errmsg ? `：${errmsg}` : ''}`,
            status,
          );
        }
      }

      if (!contentType.includes('json') && status !== 200) {
        throw new WorkspaceParserError(
          'UPSTREAM',
          `CNB 接口请求失败（HTTP ${status}）`,
          status,
        );
      }

      if (status < 200 || status >= 300) {
        throw new WorkspaceParserError(
          'UPSTREAM',
          `CNB 接口请求失败（HTTP ${status}）`,
          status,
        );
      }

      return parsed as T;
    } catch (err) {
      if (err instanceof WorkspaceParserError) {
        throw err;
      }

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
      throw new WorkspaceParserError('NETWORK', `网络请求失败：${detail}`);
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  const fallbackDetail =
    lastError instanceof Error ? lastError.message : 'Unknown network failure';
  throw new WorkspaceParserError('NETWORK', `网络请求重试后仍失败：${fallbackDetail}`);
}
