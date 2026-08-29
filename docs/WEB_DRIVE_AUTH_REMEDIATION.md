# MyVault Web Drive Authentication Remediation

Date: 2026-08-29 (Australia/Sydney)

Scope: persistent Google Drive authentication after Chrome is fully closed and reopened. Existing verified restore, account isolation, Drive layout, and backup format remain unchanged.

Starting commit: `56c4754cf4ef74779685b09cabb2037d0652f887`

## Root cause

The previous Web client used Google Identity Services `initTokenClient` and stored its short-lived access token in `localStorage`. That model can survive a reload only while the access token is still valid. It has no refresh token and therefore cannot guarantee session restoration after Chrome is closed, the access token expires, and the site is opened again.

## Implemented lifecycle

MyVault now uses the Google authorization-code model:

1. The browser opens the official Google Identity Services popup and receives a one-time authorization code.
2. `/api/google-drive-auth` exchanges that code on the server.
3. The server verifies the Google Drive `permissionId` using Drive `about`.
4. The refresh token and verified account ID are sealed with AES-256-GCM in an `HttpOnly`, `SameSite=Lax` cookie.
5. Browser JavaScript receives only the short-lived access token, expiry, scope, and verified account ID response. It never receives or stores the refresh token.
6. On startup or access-token expiry, the browser calls the same-origin endpoint. The server refreshes access, re-verifies the account ID, rotates the sealed cookie, and returns a new short-lived access token.
7. If Google revokes the grant, the cookie is invalid, or the account identity changes, renewal fails closed, clears the cookie, and shows Reconnect.

Access tokens now live only in module memory. Startup removes the legacy `myvault-google-drive-session` and `myvault-google-drive-token` browser values. `localStorage` retains only the non-secret `myvault-google-drive-authorized` marker and a cross-tab session-change nonce.

Concurrent renewals remain single-flight. Existing token/account assertions and permission-ID-scoped IndexedDB storage remain authoritative.

## Server configuration

The Web deployment requires these server-side environment values:

- `GOOGLE_OAUTH_CLIENT_ID`: the same Web OAuth client represented by public `VITE_GOOGLE_CLIENT_ID`.
- `GOOGLE_OAUTH_CLIENT_SECRET`: the secret for that Google Web OAuth client.
- `MYVAULT_GOOGLE_SESSION_SECRET`: a private random value of at least 32 characters used only to seal the HTTP-only session cookie.

None of these private values belong in Git or in a `VITE_` variable. The Google OAuth client must allow the deployed MyVault Web origin. The code exchange uses the Google Identity Services popup redirect value `postmessage`.

## Security properties

- Refresh credentials are inaccessible to browser JavaScript.
- Session cookies are encrypted and authenticated, HTTP-only, same-site, path-limited to this origin, and `Secure` in HTTPS deployments.
- Session responses are `no-store`.
- Requests enforce same-origin checks when an Origin header is present.
- Renewal re-verifies the stable Drive permission ID and rejects account changes.
- Invalid grants and identity mismatches clear the durable cookie.
- Disconnect clears the durable cookie and browser marker without deleting account-scoped local vault data.

## Automated verification

Passed:

- TypeScript checks for both the Web client and server function.
- authorization-code exchange uses `postmessage` and produces a sealed HTTP-only cookie;
- browser response does not contain the refresh token;
- a later request using only the cookie receives a renewed access token for the same account;
- account mismatch fails with `401` and expires the cookie;
- `invalid_grant` fails with `401` and expires the cookie;
- renewal remains single-flight;
- corrupt and internally invalid restore candidates still abort before apply.

## Real Chrome acceptance

Completed on 2026-08-30 against `https://myvault-web.vercel.app`:

- Recovered the existing valid Google Web OAuth client in project `myvault-fbfd1`; its client ID matches the public `VITE_GOOGLE_CLIENT_ID` and its authorized JavaScript origins already include the production origin.
- Created a new server credential on that existing client rather than creating a duplicate OAuth client.
- Installed the matched client ID, client secret, and private session-sealing secret in the Vercel Production and Preview environments. No private value was printed, committed, or stored in a public `VITE_` variable.
- Deployed production commit `c3a91e676d7c261801f4a5ab96b3d9930ad892c5` and verified the unauthenticated endpoint fails closed with `401` and `interactionRequired: true`.
- Connected and visibly verified `aahforex@gmail.com` in normal Google Chrome.
- Reloaded Settings and observed connected Drive state without another Google chooser.
- Fully quit and relaunched Chrome twice; both launches restored connected Drive state without another Google chooser.

The durable real-account authentication gate is passed. A destructive Drive restore was deliberately not run because the connected account may contain real MyVault data and no disposable restore fixture was proven. Destructive backup/restore remains a separate controlled acceptance test.

## Deliberately unchanged

- No Google password, 2FA value, or refresh token is stored in browser-readable storage.
- No Drive folder/layout change.
- No backup schema or Android serialization change.
- No local vault deletion on disconnect or account switch.
- No Android source change.
