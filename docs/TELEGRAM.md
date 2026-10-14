# Telegram setup (GramJS / MTProto, your own account)

A Telegram *bot* cannot read arbitrary channels or groups, so this project logs in as **you** (user account via MTProto) and is strictly read-only. It only sees chats your account is already a member of / can read. It does not join, post, or bypass private-channel access.

1. Go to https://my.telegram.org → **API development tools** → create an app → note `api_id` and `api_hash`. Put them in `.env`: `TELEGRAM_API_ID`, `TELEGRAM_API_HASH` (server-side only).
2. Set `TELEGRAM_MODE=real`, `DB_MODE=firestore`, `OWNER_UID=<your user id>`, `SECRETS_ENCRYPTION_KEY=<npm run gen:key>`.
3. One-time login (interactive, in a terminal on the machine that will run the worker):
   ```bash
   npm run telegram:login -w worker
   ```
   Enter phone, the code Telegram sends, and your 2-step password if enabled (hidden input). The session string is encrypted with AES-256-GCM and stored in Firestore `integrations/<uid>_telegram`. It is never printed, logged, or sent to the browser.
4. See which channels/groups you can monitor (IDs, usernames):
   ```bash
   npm run telegram:dialogs -w worker
   ```
5. In the app, **Telegram sources → Add source** with `@username`, the numeric ID (e.g. `-1001234567890`) or the exact title. Invite links of channels you have not joined cannot be resolved.
6. Start the worker (`docs/WORKER.md`), then press **Test connection**. First sync of a source imports only its newest 20 posts; afterwards it catches up from the last processed message ID after any downtime (up to 100 newest missed messages per source per cycle).

**Revoke:** `npm run telegram:logout -w worker` (terminates the session on Telegram and deletes the stored copy). You can also remove it in Telegram → Settings → Devices.

**Rules to respect:** only use content you are authorised to access; check Telegram's API Terms and the channels' own rules, and the privacy implications of forwarding post text to an external AI service (leave `AI_PROVIDER=mock` or `none` to avoid it). Do not use collected content to train models. Do not hammer the API: the client honours FLOOD_WAIT automatically (waits up to 60 s) and reconnects with backoff.

**Do not claim it works until** you see a real post from a real channel appear under **Jobs** (see `docs/FEATURE_STATUS.md`).
