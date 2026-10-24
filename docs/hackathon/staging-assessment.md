# One-shot synthetic staging assessment

This diagnostic exercises the deployed community assessment HTTP route with
fresh fictional member/institution fixtures and the Worker's existing Gateway
configuration. It does not copy inference credentials to the runner. It does
not verify institutional browser interaction or chat; those remain separate
acceptance checks.

Only the PM may reserve and authorize a run. Integrate the reviewed supporting
work into PR171 first, deploy that exact integration head, then reserve a new
serialized staging verification slot. `Cloudflare Staging` action `assess`
requires that full deployed SHA. Preflight checks the open integration PR head,
dispatch revision, staging Worker bindings and health identity before fixtures
are provisioned. Workflow reruns (`GITHUB_RUN_ATTEMPT != 1`) are rejected;
another dispatch requires a new PM decision, not automatic retry.

The fixed program creates one fictional published contribution, checks an
unapproved institution is denied and an empty profile returns insufficient
evidence without inference, and sends exactly one evidence-bearing assessment
request. There is no chat, browser automation, arbitrary prompt or target input.
The server constructs the normal provider payload and validates its complete
serialized length: at most 8,000 UTF-16 code units AND 8,000 UTF-8 bytes. It keeps
the current Gemma model, 20-second provider timeout, 3,000 output-token ceiling
and no retries. Ordinary user requests retain their existing limits.

The strict mode derives only from a server-resolved synthetic institution
identity in `staging` whose registered source session has the exact dedicated
`<userId>-assessment-session` ID. Only the assessment runner provisions this
session form; ordinary synthetic browser fixtures remain unchanged. No caller
header selects the mode. Immediately before inference,
after normal evidence authorization and payload validation, it atomically
deletes that fixture's registered source session. Only one concurrent request
can consume it. The existing live fixture resolver then rejects browser and
PAT retries; a timeout or invalid model result never restores the session.
This intentionally ends the fixture institution's usability for the run. The
runner checks that with a read, not a second assessment request. Other fixture
sessions and real identities are untouched. Production rejects synthetic mode.

The normal fixture lifecycle performs cleanup in `finally`, including failures.
The success artifact is `test-results/staging-assessment/manifest.json`, published
after successful cleanup. It contains fixed status/model/limits, measured
serialized sizes and HTTP elapsed time, criterion status/rating and validated
fictional citation IDs/versions. Model prose, raw responses, prompts, request
headers, credentials, cookies, screenshots and traces are omitted. Usage and
billing remain explicitly unavailable. A claimed provider attempt is not proof
of provider billing or completed inference; success also requires a valid
completed assessment response. Any failure requires cleanup review and PM
authorization before another run.

Failures publish a separate `failure.json` containing only fixed phase/error
codes, a numeric HTTP status when available, the expected revision, and separate
operation/cleanup outcomes. No raw exception, provider body, prompt, identity,
header or credential is included. Cleanup checks residual counts for the exact
provisioned IDs after attempting every deletion; a failed count query or nonzero
count cannot be reported as successful cleanup. This audit also distinguishes a
failed verification with successful cleanup from a cleanup failure.

HTTP phases identify the last attempted operation; they do not prove that a
provider was called. Failure manifests deliberately report provider invocation
as unknown and billing as unavailable. A transport failure includes timeouts
but does not guess their cause. A runner failure before fixture creation leaves
cleanup marked not-started. Workflow installation/preflight failures may have no
manifest. Read-only deployment binding presence and Gateway metadata can be
correlated separately, without exposing values or making another inference call.
