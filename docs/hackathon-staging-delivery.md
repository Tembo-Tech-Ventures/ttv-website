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

## Synthetic persona verification helper

`web/scripts/cloudflare/staging-personas.mjs` provides a runner-only
`withStagingPersonas` callback for a later credentialed verification step. It
is not wired into deployment yet and must not be called without the PM slot.
The runner must resolve actual Cloudflare D1 metadata and bind the executor to
that database; never accept a user-supplied database name as proof of identity.
The helper requires `staging` and `ttv-website-db-staging`, and migrated MENTOR
and INSTITUTION roles. It does not create reference roles or ADMIN users.

Each invocation creates distinct fictional member, other-member, mentor,
institution and unapproved-institution identities with one-hour random bearer
sessions. Pass tokens to browser contexts only in runner memory. Disable traces
or redact authorization headers wherever test tooling records requests. Revoke
the invocation's sessions on success, test failure or partial setup. Labelled
fictional data is retained for review; cleanup of that data must be separately
scoped. Failed revocation is an error, with one-hour expiry as the backstop.

This tests application role and ownership enforcement using the staging bearer
plugin. It does not establish GitHub OAuth, owner admin approval or external MCP
token issuance behavior. Those paths need separate acceptance evidence. A
workflow completion or an admin-authorized request cannot substitute for the
member-denied and unapproved-institution-denied checks.
