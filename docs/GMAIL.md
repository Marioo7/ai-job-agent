# Gmail OAuth setup

The app never sees or stores your Google password. It uses OAuth 2.0 with the minimum scopes for this feature:
* `https://www.googleapis.com/auth/gmail.send` — send mail only (no reading your inbox)
* `https://www.googleapis.com/auth/userinfo.email` — show which account is connected

1. https://console.cloud.google.com → create/select a project → **APIs & Services → Library → Gmail API → Enable**.
2. **OAuth consent screen**: User type *External* (or *Internal* for Workspace). Add scopes above. While the app is in **Testing**, add your Gmail address under *Test users*. Testing-mode refresh tokens expire after 7 days; to avoid weekly reconnects you must publish the app, and because `gmail.send` is a *sensitive* scope, public publishing may require Google verification. For a strictly personal tool many people stay in Testing and reconnect when needed — decide what suits you.
3. **Credentials → Create credentials → OAuth client ID → Web application**. Authorised redirect URI: `http://localhost:8080/api/integrations/gmail/callback` (and your production backend URL equivalent).
4. `.env`: `GMAIL_MODE=google`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI` (must match exactly), `SECRETS_ENCRYPTION_KEY`.
5. App → **Integrations & health → Connect Gmail**, approve. Press **Test connection** (refreshes the token and reads your address; sends no email).
6. **Disconnect** revokes the token and deletes the encrypted copy. You can also remove access at https://myaccount.google.com/permissions.

Notes: drafts live in this app (not in Gmail Drafts). The message is sent from your Gmail account with the active CV PDF attached. Gmail limits (about 500 recipients/day for personal accounts) apply. "Connected" is shown only after a real OAuth exchange stored a refresh token.
