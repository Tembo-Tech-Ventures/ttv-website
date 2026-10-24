# Community evidence support assessments

REST `POST /api/community/profiles/:userId/assessment`, MCP `assess_profile`, and
chat's rubric-specific assessment tools share the same actor-authorized assessment
path. Chat accepts an optional versioned `rubric` alongside its existing fields.
Its `assessments` array contains the authoritative structured results, distinct
from generated prose. One chat request can assess one profile, with at most ten
criteria; repeated calls for that profile reuse the result.

The result includes `status`, `method: model-evidence-support-v1`, `model`,
`rubric: {id, version}`, `subject: {userId, profileVersion}` and `criteria`.
Each criterion has its server-owned `criterionId` and `label`, status,
`rating`, explanation and source citations. Only `assessed` has an integer rating
from 1 to 5. `insufficient`, `uncertain` and `contradictory` have null ratings.
Provider/configuration failures return `unavailable` with `provider_unavailable`;
rejected model output returns `invalid_output`. Both have empty criteria. Neither
becomes a low rating or a deterministic lexical fallback.

Ratings concern documented supporting evidence, never ability or employability:

1. Minimal but relevant specific claim.
2. Partial concrete account with important gaps.
3. Detailed direct contribution tied to the criterion.
4. Detailed support with consistent independent corroboration.
5. Unusually complete attributable documented support, corroboration and clear limitations.

Counts and mentor titles do not automatically raise ratings. External links are
not fetched or verified. Empty published evidence yields deterministic insufficient
results without inference. Private or other-subject contributions and stale
confirmations are excluded from model inputs; cited outdated support cannot earn
an assessed rating. Profile text remains self-report and mentor statements retain
their actor and role snapshot. Citation checks establish allowed source identity
and version, not semantic truth of generated explanations.

The isolated provider adapter and community chat share the explicit community model
`workers-ai/@cf/google/gemma-4-26b-a4b-it` through the explicit existing AI Gateway using the preauthenticated `AI` binding.
This scoped choice leaves recording chat, global defaults and the original caller
environment unchanged. Missing Gateway configuration fails closed. Calls have a twenty-second
abort signal and Gateway first-response timeout, bounded context/output, and no application retry or direct-provider fallback. Gateway retry policy requests `maxAttempts: 1`; timeout does not prove upstream generation or billing stopped. The native adapter sets `skipCache: true` and `collectLog: false` to avoid caching or logging personal evidence. No HTTP API key is required.
The prompt requests JSON; server validation is mandatory. Cloudflare's model page
advertises `response_format`, but the general JSON-mode compatibility list does
not establish a Gemma guarantee, so this slice does not enable strict response
format assumptions. See the official [model page](https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/)
and [JSON-mode guide](https://developers.cloudflare.com/workers-ai/features/json-mode/).

The older `assessEvidence` helper remains explicitly labeled deterministic literal
coverage for compatibility tests; public assessment endpoints use the model path.
This implementation and mocked provider tests do not establish live inference,
account/model availability or quality of ratings. Those require the PM's separate
controlled staging validation gate.

## Native transport verification and live gate (2026-10-24)

The community adapter uses `@cf/google/gemma-4-26b-a4b-it` with an explicit
non-default gateway name. It requires the AI binding, requests a raw Response,
and bounds the body before JSON parsing. Tool calls must use the documented
completion shape with valid IDs, arguments and finish reason; unsupported shapes
fail closed. AssessmentProvider remains the seam for a future reviewed provider.
No automatic model selection or OpenAI integration was added.

Cloudflare's [runtime source](https://github.com/cloudflare/workerd/blob/main/src/cloudflare/internal/ai-api.ts)
forwards the abort signal to fetch, selects the Gateway path when a gateway ID
is supplied, and returns raw responses before error parsing. Its
[Gateway options](https://github.com/cloudflare/workerd/blob/main/src/cloudflare/internal/aig-api.ts)
include retry and request-timeout settings. Source inspection establishes the
client contract, not deployed upstream cancellation or actual attempt counts.
[Authenticated bindings](https://developers.cloudflare.com/ai-gateway/configuration/authentication/)
need no manually supplied token and do not require disabling gateway security.

Read-only staging metadata inspection found `workers_ai_billing_mode: postpaid`,
authentication false, cache TTL zero, log collection true, rate limit/interval
zero, and retry fields null. No settings were changed. Gateway routing alone is
not proof of Unified Billing: the current postpaid setting must be reconciled
with the owner's billing requirement by PM before live inference. Per-request
cache/log/retry controls above do not alter global settings. No credential
creation, secret installation, inference or paid probe occurred in this change.

After independent review and integration, PM must reserve an exact-SHA staging
slot and resolve billing before the single existing synthetic assessment and
cleanup. Verify deployed identity, binding response shape, assessment/citation
semantics and cleanup; do not infer successful model execution from unit mocks.
