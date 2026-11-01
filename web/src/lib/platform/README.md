# Platform contracts and synthetic fixtures

Astra owns `contracts.ts`. Each exported Zod 4 schema has an inferred TypeScript
type with the same PascalCase name. `ROUTES` uses camelCase keys and preserves
the shared `RouteDef<P, Q, B, R>` / `defineRoute` structure. These files install
no handlers, migrations, feature flags or runtime consumers.

Propose changes by publishing **`contract-request <proposal>`** on SAM channel
**`feature.platform-spaces`**. Agree the shape with the coordinator and affected
lanes before Astra lands a small contract PR. Fixtures are **append-only** for
all lanes: add a named scenario; do not rewrite an existing fixture to suit a
new screen or test.

## Wire rules

- Resource ids are opaque strings of 1–255 characters. Better Auth, imported
  records and synthetic staging records may use different formats; format never
  grants access. New database rows still use the existing `cuid()` helper.
  Timestamps are nonnegative integer **epoch
  milliseconds**, never `Date`, ISO strings or database seconds. Nullable means
  explicitly absent; optional request fields may be omitted. Enums use `z.enum`.
- `SPACE_ORDER` is fixed; `/me` spaces are an ordered subset. Role badges are
  display data, not permissions. `/me.flags` contains effective booleans for the
  caller; admin flags contain audience and update metadata. Channel capabilities
  are computed for the caller. The server's eventual `capabilitiesFor()` remains
  responsible for authorization; schema validation alone never grants access.
- Queries are typed values before URL encoding (including the mentor directory
  boolean). Future edge adapters must decode query strings before validation:
  accept exactly `true`/`false` for booleans and reject other strings. Never use
  `z.coerce.boolean()`, which would turn the string `false` into `true`.
  Cursors are opaque server tokens, never sortable resource ids. Message `before`
  and `since` are exclusive; `thread` is a parent message id. Lists are ordered
  oldest-first within a page. `beforeCursor: null` means no older page;
  `sinceCursor` is the next polling checkpoint, including on empty pages. It
  must account for edits/deletions and visibility removals as well as new messages.
  `removedIds` is always present (empty for ordinary pages). Polling consumers
  must evict these ids from cached lists/threads; the delta includes no removed
  content, and cannot also return the same id in `items`. Servers emit removal
  ids only for messages the caller could previously read, never leak hidden ids
  to new readers, and require a fresh authorized snapshot if the cursor expires.
  Attention uses
  newest-first pages and `nextCursor: null` at the end.
- Message bodies are Markdown source. Posts require nonblank text (up to 10,000
  characters), `clientNonce`, explicit `parentId` (`null` for a root), and
  `embeds` (empty if none, at most five). The nonce is an opaque client-generated
  token, stable across retries, unique per author. Reusing it with different
  content must return `conflict`. Embeds on writes are references only: the
  server resolves all labels, quotations, visibility and confirmations. A
  confirmation covers its own `version`, never every revision or the person.
- Deleted messages retain their id/thread position but have empty body, embeds
  and citations. Moderation details are `null` for ordinary readers; only the
  author and authorized moderators receive state/reasons. Hidden originals in
  the fixtures are **moderator/author views**. Future handlers must redact hidden
  content for other readers, and must visibility-check every embed/citation.
- Tembo asks refer to an existing asking message. Mention and explicit asks must
  converge on one invocation per asking message, without spending quota twice.
  The handler must verify that `messageId` belongs to the route's channel `:id`,
  is readable by the caller, and for explicit asks belongs to the caller.
  Reject mismatches before retrieval or quota spending; never trust either id
  to establish the other's scope. Later handler tests must cover each mismatch.
  Pending responses identify that message; answers are `TEMBO` messages in its
  thread. Tembo has a null user id, an AI badge and explicit channel scope.
  Citations identify sources. When no sources support an answer, a refusal may
  have no citations.
- `idempotent: true` is a server obligation allowing client retries, not an
  implementation supplied by this registry. Reactions set `{kind, active}`;
  feedback replaces the caller's choice; channel read markers advance, never
  rewind. Attention mark-all sends `{through: snapshotAt}`, so new items stay
  unread. Mentor transitions, reports and moderation actions are conservatively
  marked non-retryable until their future implementations define deduplication.
- One `ErrorEnvelope` covers failures. `retryAfterMs` is milliseconds.
  Flags-off APIs will return HTTP 404 with `flag_off`. `conduct_required`
  (HTTP 403) means the caller must agree to the current channel code of
  conduct before posting or editing; agreeing and sending again succeeds. Success bodies, including
  deletes and empty action requests (`{}`), are explicitly defined in `ROUTES`.
- Mentor capacity and Tembo usage may exceed a newly reduced limit; clients must
  clamp available capacity to zero. Mentor month boundaries use Africa/Nairobi.
  Acceptance creates a private channel; redirect identifies the proposed mentor.
  Availability PUT replaces the editable fields. Backend state-machine and
  capacity checks belong to the later implementation.

- Onboarding (library `/reports/platform-onboarding-2026-11-01/SPEC.md` §5):
  intents choose routing and copy only and never reach `capabilitiesFor()`.
  `EXPLORING` stands alone; inferred intents are computed, never written.
  Mentor and institution access are *access requests* (not `MentorRequest`,
  which asks a mentor for time). Requester-facing shapes (`AccessRequestSummary`,
  `OnboardingState`, `access_decided` attention) never identify the deciding
  administrator: `decidedBy` exists only on `AdminAccessRequest`, and
  `access_decided` items must have a null actor. Request text is untrusted plain
  text. Every requester write returns the whole `OnboardingState`, because a
  withdraw also removes its intent. These routes are for same-origin browser
  sessions only: PATs and agent sessions are refused, admin routes included. The
  admin routes are not flag-gated, so pending requests are never stranded.
  `earlierRequests` lists only closed requests: a pending request for the other
  role is its own queue row. Request links are http(s) without credentials.

## Fixture scenarios and verification

All people and work are **fictional, synthetic demo data**. `FIXTURE_NOTICE` must
be shown by future harnesses. No production identities, photos or records were
copied. External example links use `example.com`; all dates and ids are stable.

The source is library `/reports/platform-ux-2026-10-30/screens/`: `01` maps to
`communityMessages`/`communityThread`, `02` to `cohortMessages`/`cohortThread`,
`03` to `attention`, `04` to `searchResults`, `05–06` to `mentors`, requests and
`availability`, and `08` to `moderationQueue`. The required nine personas each
have a `meByPersona` entry; additional fictional prototype people support these
scenes. Lucy is community-only (Brian replaces her inconsistent cohort message
in screen 02). Current mission rules also keep alumni's Cohort space and give
admins Discover without inventing a mentor role. The five `/me` flags are on for
demo scenes; `flagsAdmin` separately illustrates the initial OFF database state.
Attention and channel unread counts are separate counters, not summed together.

The onboarding scenario follows `/reports/platform-onboarding-2026-11-01/`:
Mercy Akinyi chose member + mentor and waits, Joseph Ochieng asks for
institution access, Peter Njoroge's mentor request was declined, and Wairimu
Ndung'u has just signed up (`onboardingByPersona`, `accessRequests`,
`adminAccessRequests`, `accessAttention`). Mercy Wambui and Joseph Mutua already
hold approved roles in the scenes above, so the onboarding Mercy and Joseph are
separate fictional people.

Run `npx vitest run src/lib/platform/contracts.test.ts src/lib/platform/fixtures.test.ts`
from `web/`. Tests validate every exported fixture through JSON round trips,
assert the exact endpoint list and typed exchanges, reject malformed inputs,
and check cross-fixture references, privacy scope, revision evidence and counts.
The standard test, lint, typecheck and Astro checks also apply.
