# One-shot staging inference credential setup

Use the existing `Cloudflare Staging` dispatcher, action `gateway-setup`, only
on the exact reviewed, pushed current integration PR171 SHA and within a PM
reserved shared-channel slot. It creates a new Worker version: this is a staging
mutation, not a metadata audit. No production or isolated-preview target exists.
Do not re-run the job or dispatch it again after an ambiguous result.

The Actions staging environment already supplies the account-owned Cloudflare
bootstrap token. Its reviewed metadata includes Account API Tokens Write and
Workers Scripts Write; names alone do not prove effective authorization.
The script resolves the two inference permission IDs from the account API and
requires `is_selectable: true` plus account scope. Cloudflare's token creation
request remains the authoritative permission check; a denial stops processing.

The script refuses an existing `AI_GATEWAY_API_KEY` secret or an existing token
named `ttv-staging-inference-hackathon-2026-10` (including recently expired
entries). Inventory pagination is bounded and must have completion metadata.
It creates one token expiring **2026-10-26 00:00 UTC**, with one allow policy:
AI Gateway Run + Workers AI Read, only the TTV account. This is account-wide
inference permission, including every gateway and its stored BYOK credentials;
“staging” describes the token's intended use, not provider-side gateway isolation.
No deployment or token-management permissions are granted to the new token.

After validating the created token's policy using metadata, the script passes
its value directly in process memory to the fixed staging Worker secret PUT.
No shell arguments, files, artifacts, GitHub outputs or response/error text
carry the value. The existing bootstrap credential authenticates both management
operations and is never installed in the Worker. The output contains only fixed
status labels, HTTP status and the validated non-secret newly-created token ID.
There are no automatic retries, alternate endpoints or credential fallbacks.

## Failure and recovery

- Before creation: no credential mutation. Existing secrets/tokens require review,
  not overwrite, rotation or deletion by this script.
- Creation timeout/malformed response: creation is unknown; do not create again.
  Reconcile account token inventory by the fixed name and the workflow receipt.
- Known newly-created token but policy/transfer/readback failure: attempt exactly
  one deletion of that token ID only. Never delete the bootstrap or an inventory
  token. A failed or unknown PUT may leave a binding holding a revoked/unusable
  token; report it and stop. Rollback failure is explicitly reported as unknown.
- Process termination can prevent rollback. Inventory reconciliation is required
  before retrying; workflow cancellation is not evidence of no mutation.
- The pre-PUT secret recheck reduces accidental overwrite; Cloudflare does not
  provide a conditional create here. The serialized PM slot is still mandatory.

## Persistence and acceptance

`deploy.mjs` calls `setWorkerSecrets(getSecretBindings())`, which only updates
provided keys. An absent `CLOUDFLARE_AI_GATEWAY_TOKEN` omits the AI key; it does
not delete it. Locked Wrangler **4.149.0** `deploy()` sets `keepSecrets: true`,
which becomes upload metadata `keep_bindings: [secret_text, secret_key]`.
Existing secrets therefore survive ordinary deployments even when absent from
Wrangler config. `keep_vars` concerns ordinary vars, not this secret behavior.
GitHub environment secret-write access is not required by this path.

Setup success establishes secret-name presence, not inference or deployment
persistence. In subsequent PM slots: verify metadata presence, run the ordinary
exact integrated-SHA deployment, re-check binding presence and deployed health
identity, then run one bounded existing synthetic assessment and cleanup.
No inference is performed by setup itself. Recreating/deleting the Worker or
rotating/expiring the token needs a separate reviewed provisioning decision;
there is no promised recoverable backup in GitHub or SAM.

Sources checked 2026-10-24:
- [Account token creation](https://developers.cloudflare.com/api/resources/accounts/subresources/tokens/methods/create/)
- [Account permission groups](https://developers.cloudflare.com/api/resources/accounts/subresources/tokens/subresources/permission_groups/methods/list/)
- [Worker secret PUT](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/secrets/methods/update/)
- [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Gateway authentication and account scope](https://developers.cloudflare.com/ai-gateway/configuration/authentication/)
