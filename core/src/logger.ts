const REDACT = /token|secret|password|session|api[_-]?key|authorization|cookie|refresh|text|body|cv|hash|code/i;
type Level = 'debug' | 'info' | 'warn' | 'error';

function redact(fields: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) out[k] = REDACT.test(k) ? '[redacted]' : v instanceof Error ? v.message : v;
  return out;
}

/** Structured JSON logs. Field names that look sensitive (tokens, text, bodies, CV…) are redacted. */
export function log(level: Level, msg: string, fields?: Record<string, unknown>): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...redact(fields) });
  (level === 'error' ? console.error : console.log)(line);
}
