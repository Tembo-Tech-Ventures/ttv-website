# Onboarding state API (S-O.2)

Client state for role-neutral onboarding (library
`/reports/platform-onboarding-2026-11-01/SPEC.md`): the welcome step (S1), the
request step (S2), the status cards (S3), the one-time card (S4) and Account →
"How you take part" (S5). Nothing is connected to a page in this change.

Import `createOnboardingStore`, `useOnboarding`, `accessStatus`,
`selectAccessStatus`, `requestFor` and the types from
`@/lib/platform/client/onboarding`. The pure parts are importable on their own:

- `onboarding-intents.ts`: `intentSelectionReducer`, `initialSelection`, `parseIntentHint`;
- `onboarding-drafts.ts`: `onboardingDraftKey`, `clearOnboardingDrafts`, `toCreateAccessRequest`.

## Rules this state keeps

- **Intents never grant.** The selection is local until saved. Request status
  comes only from the server's `OnboardingState`: `accessStatus` reads `roles`
  and `requests`, never intents.
- **No optimistic grant.** While a write is in flight, `pending` names it and
  `accessStatus` still shows the previous truth. Pending appears only once the
  server answers 2xx.
- **EXPLORING is exclusive.** Choosing it clears the others, and choosing
  anything else clears it.
- **Drafts live in sessionStorage, never localStorage.** There is one key per
  user (`ttv-onboarding-drafts:<userId>`). A draft is cleared after a successful
  send, by `signOut()`, and by a 401. Stored drafts are bounded and validated
  when read, and anything corrupt is dropped.
- **Server truth settles uncertainty.** After a 409, a write's 404 `not_found`
  (a stale or foreign request id), a 5xx, an invalid response or a network failure, the store asks `GET /api/platform/onboarding`. If the
  server already shows the intended outcome (a lost response, another tab), the
  action counts as done. Otherwise the failure is shown next to the latest truth.
- One write runs at a time, and a create is never retried automatically.

## Usage

```tsx
const [onboarding] = useState(() => createOnboardingStore({
  enabled: onboardingFlagEffective, // false: no requests, no storage access
  initialState,                     // the server-rendered OnboardingState, for hydration
  hint: url.searchParams.get("intent"), // ?intent= preselects a card; it never submits
  draftKey: onboardingDraftKey(me.user.id),
  // mock: createOnboardingMock("mercyAkinyi").api, // DEV harness, from client/onboarding.mock
}));
const { selection, drafts, fieldErrors, pending, failure, announcement } = useOnboarding(onboarding);
const mentor = useOnboarding(onboarding, selectAccessStatus("MENTOR"));

// S1
onboarding.select({ type: "toggle", intent: "MENTOR" });
onboarding.select({ type: "explore" });         // "I'm just looking around"
await onboarding.saveIntents();                 // false + selection.empty when nothing is chosen
// S2
onboarding.updateDraft("INSTITUTION", { organisation: "Mto Labs", scopeAcknowledged: true });
await onboarding.submitRequest("INSTITUTION");  // validates locally first; fieldErrors.INSTITUTION on failure
// S3, S4, S5
await onboarding.dismissRequest("MENTOR");      // the Approved or Declined card's Dismiss
await onboarding.dismissPrompt();               // S4 "Not now"
await onboarding.withdrawRequest("MENTOR");     // the server also removes the MENTOR intent
await onboarding.retry();                       // re-runs the failed action against current state
// Sign out (call before authClient.signOut). Without a store, use clearOnboardingDrafts().
onboarding.signOut();
```

`useOnboarding(store, selector?, isEqual?)` subscribes with
`useSyncExternalStore` and reference-counts the store's lifecycle. The first
mounted component hydrates drafts and loads state when the page supplied none.
The last one to unmount aborts work in flight.

### State

| Field | Meaning |
|---|---|
| `server` | Last `OnboardingState` from a 2xx, or `null` before it loads |
| `selection` | `{intents, empty, dirty}`. `empty` drives "Choose at least one, or pick 'I'm just looking around'." |
| `drafts`, `fieldErrors` | Request text per role, and per-field contract errors from a local check |
| `draftsPersisted` | False when the browser refused storage. Typing still works for this page |
| `loading`, `loadError` | The GET |
| `pending` | The write in flight (`save`, `dismissPrompt`, `submit`, `withdraw`, `dismiss`) |
| `failure` | `{action, kind, error, retryAfterMs}`, where `kind` is `conflict`, `rate_limited` (with the server's cooldown), `offline`, `invalid` or `failed` |
| `closed` | `signed_out` after a 401 or `signOut()`, or `unavailable` after a 403, a 404 `flag_off`, or any 404 on the read. No further requests are made |
| `announcement` | Short text for a polite `aria-live` region. Render it as text |

`accessStatus(state, role)` returns:
- `NOT_REQUESTED`: no request, withdrawn, or an approval whose role was since removed;
- `PENDING` or `DECLINED`;
- `APPROVED`: the role is held and the approval is unseen (the card);
- `ACTIVE`: the role is held.

A held role always wins over request state.

## Mock mode

`createOnboardingMock(persona?, mockOptions?)` (from `onboarding.mock.ts`)
returns `{api, state(), decide(role, "approve" | "decline", message?)}`. It
starts from `onboardingByPersona` and follows SPEC §5:
- EXPLORING stands alone;
- one PENDING request per role, with 409 otherwise;
- five creations a day, with 429 and `retryAfterMs` after that;
- a request records its intent (replacing EXPLORING), and a withdraw removes it,
  leaving EXPLORING when that empties a completed onboarding;
- only decided requests can be dismissed, with 409 otherwise;
- an unknown id is 404 `not_found`.

These mirror B-O.2's `src/lib/onboarding/service.ts` (#260), which is the
authority. `decide` plays the administrator, so a harness can show
the Approved and Declined cards. `mockOptions` passes latency and failure
injection through to `createMockTransport`. Keep the mock out of production
imports: the production entry imports no fixtures or mock transport, and
`onboarding.import.test.ts` checks that.

## Verification

From `web/`:

```sh
npx vitest run src/lib/platform/client/onboarding* src/lib/platform/client/hooks/onboarding.test.tsx
```
