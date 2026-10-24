# Read-only staging credential audit

This manual workflow inspects the existing GitHub staging deploy credential. It
never copies it to the Worker, creates credentials, changes settings or invokes
inference. PM owns dispatch after independent review and integration into PR171.
It shares the staging concurrency group and refuses repeat run attempts.

Inputs: exact current integration SHA and the **known** token owner kind (`user`
or `account`). Determine the kind from credential provenance; do not guess and
retry after denial. The credential-free job checks the open integration PR before
the staging environment supplies secrets. No package installation is required.

The script issues at most two GETs: verify, then token details for the verified
ID. Each has a ten-second timeout, redirects disabled, no retries and a 64KB
successful-body cap. Failed HTTP bodies are never read. Output consists only of
fixed stage/status fields, numeric HTTP status, fixed active/unknown token state,
allowlisted permission names prefixed by policy effect, and a count of other
permissions. IDs, policy resource values, identities, raw errors and token values
are not output or saved as artifacts.

A failed metadata request means permissions remain unknown. User token details
require API Tokens Read or Write, which a deploy credential may lack. Permission
names are descriptive, not proof of effective account access: resource and deny
conditions still apply. This audit does not prove inference works, reveal a
missing dedicated token, or authorize storing a broad deploy token in the app.

New workflow dispatch availability must be checked by PM; GitHub may require a
workflow to exist on the default branch before dispatch. Do not merge to main or
change production registration to bypass that limitation. Report it if present.
