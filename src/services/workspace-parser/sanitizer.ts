/**
 * Output sanitization utilities for the Cloud Native Dev Parser Service.
 * Strips ANSI terminal escape codes and redacts credentials before returning
 * log lines or stage error messages across the service boundary.
 */

// Combined CSI, OSC, and 2-byte/charset-designation ESC terminal sequences.
const ANSI_ESCAPE_RE =
  /\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[ -\/]+[@-~]|\x1b[@-Z\\^_=<>-]/g;

// Known bearer and API token patterns (OpenAI-style, GitHub PAT/OAuth, Bearer).
const TOKEN_VALUE_RE = /\b(sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{12,})/g;
const BEARER_RE = /\b(Bearer\s+)([A-Za-z0-9._-]{12,})/gi;

// Key-value secret pairs supporting unquoted and quoted values (e.g. "api_key": "xxx" or PROXY_KEY=xxx).
const KV_SECRET_RE =
  /((?:["']?[A-Za-z0-9_]*(?:token|password|passwd|secret|api_key|proxy_key|access_key|private_key|cnbsession|csrfkey|csrftoken)["']?\s*[:=]\s*))(?:(["'])([^"'\r\n]+)\2|([^"'\s,;\r\n}]+))/gi;

const TEMPLATE_OR_PLACEHOLDER_RE = /^(?:\$[A-Za-z_{].*|\{\{.*\}\}|<.*>|null|undefined|true|false)$/i;

const PRESET_STAGE_NAMES: Record<string, string> = {
  prepare: 'Prepare',
  beforeEnd: 'BeforeEnd',
  debugDetection: 'DebugDetection',
  end: 'End',
};

function maskSecretToken(rawSecret: string): string {
  if (rawSecret.length <= 14) {
    return '***';
  }
  return `${rawSecret.slice(0, 6)}…${rawSecret.slice(-4)}`;
}

/**
 * Removes ANSI color, cursor, OSC title, and carriage-return control sequences.
 */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE_RE, '').replace(/\r/g, '');
}

/**
 * Redacts literal credentials, session cookies, and key-value secrets in text.
 */
export function redactSecrets(text: string): string {
  if (!text) {
    return '';
  }

  let output = text.replace(
    KV_SECRET_RE,
    (
      fullMatch,
      prefix: string,
      quote: string | undefined,
      quotedValue: string | undefined,
      unquotedValue: string | undefined,
    ) => {
      const value = quotedValue ?? unquotedValue ?? '';
      if (!value || TEMPLATE_OR_PLACEHOLDER_RE.test(value)) {
        return fullMatch;
      }
      const quoteChar = quote ?? '';
      return `${prefix}${quoteChar}${maskSecretToken(value)}${quoteChar}`;
    },
  );

  output = output.replace(BEARER_RE, (_fullMatch, bearerPrefix: string, token: string) => {
    return `${bearerPrefix}${maskSecretToken(token)}`;
  });

  output = output.replace(TOKEN_VALUE_RE, (token: string) => {
    return maskSecretToken(token);
  });

  return output;
}

/**
 * Sanitizes a raw stage log line by stripping ANSI escapes and redacting secrets.
 */
export function sanitizeLogLine(rawLine: string): string {
  return redactSecrets(stripAnsi(rawLine));
}

/**
 * Resolves a human-readable stage title when preset stages only provide an ID.
 */
export function normalizeStageName(stageId: string, rawName?: string): string {
  const trimmedName = (rawName ?? '').trim();
  if (trimmedName) {
    return trimmedName;
  }
  const trimmedId = stageId.trim();
  return PRESET_STAGE_NAMES[trimmedId] ?? trimmedId;
}
