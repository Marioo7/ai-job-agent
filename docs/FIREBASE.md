# Firebase setup & deployment

## What runs where (Spark vs. paid)
| Piece | Spark (free) | Notes |
|---|---|---|
| Hosting (frontend) | Yes | Quota-limited. |
| Authentication (email/password, Google) | Yes | |
| Firestore | Yes, within free quotas | The worker writes a heartbeat every ~20 s (~4,300 writes/day) plus job writes; verify current free quotas on Firebase pricing. |
| Cloud Storage for CVs | **May require Blaze** | Firebase has changed this policy; check your console. Alternative: `STORAGE_MODE=local` on a host with a persistent disk. |
| Backend API + Telegram worker | **No** | Need a Node host (VPS, home server, container platform). Cloud Functions/Run need Blaze and are a poor fit for the persistent worker. |

Nothing here upgrades billing for you. Costs you may incur: hosting for backend/worker, AI API usage (if enabled), Cloud Storage (if used).

## Steps
1. Create a project at https://console.firebase.google.com (no billing needed to start).
2. **Authentication → Sign-in method**: enable *Email/Password* and/or *Google*. Create your user (Authentication → Users → Add user) or sign in with Google once.
3. **Firestore Database → Create database** (production mode).
4. **Project settings → General → Your apps → Web app**: copy the config into `frontend/.env`:
   ```
   VITE_DEMO_MODE=false
   VITE_API_BASE_URL=https://YOUR-BACKEND-URL
   VITE_FIREBASE_API_KEY=...  VITE_FIREBASE_AUTH_DOMAIN=...  VITE_FIREBASE_PROJECT_ID=...  VITE_FIREBASE_APP_ID=...
   ```
   (These are public identifiers, not secrets.)
5. **Project settings → Service accounts → Generate new private key.** Store the JSON **outside the repo**. In `.env` (backend + worker): `FIREBASE_PROJECT_ID`, `FIREBASE_SERVICE_ACCOUNT_PATH`, `DB_MODE=firestore`, `AUTH_MODE=firebase`, `ALLOWED_EMAILS=you@gmail.com`.
6. Deploy rules + indexes:
   ```bash
   npm i -g firebase-tools && firebase login
   cp .firebaserc.example .firebaserc   # edit project id
   firebase deploy --only firestore:rules,firestore:indexes
   ```
   Rules deny all browser access (the backend uses the Admin SDK). Indexes take a few minutes; until built, some list queries fail with a "requires an index" error.
7. Find your user id: sign in, open **Integrations & health** → "Your user ID" → set `OWNER_UID` for the worker.
8. Build + deploy the frontend:
   ```bash
   npm run build -w frontend
   firebase deploy --only hosting
   ```
   Add your Hosting domain to **Authentication → Settings → Authorized domains** (done automatically for `*.web.app`), and set the backend `FRONTEND_ORIGIN` to it.

## Optional: Vercel for the frontend
Import the repo, Root Directory `frontend`, build `npm run build`, output `dist`, add the same `VITE_*` variables, add the Vercel domain to Firebase authorized domains and to backend `FRONTEND_ORIGIN`. Vercel only hosts the static frontend; it cannot host the worker.

## Data retention & deletion
* Collections: users, userPreferences, cvProfiles, telegramSources, telegramMessages (stores original post text), jobs, emailDrafts, applications, integrations (encrypted secrets), workerStatus, auditLogs, aiUsage.
* Delete a CV: remove the `cvProfiles` doc and the file `cv/<uid>/<id>.pdf`. Delete old posts: remove `telegramMessages`/`jobs` docs (a Firestore TTL policy on a timestamp field can automate this).
* Leaving: delete your docs per collection (filter `uid == <you>`), revoke Gmail (Integrations → Disconnect) and Telegram (`npm run telegram:logout -w worker`).
