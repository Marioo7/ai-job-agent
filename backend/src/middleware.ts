import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodType } from 'zod';
import { AppError, errMsg, log, type Config, type TokenVerifier, type VerifiedUser } from '@ajaa/core';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request { user?: VerifiedUser }
  }
}

export const wrap = (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler => (req, res, next) => { fn(req, res).catch(next); };

export function parse<T>(schema: ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) throw new AppError(400, 'invalid_request', r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
  return r.data;
}

/** Verifies the Firebase ID token on every protected request and enforces the single-user allow-list. */
export function authMiddleware(config: Config, verify: TokenVerifier): RequestHandler {
  return async (req, _res, next) => {
    try {
      const h = req.headers.authorization;
      const token = h?.startsWith('Bearer ') ? h.slice(7).trim() : '';
      if (!token) throw new AppError(401, 'unauthenticated', 'Sign in required.');

      let user: VerifiedUser;
      if (config.AUTH_MODE === 'demo' && config.NODE_ENV !== 'production') {
        const m = /^demo(?::([\w-]{1,40}))?$/.exec(token);
        if (!m) throw new AppError(401, 'unauthenticated', 'Invalid demo token.');
        user = { uid: m[1] ?? 'demo-user', email: 'demo@example.invalid' };
      } else {
        try { user = await verify(token); } catch { throw new AppError(401, 'unauthenticated', 'Invalid or expired session. Sign in again.'); }
        const allowed = config.ALLOWED_EMAILS;
        if (!user.email || !allowed.includes(user.email.toLowerCase())) {
          throw new AppError(403, 'forbidden', 'This account is not allowed to use this application (check ALLOWED_EMAILS).');
        }
      }
      req.user = user;
      next();
    } catch (e) { next(e); }
  };
}

export const uidOf = (req: Request): string => {
  if (!req.user) throw new AppError(401, 'unauthenticated', 'Sign in required.');
  return req.user.uid;
};

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) { res.status(err.status).json({ error: { code: err.code, message: err.message } }); return; }
  if (err instanceof ZodError) { res.status(400).json({ error: { code: 'invalid_request', message: err.message } }); return; }
  const code = (err as { code?: string })?.code;
  if (code === 'LIMIT_FILE_SIZE') { res.status(413).json({ error: { code: 'file_too_large', message: 'The file is too large (max 5 MB).' } }); return; }
  if (code === 'LIMIT_UNEXPECTED_FILE') { res.status(400).json({ error: { code: 'invalid_request', message: 'Upload a single file in the "file" field.' } }); return; }
  log('error', 'unhandled_error', { error: errMsg(err) });
  res.status(500).json({ error: { code: 'internal_error', message: 'Something went wrong. Check the server logs.' } });
}
