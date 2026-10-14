import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** AES-256-GCM. Format: v1:<iv>:<tag>:<ciphertext> (base64). */
export function encryptSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
}

export function decryptSecret(enc: string, key: Buffer): string {
  const [v, iv, tag, ct] = enc.split(':');
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('Unsupported secret format');
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
}

const b64u = (b: Buffer) => b.toString('base64url');

/** Signed, expiring OAuth `state` so the callback can be trusted without a session header. */
export function signState(payload: { uid: string }, key: Buffer, ttlMs = 10 * 60_000, now = Date.now()): string {
  const body = b64u(Buffer.from(JSON.stringify({ ...payload, exp: now + ttlMs, n: randomBytes(8).toString('hex') })));
  return `${body}.${b64u(createHmac('sha256', key).update(body).digest())}`;
}

export function verifyState(state: string, key: Buffer, now = Date.now()): { uid: string } | null {
  const [body, sig] = state.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', key).update(body).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { uid?: string; exp?: number };
    if (!p.uid || !p.exp || p.exp < now) return null;
    return { uid: p.uid };
  } catch {
    return null;
  }
}
