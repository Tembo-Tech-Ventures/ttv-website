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
not proof of prepaid Unified Billing. PM clarified that the historical unified
mode requirement concerns Gateway routing, not a mandate to purchase prepaid
credits. The selected model is listed under ordinary Workers AI pricing; no
prepaid-only restriction was found. Preserve existing postpaid billing. Per-request
cache/log/retry controls above do not alter global settings. No credential
creation, secret installation, inference or paid probe occurred in this change.

After independent review and integration, PM must reserve an exact-SHA staging
slot before the single existing synthetic assessment and
cleanup. Verify deployed identity, binding response shape, assessment/citation
semantics and cleanup; do not infer successful model execution from unit mocks.

## Decision record: official guidance → implementation/review

Reviewed 2026-10-24. “Documented” below describes the current public contract;
“decision” describes our application choice. Unit mocks do not verify a deployed
service contract, account quota, actual billing, or model quality.

| Concern | Evidence and decision | Focused verification |
| --- | --- | --- |
| Authentication/routing | [Authenticated Gateway](https://developers.cloudflare.com/ai-gateway/configuration/authentication/) documents account-preauthenticated bindings. [Binding methods](https://developers.cloudflare.com/ai-gateway/usage/worker-binding-methods/) documents explicit gateway IDs; `default` can auto-create. Decision: require a non-default configured name and `AI.run`, use no key or fallback, leave gateway auth settings unchanged. | `assessment-provider.test.ts` missing binding/name/default refusal; `native-gateway.test.ts` exact model/options and no HTTP/key use. |
| Model/tools/JSON | [Gemma model contract](https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/) lists function calling, messages/tools, completion-token cap and choices output. [JSON mode](https://developers.cloudflare.com/workers-ai/features/json-mode/) is model-specific; a response-format field alone is insufficient proof of strict schema behavior. Decision: preserve JSON prompt plus server validation, reject malformed tool IDs/arguments/finish reasons. | Native tool roundtrip/refusal/truncation tests; assessment/parity/chat tests retain criterion states, citation versions and role restrictions. No claim that validated citations prove semantic truth. |
| Timeout/retries/errors | [Request handling](https://developers.cloudflare.com/ai-gateway/configuration/request-handling/) defines Gateway timeout against first response, and retry controls; its final-attempt behavior may outlast that timeout. Runtime source linked above forwards `signal` and returns raw response before parsing errors. Decision: add 20-second client signal, request timeout and `maxAttempts: 1`; never application-retry. | Signal-forwarding/rejection, one-call/error-redaction and 64KB body-limit tests. Actual cancellation and billable attempt count remain unverified; report ambiguity, never silently retry. |
| Context/output bounds | Model page advertises 256K context and `max_completion_tokens`. Our synthetic request is capped at 8,000 serialized input characters AND UTF-8 bytes; output request cap is 3,000 tokens, thinking disabled. Normal assessment source data cap remains 60K characters. Chat uses at most three rounds/six tools, 1,200 output tokens per round and bounded tool data. | Exact 8KB edge, escaped/Unicode oversized input, durable claim before invocation and concurrent/replay denial; chat round/tool/context tests. These input byte/character limits are not a measured tokenizer count. |
| Privacy/observability | [Logging](https://developers.cloudflare.com/ai-gateway/observability/logging/) says logs may contain prompts/responses and allows per-request disable. Decision: `collectLog:false`, `skipCache:true`; no source text or user metadata emitted. Metadata-only logging is a documented HTTP option, but is not added through an unverified binding option here. | Assert exact log/cache options and sanitized errors. Since collection is disabled, do not promise request-log retrieval or per-request cost evidence. Existing runner records outcome/latency/cleanup; aggregate usage may be inspected separately when available. |
| Deployment persistence | [Workers AI bindings](https://developers.cloudflare.com/workers-ai/configuration/bindings/) configure `ai.binding`. Repository `wrangler.jsonc` already declares `AI`; `scripts/cloudflare/lib.mjs` regenerates `ai.binding` and the environment gateway name on deploy. No new credential lifecycle is introduced. Locked Wrangler is 4.149.0; installed generated `AiOptions` supports raw response/signal and `GatewayOptions` supports timeout/retries. | Existing config tests plus independent diff review verify no binding/config removal. Exact deployed SHA and real binding response need PM staging validation; generated types alone do not prove backend behavior. |

### Existing postpaid compatibility and bounded cost

[Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)
lists this exact Gemma model in ordinary neuron/token pricing: $0.10 per million
input tokens and $0.30 per million output tokens. It is not in the listed models
requiring a paid billing method; even those accept Workers Paid or prepaid
credits. [Unified Billing](https://developers.cloudflare.com/ai-gateway/features/unified-billing/)
is an optional credit-funded billing route with a separate gateway setting.
No selected-model prepaid-only restriction was found. This transport change
retains the already-selected model and test envelope, so it does not request a
new billing product, model price increase or quota increase. Existing quota and
account entitlement still must allow the request; denial stops the run.

For ONE synthetic assessment, the enforced input bound is 8KB serialized model
input, not an exact input-token cap; output is requested at most 3,000 tokens.
At a deliberately padded planning scenario of 10,000 input tokens (including
chat-template overhead) plus the full output cap, nominal model cost is
`10000 × 0.10 / 1e6 + 3000 × 0.30 / 1e6 = $0.0019`.
This is an estimate, not a measured charge or hard dollar ceiling: tokenization,
provider accounting, cancellation and upstream attempts remain runtime facts.
It excludes Workers/D1/CI costs and any free allocation. Do not multiply the
request through ad-hoc retries. The planned test is the assessment route, not
a multi-round chat run. Preserve postpaid settings and use the normal review,
integration and PM-slot gate; no separate billing-change approval is needed.
