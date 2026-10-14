import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');
const list = z.string().transform((s) => s.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean));

export const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(8080),
  FRONTEND_ORIGIN: z.string().default('http://localhost:5173'),
  TRUST_PROXY: z.coerce.number().int().default(0),

  AUTH_MODE: z.enum(['firebase', 'demo']).default('firebase'),
  ALLOWED_EMAILS: list.default(''),
  DB_MODE: z.enum(['firestore', 'memory']).default('firestore'),
  STORAGE_MODE: z.enum(['local', 'firebase', 'firestore']).default('local'),
  STORAGE_DIR: z.string().default('.data/files'),

  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_SERVICE_ACCOUNT_PATH: z.string().optional(),
  FIREBASE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  FIREBASE_STORAGE_BUCKET: z.string().optional(),

  SECRETS_ENCRYPTION_KEY: z.string().optional(),

  AI_PROVIDER: z.enum(['none', 'mock', 'gemini', 'openai-compatible']).default('mock'),
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default(''),
  AI_BASE_URL: z.string().default('https://api.openai.com/v1'),
  AI_MAX_INPUT_CHARS: z.coerce.number().int().min(500).default(6000),
  AI_DAILY_CALL_CAP: z.coerce.number().int().min(0).default(200),

  GMAIL_MODE: z.enum(['google', 'mock']).default('mock'),
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  GOOGLE_OAUTH_REDIRECT_URI: z.string().default('http://localhost:8080/api/integrations/gmail/callback'),

  TELEGRAM_MODE: z.enum(['real', 'mock']).default('mock'),
  TELEGRAM_API_ID: z.coerce.number().int().optional(),
  TELEGRAM_API_HASH: z.string().optional(),
  OWNER_UID: z.string().optional(),
  MOCK_MESSAGE_INTERVAL_SEC: z.coerce.number().int().min(5).default(45),
  ALLOW_AUTO_APPLY: bool.default('false'),
  AUTO_APPLY_INTERVAL_SEC: z.coerce.number().int().min(30).default(60),
  TELEGRAM_POLL_INTERVAL_SEC: z.coerce.number().int().min(30).default(300),
  RUN_WORKER_IN_BACKEND: bool.default('false'),
  WORKER_OFFLINE_AFTER_SEC: z.coerce.number().int().min(30).default(90),
  WORKER_TICK_SEC: z.coerce.number().int().min(5).default(20),
});

export type Config = z.infer<typeof configSchema>;
export { bool };

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const clean = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ''));
  const parsed = configSchema.safeParse(clean);
  if (!parsed.success) {
    throw new Error('Invalid configuration: ' + parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  }
  return parsed.data;
}

export function encryptionKey(cfg: Config): Buffer {
  const b = cfg.SECRETS_ENCRYPTION_KEY ? Buffer.from(cfg.SECRETS_ENCRYPTION_KEY, 'base64') : null;
  if (!b || b.length !== 32) throw new Error('SECRETS_ENCRYPTION_KEY must be 32 random bytes, base64-encoded (run: npm run gen:key)');
  return b;
}

/** Refuse to start in production with unsafe settings. */
export function assertSafeForProduction(cfg: Config, role: 'backend' | 'worker'): void {
  if (cfg.NODE_ENV !== 'production') return;
  const problems: string[] = [];
  if (cfg.AUTH_MODE !== 'firebase') problems.push('AUTH_MODE must be "firebase"');
  if (cfg.DB_MODE !== 'firestore') problems.push('DB_MODE must be "firestore"');
  if (!cfg.SECRETS_ENCRYPTION_KEY) problems.push('SECRETS_ENCRYPTION_KEY is required');
  if (role === 'backend' && cfg.ALLOWED_EMAILS.length === 0) problems.push('ALLOWED_EMAILS must list your email (single-user app)');
  if (role === 'backend' && cfg.FRONTEND_ORIGIN.includes('*')) problems.push('FRONTEND_ORIGIN must not be a wildcard');
  if (cfg.RUN_WORKER_IN_BACKEND && !cfg.OWNER_UID) problems.push('RUN_WORKER_IN_BACKEND=true requires OWNER_UID');
  if (cfg.ALLOW_AUTO_APPLY && !cfg.OWNER_UID) problems.push('ALLOW_AUTO_APPLY=true requires OWNER_UID');
  if (role === 'worker' && !cfg.OWNER_UID) problems.push('OWNER_UID is required');
  if (problems.length) throw new Error('Unsafe production configuration: ' + problems.join('; '));
}
