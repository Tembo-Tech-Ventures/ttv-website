# Admin-managed integration credentials

TTV stores third-party integration credentials (initially the Google Drive
service-account key used by session-recording imports) encrypted in D1, managed
by administrators from the admin UI instead of deploy-time Worker secrets.

## Goals

- An ADMIN can set, replace, and remove the Google Drive service-account
  credential from **Admin → Integrations** without a deploy.
- Secret material is never stored in plaintext at rest and is never rendered
  back to any client after it is saved (write-only UI).
- Deploys need exactly one secret for this system: a master encryption key.
  The Google JSON key never passes through GitHub secrets or CI.
- The system is generic: future integrations reuse the same store, UI page,
  and audit trail rather than growing bespoke tables.

## Threat model

| Scenario | Outcome |
|---|---|
| D1 backup / SQL-level read leaks | Attacker gets ciphertext only |
| Master key leaks alone | No credential data without the database |
| Master key + database leak | Equivalent to today's Worker-secret compromise |
| Compromised admin session | Can replace/remove the credential and repoint imports, but cannot read the stored key. Mitigated by the audit log, the admin origin guard, and the credential's small Google-side blast radius (Viewer on one folder, `drive.readonly`). |

Google-side containment remains the first line of defence: the service account
should only ever be a **Viewer** on the recordings folder with the
`https://www.googleapis.com/auth/drive.readonly` scope.

## Encryption

- **Master key**: `CREDENTIALS_ENCRYPTION_KEY`, a Worker secret holding 32
  random bytes, base64-encoded. Optional `CREDENTIALS_ENCRYPTION_KEY_PREVIOUS`
  is accepted for decryption only, enabling rotation.
- **Cipher**: AES-256-GCM via WebCrypto (`crypto.subtle`, native in Workers).
- **Per write**: fresh random 96-bit IV. The GCM additional authenticated data
  (AAD) is the provider slug (e.g. `google-drive`), so a ciphertext cannot be
  swapped between rows.
- **Stored blob format**: `v1.<keyId>.<iv>.<ciphertext>` where `keyId` is the
  first 8 hex chars of SHA-256(raw key bytes) and `iv`/`ciphertext` are
  base64url. The GCM tag is included in the ciphertext (WebCrypto default).
- **Rotation**: set the new key as `CREDENTIALS_ENCRYPTION_KEY`, move the old
  one to `CREDENTIALS_ENCRYPTION_KEY_PREVIOUS`, redeploy. Decryption selects
  the key by `keyId`; a blob decrypted under the previous key is lazily
  re-encrypted under the current key on first read. Remove the previous-key
  secret once no blobs reference it.
- **Missing key**: if `CREDENTIALS_ENCRYPTION_KEY` is unset the Integrations
  page renders a clear "credential storage is not available in this
  environment" state and disables the forms. Nothing crashes.

## Schema

`integrationCredential`
- `id` (cuid PK)
- `provider` text, unique — e.g. `google-drive`
- `ciphertext` text — versioned blob, see above
- `displayMetadata` text — JSON of non-secret facts derived at save time
  (client email, project id, key-id fingerprint) for the UI
- `config` text — JSON of non-secret, editable provider config
  (for Drive: `{ "impersonatedUser": "..." }`), editable without re-pasting
  the secret
- `updatedByUserId` → `user.id`, `createdAt`, `updatedAt`

`credentialAuditLog`
- `id`, `provider`, `action` (`set` | `replace` | `update-config` | `remove` |
  `test`), `outcome` text (short, sanitized — never secret material or raw
  upstream error bodies), `actorUserId` → `user.id`, `createdAt`

## Module contract

```
web/src/lib/credentials/crypto.ts
  createCredentialCipher(env): CredentialCipher
  CredentialCipher.encrypt(plaintext, aad): Promise<string>
  CredentialCipher.decrypt(blob, aad): Promise<{ plaintext; needsReencrypt }>

web/src/lib/credentials/store.ts
  setIntegrationCredential(db, cipher, { provider, secret, config,
    displayMetadata, actorUserId })            // insert-or-replace + audit
  updateIntegrationCredentialConfig(db, { provider, config, actorUserId })
  getIntegrationCredentialSecret(db, cipher, provider)
    → { secret, config } | null               // lazy re-encrypt inside
  getIntegrationCredentialStatus(db, provider)
    → { configured, displayMetadata, config, updatedAt, updatedBy } | null
  deleteIntegrationCredential(db, { provider, actorUserId })
  recordCredentialTest(db, { provider, actorUserId, ok, detail })

web/src/lib/credentials/google-drive.ts
  interface GoogleDriveCredentials {
    clientEmail: string
    privateKey: string          // \n-normalized PEM
    privateKeyId?: string
    impersonatedUser?: string
  }
  saveGoogleDriveCredential(db, cipher, { serviceAccountJson,
    impersonatedUser, actorUserId })
  getGoogleDriveCredentials(db, cipher): Promise<GoogleDriveCredentials | null>
```

`getGoogleDriveCredentials` returns `null` when unconfigured; it throws only on
corrupt state (failed decrypt / unparseable stored JSON), which is a different
condition from "not configured" and is surfaced as such.

`saveGoogleDriveCredential` validates before persisting: the pasted document
must be JSON with `type: "service_account"`, string `client_email` and
`private_key`; the private key must PEM-decode and import via
`crypto.subtle.importKey("pkcs8", …, RSASSA-PKCS1-v1_5/SHA-256)`. Invalid input
is rejected and never stored. Newlines in `private_key` are normalized
(`\\n` → `\n`) exactly as the recordings importer expects.

## Admin UI

`/admin/settings/integrations` (nav label **Integrations**), ADMIN-guarded by
existing middleware and the admin origin guard. Standard Astro form-POST
handling in frontmatter, per repo convention.

- **Unconfigured**: textarea to paste the service-account JSON, optional
  impersonated-user field, Save. The pasted value is never echoed back —
  on validation failure the field is empty and the error names the problem.
- **Configured**: shows client email, project id, key-id fingerprint,
  impersonated user, who configured it and when, and recent audit entries.
  Actions: **Replace** (paste new JSON), **Update impersonated user**,
  **Remove**, and **Test connection** (added with the Drive import port —
  mints a token and lists the configured folders; reports a sanitized
  pass/fail per source; never returns tokens to the client).
- No GET ever returns secret material. Secrets and upstream error bodies are
  never logged.

## Consumption

The recordings importer reads credentials exclusively through
`getGoogleDriveCredentials(db, cipher)`. There is **no environment-variable
fallback** for the Google key: the database is the single source of truth, and
the only deploy-time secret is the master key. The importer's in-memory Google
access-token cache stays keyed by credential identity, so replacing the
credential invalidates cached tokens naturally.

## Deployment

- `cloudflare-environment.yml` passes `CREDENTIALS_ENCRYPTION_KEY` from GitHub
  environment secrets for non-`agent-*` environments, mirroring
  `BETTER_AUTH_SECRET`.
- For isolated `agent-*` previews the deploy script derives a per-environment
  key from `AGENT_PREVIEW_SECRET` (same pattern as the derived Better Auth
  secret), so the feature is fully exercisable in previews with dummy
  credentials.
- GitHub `staging` and `production` environments each hold an independent
  random `CREDENTIALS_ENCRYPTION_KEY` (provisioned 2026-08-08).
- Local development uses a dev-only key via the same channel as
  `BETTER_AUTH_SECRET` in local dev.

## Delivery plan

1. **PR A — credential store**: schema + migration, crypto + store + Drive
   credential modules, Integrations page, audit log, deploy plumbing, tests.
   Ships inert (no consumer yet).
2. **PR B — Drive import ported to main**: the session-recording importer from
   commit `b1160bb` (Drive client, importer, `recording_import_source`,
   import admin UI, 15-minute cron, queue integration) rebased onto current
   main and wired to the credential store from day one. Adds the live
   Test-connection action. The old `GOOGLE_DRIVE_*` secrets never ship.
3. Verify on an `agent-*` staging environment, then merge to `main`
   (auto-deploys to production).
