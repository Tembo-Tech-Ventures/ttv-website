# Better Auth 1.7 upgrade

Target: `better-auth ~1.7.15` (latest published 1.7.x on 2026-11-03), with
the lockfile resolving every Better Auth adapter/core package to 1.7.15.
`src/lib/auth-advisories.test.ts` fails if any of them drops below its patched
release or drifts away from `better-auth`'s own version.

## Advisories retired

`npm audit --omit=dev` on 1.6.33 reported four advisories. 1.7.15 fixes all of
them. None was reachable in TTV's configuration, which enables only the
built-in GitHub provider and, on staging only (`AGENT_AUTH_ENABLED`), the
`bearer` plugin:

| Advisory | Severity, fixed in | Needs | TTV |
| --- | --- | --- | --- |
| [GHSA-965c-763c-88jm](https://github.com/advisories/GHSA-965c-763c-88jm) OAuth state used as a Magic Link token | critical, 1.7.7 | `magicLink()` plugin, plus a social provider and database OAuth state | GitHub and database state are on, but no `magicLink()`, so there is no endpoint that accepts the state value as a token. |
| [GHSA-r4xp-prcw-77qf](https://github.com/advisories/GHSA-r4xp-prcw-77qf) OAuth Proxy sign-in as another user | high, 1.7.7 | `oauthProxy()` plugin with cookie-stored state | No `oauthProxy()`, and state is the database default. |
| [GHSA-q84f-53jg-9ppm](https://github.com/advisories/GHSA-q84f-53jg-9ppm) device login approval hides client and scopes | high, 1.7.0-rc.3 | `deviceAuthorization()` plugin | Not enabled. Bearer is on in staging, but there is no device flow to mint the token. |
| [GHSA-44jh-23m7-hpcf](https://github.com/advisories/GHSA-44jh-23m7-hpcf) concurrent requests exceed rate limits | low, 1.7.7 (Drizzle), 1.7.0 (Kysely) | Database-stored rate limits on PostgreSQL | Default in-memory rate limits on SQLite (D1). |

`auth-advisories.test.ts` keeps those conditions true: it fails if a plugin
other than `bearer` is imported, if any of the three affected plugins is called
anywhere in `src/`, or if `auth.ts` configures `rateLimit`. `audit:ci` no
longer allowlists any of the four, and its tests require each to fail if it
reappears at high or critical. The low-severity rate-limit advisory sits below
`audit:ci`'s threshold, which is why the lockfile floor test exists.

## Account data remains unchanged

The [official upgrade guide](https://better-auth.com/docs/guides/1-7-upgrade-guide)
supersedes the 1.7.0 release notes: **1.7.3 reverted the required `issuer`
column and restored `(providerId, accountId)` identity**. The guide still says
so on 2026-11-03 ("The account schema is unchanged from 1.6. No column needs to
be added."), and the installed 1.7.15 account schema and GitHub provider
confirm it. GitHub's immutable numeric profile ID still becomes
`account.accountId`, and `providerId` remains `github`.

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
with the owner; never choose, merge or delete identities automatically. 1.7.x
fails closed on ambiguous account keys. If a database was separately migrated
to 1.7.0–1.7.2, follow the upstream issuer cleanup before deploying; that is
not part of TTV's checked-in migration history.

## 1.7.14 → 1.7.15

The [1.7.15 release](https://github.com/better-auth/better-auth/releases/tag/v1.7.15)
is bug fixes only. The ones that touch code TTV runs:

- Built-in social providers no longer follow HTTP redirects on token exchange,
  refresh and verification. GitHub's token and user endpoints answer directly,
  and the callback tests exercise the exchange with 1.7.15.
- Headers and cookies set by a non-returning `hooks.before` are kept. TTV has
  only an `after` request hook (synthetic session lifetime); the `before` in
  `synthetic-session-lifetime.ts` is a database hook, which this does not touch.

The rest (admin, organization, API key, Stripe, CIMD, username, Nuxt, the CLI,
OAuth Proxy `additionalData`) concerns plugins and packages TTV does not use.

## Configuration review

| 1.7 change | TTV assessment |
| --- | --- |
| Account identity and selectors | Built-in GitHub ID is unchanged. No accountInfo, token refresh, access-token or unlink selector API calls exist in TTV. |
| Generic OAuth, custom provider subjects, ID-token verification, Microsoft oid | TTV uses only the built-in GitHub redirect provider; none of these integrations is configured. |
| SQLite / Drizzle affected-row validation | Official Drizzle adapter remains configured with `provider: "sqlite"`. Real D1-shaped SQLite tests cover callback inserts, updates, reads and session deletion. |
| Stable joins and plural relation names | No experimental joins or usePlural configuration; existing relations remain compatible. |
| Bearer plugin | Existing agent flag stays unchanged. Tests cover enabled staging and disabled production configurations, revocation and synthetic deadlines. |
| Cookie cache binding | Five-minute default cache remains enabled. Tests require a matching session-token cookie and exercise sign-out. Normal cached cookies retain the configured cache window; synthetic sessions additionally recheck D1. |
| Database hooks | Existing synthetic-session hooks retain original deadlines and fail closed after expiry/revocation; both memory-adapter tests and a D1 adapter refresh test run with 1.7.15. |
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

Isolated PR previews (`agent-pr-<n>`) run without GitHub OAuth credentials, so
a real sign-in needs the shared staging environment, which has them. Its
workflow deploys any open same-repository PR at its exact head:

```bash
gh workflow run cloudflare-staging.yml --ref <pr-branch> \
  -f action=deploy -f expected_sha=<full head sha> -f deploy_pr=<pr number>
```

Then confirm `https://staging.tembotechventures.com/api/health` reports that
SHA, and sign in at `https://staging.tembotechventures.com/auth/login` with a
GitHub account that already has a staging account, and ideally one that does
not. Both should land signed in on the dashboard as the expected person, with
no duplicate account; signing out should return to signed out.
