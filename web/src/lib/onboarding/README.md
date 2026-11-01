# Onboarding

Role-neutral sign-up, then guided onboarding (library
`/reports/platform-onboarding-2026-11-01/SPEC.md`, owner policy 62521d22). People
say how they will take part; that choice changes routing and copy, **never
authority**. Mentor and institution access are *access requests* that an
administrator decides. "Access request" is deliberately distinct from
`MentorRequest`, which asks a mentor for time.

## Data (migration `0025_onboarding.sql`)

- `member_intent`: the saved choices, one row per intent (`MEMBER`, `MENTOR`,
  `INSTITUTION`, or `EXPLORING` on its own).
- `member_onboarding`: `NEW` for accounts created while onboarding is open,
  `DONE` once they choose or dismiss the card. No row means the account predates
  rollout (stage `PROMPT`, the one-time card).
- `access_request`: one row per request. A partial unique index allows one
  `PENDING` request per person and role. CHECKs mirror the contracts: note length,
  institution-only organisation and scope acknowledgement, decision fields only
  on decided rows. `decidedBy` is audit-only and never selected for the requester.
  `withdrawalId` is a per-call nonce that only a withdrawal sets, so the
  statements batched with it act for that call alone.
- The `onboarding` flag row is seeded `OFF`. `flags.ts` makes it effective only
  while `spaces` is.

Timestamps are epoch milliseconds written by the domain, like `attention_item`.
Every row cascades with the user. There are no analytics: intents are visible
only to the person, and never affect admissions, Discover eligibility, ranking
or Tembo.

## Service (`service.ts`)

Callers own authentication, the browser-session rule and the flag check. Writes
return nothing; routes reply with `getOnboardingState`.

- `getOnboardingState(db, userId)`: two reads. `inferred` is filled only while
  nothing is saved: MENTOR and INSTITUTION from the roles held, MEMBER from an
  application or a student profile. Never from a cohort assignment
  (`programRole` holds only instructors, TAs and cohort mentors, who must not get
  the student framing) or a community profile or journey, which mentors keep
  too. `requests` holds the latest request per role; a request left pending
  beside a held role is hidden, because role state wins. `unseenApprovals(state)`
  lists held, approved and unseen roles.
- `startOnboarding`: the NEW row (see the sign-up hook below).
- `saveIntents`: replaces the set and completes onboarding. An empty choice is
  stored as `EXPLORING`, so "nothing saved" always means "never chose".
- `dismissPrompt`: the card's "Not now"; inference keeps applying.
- `createAccessRequest`: records the request and its intent (replacing
  `EXPLORING`). When nothing is saved yet, the inferred intents are saved first,
  so an alumna who asks to mentor keeps her member framing while she waits. Refused with `conflict` when the role is held or a request is
  already pending, and with `rate_limited` (with `retryAfterMs`) after
  `ACCESS_REQUEST_DAILY_LIMIT` (5) creations in 24 hours. The insert re-checks
  both conditions itself, so concurrent calls cannot pass them. If neither reason
  still holds when it looks (a role removed in between), it answers `conflict`
  so the caller simply retries.
- `withdrawAccessRequest`: owner-only, from `PENDING` only; removes the intent in
  the same batch, keyed on its own `withdrawalId`, so a replay never removes an
  intent added again since. A completed onboarding left with no intents reads as
  `EXPLORING`. Someone else's request is `not_found`, exactly like a missing one.
- `markAccessRequestSeen`: by id when the card is dismissed (idempotent), or by
  role when the person visits the space it opened.

Nothing in `service.ts` writes `UserRoles`; `decisions.ts` does.

## Decisions (`decisions.ts`)

- `grantCommunityRole` / `revokeCommunityRole`: the only writers of the global
  `MENTOR` and `INSTITUTION` roles, shared by `setAccess`
  (`/api/community/access`), the decision endpoint and the admin user page. A
  grant also approves any request pending for that role in the same batch, so a
  request never sits pending beside the role it asks for. A revoke leaves the
  request history alone: role state wins.
- `decideAccessRequest`: one batch keyed on a fresh `decisionId`. D1 runs every
  statement of a batch, so only the first one tests the state
  (`WHERE status = 'PENDING'`); the role insert and the requester's attention
  item select from the request `WHERE decisionId = ?`, and find nothing if the
  request was withdrawn, declined or approved first. That case answers
  `conflict` (409). Approving never happens without the role row.
- `listAccessRequests`: Pending (oldest first, on the queue index) or Decided
  (latest decision first; a small table, sorted per page), keyset cursors bound
  to their list, plus the open-request count for the Admin sidebar. Each item
  carries the requester, the GitHub login from their student profile, who
  decided, and up to 20 earlier requests.

`decidedBy` is for the queue and audit only. The requester's state never
selects it, and their attention item has no actor.

## Attention

- `access_request` (category `requests`, space `admin`): one item per
  administrator other than the requester, written after the request commits.
  Administrators see it only while the request is pending, so a decision or a
  withdrawal clears every bell without a write.
- `access_decided` (category `updates`, space `community`): written inside the
  deciding batch, with `actorId` NULL; only the requester sees it.
- Both follow the recipient's `spaces` audience, like every producer, and copy
  no request text. The admin home's "Access requests" Attention group lists the
  pending queue (`src/lib/admin/attention.ts`).

## APIs (`http.ts`)

Same-origin, JSON, browser sessions only: personal access tokens and agent
sessions get 403 on every route below, even with `admin:read`/`admin:write`,
because request notes are for human administrators and no agent grants roles.

| Route | Gate | Answers |
|---|---|---|
| `GET`/`PUT /api/platform/onboarding` | `onboarding` (404 when off) | `OnboardingState` |
| `POST /api/platform/access-requests` | `onboarding` | 201 `OnboardingState`; 409 pending or held; 429 with `retryAfterMs` and `Retry-After` |
| `POST /api/platform/access-requests/:id/withdraw` | `onboarding` | `OnboardingState`; 404 not yours; 409 not pending |
| `POST /api/platform/access-requests/:id/dismiss` | `onboarding` | `OnboardingState`; 409 not decided |
| `GET /api/admin/access-requests?status=PENDING\|DECIDED&cursor=` | ADMIN, not flag-gated | `AdminAccessRequestList` |
| `POST /api/admin/access-requests/:id/decision` | ADMIN, not flag-gated | `AdminAccessRequest`; 404; 409 already decided or withdrawn |

The admin routes stay reachable while onboarding is off, so pending requests are
never stranded. Middleware answers non-admins on them with the platform 403
envelope rather than a redirect. Staging personas reach none of these routes:
their path allowlists do not list them.

## Sign-up hook (`signup.ts`)

`createAuth` registers a Better Auth `user.create` after-hook (the approved
B-O.2 exception in `src/lib/auth.ts`). It writes the NEW row when onboarding is
effective for a non-staff account: audience `ALL` with `spaces`, or the
non-production `PLATFORM_FLAGS_OVERRIDE=all`. It **fails open**: any error is
recorded as a warning and sign-up continues; without a row the person later gets
the one-time card instead of the welcome step.

## Routing

`src/lib/platform/server/onboarding-routing.ts` (B-O.4, documented in
`space-routes.README.md`) reads `getOnboardingState` for `GET /dashboard`
only while onboarding is effective: NEW accounts go to `/dashboard/welcome`,
and the default space prefers an unseen approval, then the cookie, then the
saved or inferred intents. Opening the space an approval unlocked calls
`markAccessRequestSeen` by role.

## Invariant

`capabilitiesFor` never reads these tables. `capabilities.test.ts` runs every
role case against every valid intent set, plus pending and approved requests,
and requires identical output and the same three queries.
