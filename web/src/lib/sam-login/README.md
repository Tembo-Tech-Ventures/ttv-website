# SAM login: agents sign in to staging as fictional personas

A SAM agent proves who it is with SAM's OIDC token and gets a short-lived browser session on
staging as one of eight fictional personas. It never needs a GitHub account, a shared password or
a long-lived secret, and it can never become a real person.

Production never has it: the Worker variables that switch it on reach only the canonical staging
deployment (`scripts/cloudflare/lib.mjs` refuses them anywhere else), and `samLoginConfig` is off
unless `DEPLOYMENT_ENVIRONMENT` is `staging`.

## Using it (agents)

Each SAM token is good for one login and lives five minutes, so ask SAM for a new one each time:

```
exec_with_secrets
  secretNames: []
  oidc: { audience: "https://staging.tembotechventures.com" }
  cwd: <repo>/web
  command: node scripts/sam-staging-login.mjs mentor
```

The script prints the persona, its account, when the session ends and the path of a Playwright
storage-state file (`/tmp/ttv-sam-login/<persona>.json`, mode 600). It never prints the cookie.
Open the site with it:

```js
const context = await browser.newContext({ storageState: "/tmp/ttv-sam-login/mentor.json" });
```

Options: `--ttl=<minutes>` (5 to 240, default 60) and `--out=<dir>`. `--revoke` ends the live
logins your SAM task made and deletes the newcomer accounts they created, up to 50 a call (one that
something still points at, such as a cohort role, is kept and counted as `newcomersKept`). Every
agent of one SAM user shares that user, so `--revoke` never touches another task's logins;
`--revoke --all` covers every task of your SAM user. The script sends the token only to staging or
a local `http://127.0.0.1` / `localhost` build. Treat the storage-state file as a credential: don't upload it, and scrub Playwright
traces, which also contain the cookie.

| Persona | Who | Lands on |
|---|---|---|
| `newcomer` | A brand-new account, every time, that hasn't finished onboarding | `/dashboard/welcome` |
| `applicant` | Applied to the next cohort; waiting for a decision | Cohort |
| `student` | Accepted into the current cohort | Cohort |
| `alumna` | Completed a past cohort, with a saved profile | Cohort |
| `community` | A community member who isn't in a cohort | Community |
| `mentor` | An approved, listed mentor | Mentoring |
| `institution` | An approved institution account | Discover |
| `admin` | A staging admin | Cohort, with the Admin space |

The cohorts are three fictional programs ("Cohort 90/91/92 (fictional)") whose dates are moved on
each login so that past, current and next stay true. Every login puts the persona's roles and
cohort status back to what the table says. Everything else it did in the app (posts, profile edits,
onboarding, mentor requests) carries over to the next login, so start a `newcomer` for a clean slate.
Nothing resets a fixed persona's content: to undo what one posted or changed, sign in as `admin`
and use the app's own moderation and admin pages, as you would for anyone.

Everyone on staging sees the personas, as they would see real members: the open "Cohort 92
(fictional)" on the homepage and the apply form, David Kamau in the mentor directory, and the
personas' posts in community channels. The fictional cohort numbers also move channel
auto-numbering on, so a later staging program with no number in its name gets `cohort-93` or above.

## Turning it on (owner)

In GitHub, Settings → Environments → `staging` → Variables, set:

- `SAM_LOGIN_PROJECT_ID`: the SAM project allowed to sign in (TTV is `01KK26ZXDF2067T5592MBP4013`).
- `SAM_LOGIN_USER_IDS`: comma-separated SAM user ids whose agents may sign in. A token's `user_id`
  is the person who owns the SAM session the agent runs in.

Then deploy staging. Both are needed; with either missing, `/api/staging/sam-login` is a 404.
Removing a user id, or either variable, and redeploying ends that user's live logins on their next
request, since every request checks the login against the current configuration.

## How it works

1. **The token.** `oidc.ts` checks the RS256 signature against SAM's published key set (fixed
   issuer `https://api.simple-agent-manager.org/oidc`, cached per isolate, refreshed at most once
   a minute for an unknown key id). It also checks the exact audience (this site's own origin, so a
   token for another site or for production doesn't work here), expiry, a lifetime of ten minutes
   at most, `type: workload-identity` and a subject that names the same project and user as the
   claims.
2. **Authorization.** `config.ts`: the token's `project_id` must be the configured project, and its
   `user_id` one of the configured users. Being a valid SAM token is not enough.
3. **The login.** `login.ts` (`POST /api/staging/sam-login`) refuses a token id it has seen
   (`staging_sam_login.jti` is unique), allows 60 logins an hour per SAM user, seeds the persona
   (`personas.ts`), and in one D1 batch writes the persona, a Better Auth session marked
   `ttv-sam-login:<loginId>`, and the `staging_sam_login` row recording the SAM user, task,
   workspace and agent session. It returns the session cookie, signed with `BETTER_AUTH_SECRET`
   as Better Auth signs it, plus `dont_remember` so Better Auth never extends the session.
4. **Every request.** Middleware (`resolveSamLogin`) accepts a persona account, or any session
   carrying the marker, only through a live login row: not expired, not revoked, the same session
   and user, a SAM user who is still allowed. Anything else about a persona is a 403, including a
   personal access token or an agent session that a persona admin created for itself. Every other
   account is untouched and costs no query.

Persona accounts are `ttv-sam-persona-*` with emails at `@invalid.ttv`. The persona name is the
only thing the caller chooses, so a real account can't be picked, and a login refuses an id that
already belongs to an account with a different email. The `admin` persona is a full staging admin:
it sees what any staging admin sees, which on staging is fictional demo data plus the staff
accounts that signed in with GitHub.

`staging_sam_login` has no foreign keys, so the audit trail and the spent token ids outlive the
session and the persona. A persona's actions are attributed to the persona; the login row says
which SAM task was behind it.
