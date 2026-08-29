# MyVault Web Drive Auth and Restore Remediation

Date: 2026-08-29 (Australia/Sydney)

Scope: persistent Google Drive authentication and restore integrity only

Starting commit: `48660342db8d55c2c1137b991cbeb45dc18ad90a`

## Previous root cause

MyVault Web stored a short-lived Google Identity Services access token but did not request a replacement during application startup. When the token reached its one-minute expiry margin, the app deleted it, treated the account namespace as local/unlinked, and displayed a disconnected state. Disconnect and account-switch UI also deleted the selected account's local browser vault even though Google identity and local vault storage are separate concerns.

The ordinary Restore action downloaded JSON directly. Unlike Drive write-back, it did not verify manifest sizes or SHA-256 hashes and did not run the complete schema/reference validator before replacing the local restore bundle.

## Authentication lifecycle

The production client now distinguishes these states:

- `initializing`
- `disconnected`
- `connecting`
- `connected`
- `renewing`
- `reauth-required`
- `error`

At startup, the app reads only the prior-authorization marker and remembered non-sensitive account namespace. A still-valid token is verified through Drive `about`. If authorization was previously granted but the token expired, MyVault requests a new token with the official Google Identity Services token client and an empty prompt. This can renew without an account chooser only when Google and browser policy permit it. If Google requires interaction, MyVault shows Reconnect rather than claiming to be connected.

Token requests are single-flight. Concurrent callers await one request, preventing popup storms and stale credential races. Safe Drive read operations retry transient 429/5xx responses twice with short exponential backoff. A 401/403 during a guarded Drive operation triggers one non-interactive renewal and one retry; it never loops.

## Client-only limitation

This remains a Google Identity Services browser token model. MyVault does not store Google passwords or unsupported refresh tokens. It has no backend authorization-code exchange and therefore cannot guarantee silent renewal across every browser restart, cookie policy, revoked grant, or Google security challenge. A backend session would be required for stronger refresh-token durability and is outside this approved phase.

## Verified identity and account isolation

- A token is not treated as a verified identity until Drive `about` returns a stable `permissionId`.
- The stable permission ID remains the account-scoped IndexedDB namespace.
- Expiry removes the unusable credential but does not erase the remembered account namespace or its local data.
- Intentional Disconnect removes the credential and prior-authorization marker, preventing automatic startup reconnection.
- Disconnect and account switching no longer delete local browser vault data.
- A successful account switch verifies the new identity before selecting its account namespace and clears in-memory scan/manifest/restore state before querying the new Drive.
- Cross-tab token and account events continue to invalidate stale state, and account assertions guard Drive operations.

No persisted unscoped Drive folder, manifest, latest-backup, or upload IDs were found. Drive discovery state is held in the connection hook and is reset on account activation/switch. Account-specific IndexedDB records remain prefixed by permission ID.

## Restore validation and staging

Restore now performs these steps before applying local data:

1. Discover the Drive map and manifest afresh for the currently verified account.
2. Validate manifest schema, storage type, cloud version/timestamp, entry size, checksum syntax, unique paths, unique Drive IDs, and required metadata.
3. List the current metadata/files folders and confirm every manifest-referenced object still exists and has the expected Drive-reported size.
4. Download all metadata into memory.
5. Verify each downloaded object's exact byte size and SHA-256 when supplied.
6. Parse every metadata object as JSON.
7. Validate the internal `myvault-backup` version-1 envelope, Android row shapes, stable IDs, hierarchy relationships, attachment references, PDF relationships, course relationships, tags, and backlinks.
8. Reassert the exact token and permission-ID account after staging.
9. Block the restore if unsynchronised local changes exist and create a recovery snapshot.
10. Reassert identity immediately before apply.
11. Commit the metadata bundle and matching sync base in one IndexedDB transaction.

An invalid download aborts before local replacement. IndexedDB transaction failure aborts both records, leaves the previous local vault intact, reports failure, and does not mark Restore complete. The backup format, Drive folder layout, Android serialization, and IndexedDB database version were not changed.

## Verification

Passed:

- TypeScript typecheck
- production Vite build
- Islamic Corpus workspace projection suite
- safe-sync contract suite
- browser sync contract: account isolation, locking, offline journal, manifest-last commit, failed-upload recovery
- new Drive auth/restore contract:
  - startup state policy
  - intentional disconnect suppresses renewal
  - five concurrent renewals produce one token request
  - valid size/hash/schema/reference fixture stages successfully
  - checksum corruption aborts before apply
  - missing attachment object reference aborts before apply
  - account switch/disconnect source guard prevents local-vault deletion

Production build retained the existing source-map lookup and large-chunk warnings. No new build warning was introduced.

## Manual Google acceptance

TEST ACCOUNT AUTHENTICATION REQUIRES MANUAL GOOGLE VERIFICATION

No password, 2FA, CAPTCHA, or saved credential was requested or bypassed. Therefore these real-account cases remain unproven in this run:

- reload/tab/browser restart with the disposable Google account;
- actual expiry and GIS silent renewal under the account's current Google/browser policy;
- live Account A/B Drive discovery;
- real Android-created backup discovery and destructive restore through the production UI.

After manual verification, run the matrix in `WEB_PRODUCTION_AUDIT.md` using only the authorized disposable account and record the visible email, stable permission ID, backup cloud version, timestamp, entry count, and restore results.

## Deliberately unchanged

- No backend auth server was introduced.
- No refresh token or password is stored in the browser.
- No Drive folder or backup-format change was made.
- No Android source was modified.
- PDF virtualization/remediation was not started.
