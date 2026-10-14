# Testing

```bash
npm install
npm test            # 72 automated tests (vitest)
npm run typecheck   # tsc for shared, core, backend, worker, frontend
npm run lint        # typecheck + scripts/check-secrets.mjs
npm run build       # production builds of frontend, backend, worker
```

Covered (new): 5-minute polling interval, paging through a 250-message backlog, scheduled re-read after downtime, **auto-apply rules** (send iff a clear valid email; saved-only when there is none; score/specialty/level/experience never skip a job; never twice: cross-posts, concurrent delivery, same recipient+subject, manual too), email validation, blacklist, daily limit, pause-on-failure, and worker+API end-to-end runs of those rules.

Covered: job parsing (EN/AR), duplicate detection (same message, cross-posts, per-user isolation), match scoring + filters + weights, CV validation (magic bytes, size, real PDF text extraction, text-less rejection), draft generation (only CV facts, placeholder guard), **approval enforcement** (no send without `SEND` confirmation, stale/forged content hash, wrong owner, missing recipient, placeholder), **duplicate-send prevention** (4 concurrent sends → exactly 1), failure + safe retry, API authentication (missing/invalid token, allow-list, demo token refused outside demo mode), per-user data isolation through the HTTP API, Telegram message processing + worker reconnect/catch-up/heartbeat/test-connection with a fake gateway, crash recovery of half-processed messages, AI failure fallback, AI hallucination rejection, crypto + OAuth state, MIME header-injection.

Not covered by automated tests (need real credentials/infrastructure): live Firestore (rules deployment, index build), live Telegram login, live Gmail OAuth/send, live AI providers, browser UI end-to-end. Firestore rules are deny-all for clients, so there is nothing to emulate beyond deploying them.
