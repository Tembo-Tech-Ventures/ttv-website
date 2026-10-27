# Better Auth 1.7 upgrade

Target: `better-auth ~1.7.14` (latest published 1.7.x on 2026-10-27), with
the lockfile resolving all Better Auth adapter/core packages to 1.7.14.

## Account data remains unchanged

The [official upgrade guide](https://better-auth.com/docs/guides/1-7-upgrade-guide)
supersedes the 1.7.0 release notes: **1.7.3 reverted the required `issuer`
column and restored `(providerId, accountId)` identity**. The installed 1.7.14
account schema and GitHub provider confirm that behavior. GitHub's immutable
numeric profile ID still becomes `account.accountId`, and `providerId` remains
`github`.

TTV upgrades directly from 1.6.33. Its migration history never added `issuer`.
No Drizzle schema change, D1 migration, or account backfill is required. Adding
a required `issuer` would reject new accounts because current versions do not
write that field. Existing account IDs, user IDs, tokens and relationships are
preserved; the previous Worker remains compatible with the database.

Before releasing, run this **read-only** check against the target D1 database:

```sql
SELECT providerId, accountId, COUNT(*) AS matches
FROM account GROUP BY providerId, accountId HAVING COUNT(*) > 1;
```

It must return no rows. If it returns duplicates, stop and resolve ownership
with the owner; never choose, merge or delete identities automatically. 1.7.14
fails closed on ambiguous account keys. If a database was separately migrated
to 1.7.0–1.7.2, follow the upstream issuer cleanup before deploying; that is
not part of TTV's checked-in migration history.

## Configuration review

| 1.7 change | TTV assessment |
| --- | --- |
| Account identity and selectors | Built-in GitHub ID is unchanged. No accountInfo, token refresh, access-token or unlink selector API calls exist in TTV. |
| Generic OAuth, custom provider subjects, ID-token verification, Microsoft oid | TTV uses only the built-in GitHub redirect provider; none of these integrations is configured. |
| SQLite / Drizzle affected-row validation | Official Drizzle adapter remains configured with `provider: "sqlite"`. Real D1-shaped SQLite tests cover callback inserts, updates, reads and session deletion. |
| Stable joins and plural relation names | No experimental joins or usePlural configuration; existing relations remain compatible. |
| Bearer plugin | Existing agent flag stays unchanged. Tests cover enabled staging and disabled production configurations, revocation and synthetic deadlines. |
| Cookie cache binding | Five-minute default cache remains enabled. Tests require a matching session-token cookie and exercise sign-out. Normal cached cookies retain the configured cache window; synthetic sessions additionally recheck D1. |
| Database hooks | Existing synthetic-session hooks retain original deadlines and fail closed after expiry/revocation; both memory-adapter tests and a D1 adapter refresh test run with 1.7.14. |
| Proxy / dynamic baseURL | TTV supplies an explicit canonical baseURL, not allowedHosts or forwarded-header resolution. Callback URL is asserted. |
| Atomic custom storage and rate limits | No custom adapter, secondaryStorage or database rate-limit storage. Official adapter/default memory limiting remain. |
| OAuth provider, MCP plugin, SSO/SCIM, device auth, passwordless, 2FA, Stripe, Electron/Expo, captcha | Not enabled. TTV's own MCP route is unrelated to Better Auth's MCP plugin. |

## Verification

`src/lib/auth-upgrade.test.ts` seeds an existing GitHub account using migration
0000, applies every later real migration, then exercises `createAuth` through
the real GitHub provider and OAuth callback. Only outbound GitHub HTTP is
mocked. It checks repeated existing-user sign-in even after an email change,
new-user creation, cookies, sign-out, invalid state, duplicate identities,
bearer auth and synthetic-session lifetime. No actual GitHub OAuth login is
claimed by these unit tests.

The four temporary audit exceptions are removed. Audit tests require each
advisory to fail if it reappears. `auth-advisories.test.ts` retains the reviewed
plugin and rate-limit surface guards.

Live acceptance still requires the exact upgraded revision on staging, an
existing user's real GitHub sign-in, a new GitHub user's sign-in, sign-out,
and bearer agent authentication. Isolated PR previews have disabled OAuth
credentials and cannot replace those two real-provider checks. The current
shared-staging workflow is pinned to the old PR #171 integration branch;
it cannot deploy this task branch without an explicitly updated release path.
