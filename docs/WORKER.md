# Telegram worker & hosting

`worker/` is an independent persistent Node.js process. Every ~20 s (`WORKER_TICK_SEC`) it: reconnects if needed (exponential backoff up to 5 min), resolves new sources, catches up on missed messages from each source's last processed ID, retries half-processed messages, answers "Test connection", and writes a heartbeat to `workerStatus/<uid>`. The backend marks it **offline** when the heartbeat is older than 90 s and the UI shows a red banner. SIGINT/SIGTERM trigger a graceful stop (status `stopped`).

## Run
```bash
# development
npm run dev:worker
# production
npm run build -w worker && NODE_ENV=production node worker/dist/index.js
```
Production refuses to start unless `DB_MODE=firestore`, `SECRETS_ENCRYPTION_KEY` and `OWNER_UID` are set. Logs are JSON lines on stdout (message text/tokens are redacted).

Keep it alive (example, systemd):
```
[Service]
WorkingDirectory=/opt/ai-job-agent
EnvironmentFile=/opt/ai-job-agent/.env
ExecStart=/usr/bin/node worker/dist/index.js
Restart=always
RestartSec=5
```
(`pm2 start worker/dist/index.js --name job-worker` also works.) After a crash the next start catches up from the saved last message IDs and reprocesses stored-but-unfinished messages; duplicates are impossible because documents are keyed by `uid + source + message id`.

## Where to host (honest limitations)
| Option | Reality |
|---|---|
| Your own PC/laptop/Raspberry Pi | Free, works, but only while on and online. Fine for development and personal use. |
| Small VPS (paid, a few USD/month) | Most reliable simple choice; can host backend + worker together. |
| Free tiers of PaaS providers | Often sleep when idle, cap hours, or exclude background workers; plans change often. Verify current terms; do not assume 24/7. |
| Google Cloud Run | Needs billing (Blaze/Cloud billing) and `min-instances=1` with CPU always allocated for a persistent client; not free. |
| Firebase Spark / Cloud Functions / Vercel serverless | **Not suitable** for the worker (no persistent process). Fine for the static frontend only. |

No 24/7 uptime is guaranteed by this project. If the worker is offline, nothing is lost for channels where Telegram keeps history: the catch-up fetches the newest missed messages on reconnect (limited to 100 per source per cycle).

## Backend hosting
`npm run build -w backend && node backend/dist/index.js` on any Node 20+ host (same VPS is fine). Put it behind HTTPS, set `FRONTEND_ORIGIN`, `ALLOWED_EMAILS`, `TRUST_PROXY=1` behind a reverse proxy. With `STORAGE_MODE=local` the host needs a persistent disk (back it up); otherwise use `STORAGE_MODE=firebase`.
