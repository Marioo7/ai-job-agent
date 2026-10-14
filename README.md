# AI Job Application Agent

Personal web app (one user: you) that watches Telegram channels/groups **your own account can already read**, detects job posts, scores them against your PDF CV with a transparent breakdown, drafts a tailored application email, and **sends nothing until you explicitly confirm**.

```
frontend/  React + Vite + TS + Tailwind (AR/EN, RTL)      -> Firebase Hosting (or Vercel)
backend/   Express API (Firebase ID-token auth, Gmail, CV) -> any Node host
worker/    Persistent GramJS Telegram monitor             -> any host with a long-running process
core/      Shared server logic (pipeline, approval gate, Gmail, AI, DB adapters)
shared/    Types, Zod schemas, parser, scoring (pure, also used by the frontend)
```

> The worker is a **separate long-running process**. It cannot run in a browser tab, in Vercel/Firebase serverless functions, or on Firebase Spark by itself. See `docs/WORKER.md`.

## 1. Try it locally in demo mode (no accounts, ~2 minutes)

Requires Node 20+.

```bash
npm install
cp .env.example .env
npm run gen:key                       # paste the output into SECRETS_ENCRYPTION_KEY in .env
cp frontend/.env.example frontend/.env   # VITE_DEMO_MODE=true by default
npm run dev:backend                   # terminal 1  -> http://localhost:8080
npm run dev:frontend                  # terminal 2  -> http://localhost:5173
```

In the app: **CV → Upload a PDF CV**, then **Dashboard → Load demo data**, open a job, **Create email draft**, then **Email approvals → Review and send**.
Demo mode uses an in-memory database (wiped on restart), a mock AI provider and a **simulated** mail sender: nothing is sent anywhere and all demo items are labelled `DEMO`.

Optional: `npm run dev:worker` runs the worker in `TELEGRAM_MODE=mock` — but with `DB_MODE=memory` it has its own memory, so use Firestore (below) if you want the worker and API to share data.

## 2. Real setup (checklist)

| Step | Guide |
|---|---|
| Firebase project, Auth, Firestore, rules, Hosting | `docs/FIREBASE.md` |
| Telegram API credentials + login + sources | `docs/TELEGRAM.md` |
| Gmail OAuth | `docs/GMAIL.md` |
| AI provider (optional) | `docs/AI.md` |
| Running/hosting the worker & backend | `docs/WORKER.md` |
| **100% free hosting, no credit card (Render + Firebase Spark)** | `docs/FREE_HOSTING.md` |
| Deploy to a server (VPS), manual vs automatic mode | `docs/DEPLOY.md` |
| Tests, type checks, builds | `docs/TESTING.md` |
| Problems | `docs/TROUBLESHOOTING.md` |
| What is tested vs. needs your credentials | `docs/FEATURE_STATUS.md` |

## 3. Commands

```bash
npm run typecheck   # all packages
npm run lint        # typecheck + secret-leak guard (scripts/check-secrets.mjs)
npm test            # vitest (shared, core, backend, worker)
npm run build       # frontend/dist, backend/dist, worker/dist
```

## 4. Safety model (short)

* **Sending modes**: *Manual* (default) or *Automatic* (opt-in; needs `ALLOW_AUTO_APPLY=true` on the server **and** switching it on in Preferences; see `docs/DEPLOY.md` for the guard rails).
* **Approval gate** (`core/src/approval.ts`, `core/src/send.ts`): creating/editing/regenerating a draft never sends. A send requires the authenticated owner, the literal confirmation `SEND`, and the SHA-256 of exactly what you reviewed (recipient + subject + body + CV file). Any edit changes the hash. The backend re-validates all of it, atomically claims the draft (compare-and-set) so double clicks / concurrent requests send once, and records result, recipient, CV version and time.
* Recipient email is never invented: it must appear in the post or be typed by you. Several emails in a post → none is auto-selected.
* AI output is untrusted: facts (email, link, company, salary, deadline, location) are accepted only if they literally appear in the post.
* Secrets (Telegram session, Gmail refresh token) are AES-256-GCM encrypted server-side; Firestore rules deny **all** browser access; no secret is in a `VITE_` variable.
* Telegram: read-only, your own account, only sources you add. The worker never sends, joins or edits anything.
* Collected content is only sent to an external AI provider if you configure one and keep "Use AI" on. It is never used by this app to train models; check your provider's data terms.

## 5. Known limitations

* Free-text search/score filters in the Jobs list are applied to the most recent ≤600 jobs (Firestore has no full-text search).
* `sending` state after a crash between "Gmail accepted" and "result recorded" is deliberately **not** auto-retried (to avoid a silent duplicate). Check Gmail Sent, then edit/regenerate is blocked until you resolve it manually in Firestore (`emailDrafts/<id>.status`).
* Heuristic job parsing/CV extraction is best-effort: always review extracted fields. Scanned (image-only) PDFs are rejected.
* The npm package `telegram` (GramJS) is marked archived upstream; it still works and is what this project uses. A maintained fork (`teleproto`) exists if you need to migrate.
