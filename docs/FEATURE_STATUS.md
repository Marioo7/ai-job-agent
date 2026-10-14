# Feature status (honest)

## Tested automatically in this build (72 tests pass, typecheck/build pass)
Automatic-applying rules (opt-in, thresholds, daily limit, cooldown, pause-on-failure) · Job parsing & detection · duplicate prevention · match scoring/filters/weights · CV PDF validation + text extraction · draft generation · **approval gate** · **duplicate-send prevention** · failure/retry · API auth + allow-list + user isolation · worker reconnect/catch-up/heartbeat · crash recovery · AI-failure fallback · AI hallucination rejection · crypto/OAuth state · MIME safety · production builds of frontend/backend/worker · backend smoke test in demo mode (health, 401 without token, demo seed, dashboard).

## Implemented but NOT verified against real services (need your credentials)
| Feature | What you must supply / do | Verified by you when |
|---|---|---|
| Telegram monitoring (GramJS) | `api_id`/`api_hash`, interactive login, real channels | a real post from a real channel shows up under Jobs |
| Firebase Auth + Firestore | Firebase project, service account, rules/indexes deployed | you can sign in and data persists after restart |
| Firebase Storage driver | Bucket (plan may require Blaze) — or use local storage | CV upload then download works |
| Gmail OAuth + real send | Google Cloud OAuth client; consent screen | "Test connection" OK, then one send to yourself |
| Gemini / OpenAI-compatible providers | API key | analysis/draft marked as AI appear |
| Firebase Hosting / Vercel deploy | your accounts | the deployed site can sign in |

## Not built / out of scope
Browser UI automated tests · Docker image · Firestore rules emulator tests (rules deny all client access) · Telegram invite-link joining (intentionally unsupported) · OCR for scanned CVs.
