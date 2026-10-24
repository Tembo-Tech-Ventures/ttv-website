# Hackathon staging delivery

For the October 24–25, 2026 iteration, the integration branch is
`sam/use-sam-mcp-tools-m8a3jp`, tracked by integration PR #171 and issue #170.
Supporting PRs target that branch. Never merge the integration PR into `main`
without separate production authorization.

## Dispatch and verification

1. Integrate supporting work, push, and verify CI for the exact integration
   revision. Supporting PR CI and isolated previews run for this target too.
2. Obtain the PM's deployment-and-verification slot on SAM channel
   `codex-paris-hackathon-2026-10`. Announce the full SHA and PR #171.
3. Dispatch **Cloudflare Staging** on `sam/use-sam-mcp-tools-m8a3jp` with
   `expected_sha` equal to that full SHA. This is deploy-only. The preflight
   checks the dispatch branch/SHA and GitHub's current open integration PR
   head before the credentialed staging job can start. If the branch advances
   before preflight, reconcile with PM and dispatch the new approved revision;
   do not weaken the guard.
4. The existing reusable workflow deploys, verifies environment and SHA via
   smoke checks, runs desktop/mobile browser checks and captures Worker logs.
   Review the uploaded evidence and separately complete the feature-specific
   authenticated persona journeys required by the PM acceptance contract.
5. Report workflow URL, actual `/api/health` environment/version, browser/MCP
   outcomes, screenshots/log evidence and remaining failures to PM/channel.
   Release the slot only after this verification. No shared staging teardown.

The workflow concurrency group covers preflight through deployment and
verification, with cancellation disabled. It is a backstop, not a reservation
system or FIFO queue: GitHub may replace pending runs. Never enqueue competing
deployments or cancel another agent's verification. PM coordinates any manual
verification that continues after the workflow ends.

The guard pins the current head of PR #171 rather than allowing an arbitrary
ancestor or a supporting PR. GitHub's dispatched SHA remains the deployment
identity even if the branch later advances. The guard does not replace CI
review, authorize deployment, or prove a working product journey.

## Prerequisites and limits

The GitHub `staging` environment must provide Cloudflare and GitHub OAuth
credentials. Shared-staging authentication needs identities/sessions in its
persistent D1; isolated preview identities do not work there. A missing
`STAGING_AGENT_TOKEN` means authenticated checks must not be reported as
successful merely because public smoke checks pass.

Provider access is a separate gate. The presence of Cloudflare credentials or
a successful deployment does not establish AI Gateway billing, endpoint
support, or model authorization. In particular `/v1/decisions` through Unified
Billing remains unverified; generic OpenAI support is insufficient evidence.

Do not print secrets or copy them into workflow inputs, issues or screenshots.
The preflight receives only a read-scoped GitHub token; Cloudflare secrets are
scoped to the subsequent reusable staging job. Production workflow, rollback
behavior and production credentials are unchanged.

## Reusable synthetic staging verification

The runner helpers are implemented but **not wired into a workflow yet**. Runtime
fixture authorization and its registry migration must be integrated and tested
before live provisioning. This is intended to support repeatable workflow-dispatch
browser verification beyond the hackathon; arbitrary interactive local browser
access is not delivered.

`staging-fixture-target.mjs` reads the configured account, actual staging Worker
bindings, exact D1 metadata and public deployment health. It requires the known
staging D1 UUID, staging Worker origin and exact expected deployed commit. Only
that verified target exposes a database executor, permanently bound to staging.
No credentialed writes occur in preflight. The main integration branch and PM
serialized slot rules still apply to verification and provisioning.

`withStagingPersonas` requires that verified target, the same signing configuration
used by the staging deployment and the migrated registry/ADMIN/MENTOR/INSTITUTION
roles. Never read secrets back from Cloudflare or log the resolved signing config.
The existing credentialed runner can resolve it through deployment helpers; no
new public endpoint or shared secret is introduced. No reference roles or real
user records are created or modified by the fixture helper.

Each run creates six namespaced fictional identities: member, otherMember,
mentor, institution, unapprovedInstitution and admin. Each has a registry entry
bound to its user/session/run/persona and absolute one-hour expiry. Member and
institution test requests use independently scoped, hashed PAT fixtures; admin
receives no PAT. Cookies and PATs remain within the callback and browser memory:
no workflow outputs, arguments, storageState, traces, HAR or credential artifacts.
Only explicitly sanitized results and fictional screenshots may be uploaded.

The pinned Better Auth implementation renews short database sessions by default.
The runner supplies a signed dont-remember cookie to suppress routine renewal.
This is NOT an authorization boundary: runtime must check the registry's absolute
expiry and live session on every synthetic request, even when a cached cookie
or renewed database expiry exists. Production must reject fixture identities
regardless of flags. Prefixes and request User-Agent headers cannot authorize a
fixture: authenticated session plus DB-backed run membership is required.

Runtime exceptions, owned by Developer, must allow only fixed fixture roles and
same-run synthetic targets. Credential minting and agent-access remain blocked.
An admin fixture may test synthetic approvals, never grant privileges to a real
user. Every invocation attempts registry/PAT/session/role/user cleanup, including
partial setup and callback failures; deletion failures are reported without
provider bodies or bound values. Default retention is zero. Any later evidence
retention mode needs explicit labelling and scope.

Tests apply actual existing application migrations, authenticate signed cookies
through the real createAuth/Drizzle/BetterAuth stack, check seconds-to-Date
conversion, expiry/revocation and delegated-session marking. The proposed new
registry currently has a contract fixture in the tests until Developer's migration
lands; this does not yet prove production isolation, runtime exceptions, or
staging browser acceptance. GitHub OAuth and external MCP client compatibility
also need their own evidence.
