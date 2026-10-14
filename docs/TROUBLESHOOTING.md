# Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Frontend: "Cannot reach the server" | Backend not running, wrong `VITE_API_BASE_URL`, or `FRONTEND_ORIGIN` (CORS) doesn't match your frontend URL. |
| 401 "Invalid or expired session" | Not signed in, or backend `FIREBASE_PROJECT_ID` doesn't match the frontend's project. |
| 403 "not allowed" | Your email is not in `ALLOWED_EMAILS` (or empty — empty denies everyone). Email must be verified (Google sign-in is). |
| Backend: "Unsafe production configuration" | In production the app requires `AUTH_MODE=firebase`, `DB_MODE=firestore`, an encryption key and `ALLOWED_EMAILS`. |
| "The query requires an index" | Run `firebase deploy --only firestore:indexes` and wait until the indexes show *Enabled*. |
| "SECRETS_ENCRYPTION_KEY must be 32 random bytes" | `npm run gen:key` and paste the output. Changing the key makes stored sessions/tokens unreadable: log in again. |
| Worker banner "offline" | Worker not running, can't reach Firestore, or `OWNER_UID` differs from the UID shown on the Integrations page. |
| Worker: "No Telegram session stored" | Run `npm run telegram:login -w worker` with the same `OWNER_UID` and encryption key as the worker. |
| "Telegram session is no longer authorized" | Session revoked/expired. Log in again. |
| Source error "not found or not accessible" | Your account can't read it. Use `npm run telegram:dialogs -w worker` for exact IDs/titles. |
| FLOOD_WAIT in logs | Telegram rate limit; the client waits and retries. Reduce the number of sources. |
| CV upload "Almost no text" | Scanned PDF. Export a text-based PDF. |
| Gmail "redirect_uri_mismatch" | `GOOGLE_OAUTH_REDIRECT_URI` must equal one of the OAuth client's authorised redirect URIs exactly. |
| Gmail "no refresh token" | Remove the app at myaccount.google.com/permissions and connect again. |
| Gmail works for 7 days then fails | OAuth app is in *Testing* mode (token expiry). Reconnect or publish the app (see GMAIL.md). |
| Draft status stuck on `sending` | The process died after calling Gmail. Check Gmail *Sent*; then set `emailDrafts/<id>.status` to `sent` (if it went out) or `failed` (to retry). |
| "AI unavailable (quota)" | Provider quota/rate limit or daily cap. The app continues with rule-based results. |
