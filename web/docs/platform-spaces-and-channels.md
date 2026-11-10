# Platform spaces, channels, Tembo and mentor connections

This is an overview and runbook for the platform features built in the 2026-10-31
mission: spaces, attention, search, channels and moderation, Tembo in channels,
mentor connections and onboarding. It covers how the parts fit together, who
may do what, how moderation works day to day, and which flag turns on which
part. The module READMEs linked below hold the detail and are kept beside the
code. Read them before changing a module.

- **Design:** SAM Library `/reports/platform-ux-2026-10-30/` (`PLAN.md`, the
  prototype screens in `screens/` and the production baseline in `before/`).
  Onboarding has its own design in `/reports/platform-onboarding-2026-11-01/`
  (`SPEC.md`, `screens/`).
- **Implementation plan:** SAM idea 01M68GQAP1DCSVMRJMZS771ZRB.
- **Wire contracts:** `src/lib/platform/contracts.ts`, with Zod 4 schemas for
  every request and response (`src/lib/platform/README.md`).

Everything here shipped dark and is switched on per audience. While a flag is
off for someone, its pages and APIs return 404 for them, and the old dashboard
works as before.

## Feature flags

The flags live in the `feature_flag` table (migrations `0021` and `0025`, every
row seeded `OFF`). Each one has an audience: `OFF`, `STAFF` (admins only) or `ALL`. An
admin sets the audience at `/admin/platform-flags`, which works without
JavaScript, asks to confirm before `ALL`, and warns about dependencies without
blocking. Moving a flag to `ALL` needs Raph's explicit approval. Preview and
staging deploys set `PLATFORM_FLAGS_OVERRIDE=all` (`scripts/cloudflare/lib.mjs`),
which turns every flag on for every signed-in person; production ignores it.
Flags are read once per request (`src/lib/platform/server/flags.ts`), so a
change takes effect on the next request.

| Flag | Turns on | Depends on |
|---|---|---|
| `spaces` | The spaces shell (`SpacesLayout`): the space tabs, the attention bell and panel, search (⌘K / Ctrl K), `/api/platform/me`, `/api/attention*`, `/api/search`, and the canonical `/dashboard/{cohort,community,mentoring,discover,me,account}` routes, with 301s from the old URLs | none |
| `onboarding` | `/dashboard/welcome` ("How will you take part?"), the landing choice for new accounts, `/api/platform/onboarding` and `/api/platform/access-requests` | `spaces` (enforced in `flags.ts`) |
| `channels` | Channel and conversation pages, the code of conduct, the channel and message APIs, moderation (`/admin/moderation`, `/api/moderation/*`, the MCP moderation tools) and channel messages in search | The APIs need only `channels`. The pages are spaces pages, so they also need `spaces` |
| `tembo_channels` | Tembo in channels: `@tembo` mentions, "Ask Tembo here", `/api/channels/:id/tembo`, `/api/messages/:id/tembo-feedback` and the daily allowance in `/me` | `channels`. Every Tembo route checks both flags, and `/me` reports `tembo_channels` off while `channels` is off |
| `mentor_requests` | The mentor directory, asking for time, the Mentoring space's Requests and Availability pages, "Worth another look", request-note checks and the "Request notes" tab | `channels` (enforced in `flags.ts`), because accepting a request opens a direct conversation |

Not flag-gated on purpose: `/admin/access-requests` and `/api/admin/access-requests`,
so pending access requests are never stranded when `onboarding` is off.

Before `mentor_requests` reaches people beyond staff, the owner decides whether
to raise `CONDUCT_VERSION` (`src/lib/channels/conduct.ts`). The code of conduct
gained a line about private conversations, and raising the version asks
everyone to agree again.

The old dashboard sidebar stays in the code until `spaces` is at `ALL`.

## Domain model

| Concept | Tables | Module |
|---|---|---|
| Rollout flags | `feature_flag` | `src/lib/platform/server/flags.ts` |
| Spaces | none (derived by `capabilitiesFor`) | `src/lib/platform/server/` (`space-routes.README.md`) |
| Attention: things that need a person | `attention_item` | `src/lib/attention/README.md` |
| Search | `channel_message_search`, `channel_message_fts` (FTS5) and existing sources | `src/lib/search/README.md` |
| Channels and messages | `channel`, `channel_member`, `channel_message`, `channel_read`, `message_reaction`, `channel_action`, `channel_conduct` | `src/lib/channels/README.md` |
| Moderation | `message_report`, `moderation_event`, `moderation_case`, `channel_message_version`, `moderation_allowlist` | `src/lib/channels/README.md`, "Moderation" |
| Tembo in channels | `tembo_ask`, `tembo_usage`, `tembo_feedback` | `src/lib/tembo/README.md` |
| Mentor connections | `mentor_profile`, `mentor_request`, `mentor_request_case`, `mentor_request_report` | `src/lib/mentoring/README.md` |
| Onboarding | `member_intent`, `member_onboarding`, `access_request` | `src/lib/onboarding/README.md` |

Timestamps in these tables are epoch milliseconds written by the domain code,
unlike the older tables' `unixepoch()` seconds.

### Spaces

A space is one top-level context of the dashboard, in a fixed order: `cohort`,
`community`, `mentoring`, `discover`, `admin`, `profile`. The space switcher
shows only the spaces `capabilitiesFor` gives the caller (below). `/dashboard`
sends people to the last space they used (a `ttv-last-space` cookie), or to
the first space they have. A path never grants access: the space router checks
it, and each page and API still makes its own checks.

Each space has a home: `/dashboard/cohort`, `/dashboard/community`,
`/dashboard/mentoring`, `/dashboard/discover`, `/admin` and, for `profile`,
`/dashboard/me`. The Profile space's home is its Overview: the profile as
everyone signed in sees it (with their member page and, for a graduate who
listed it, their public page), the work they've posted with where each mentor
confirmation stands, what needs the person (unopened visitor messages, newer
revisions nobody has confirmed, drafts), the client projects open to them and
their certificates. The one profile editor, for everyone, is
`/dashboard/me/portfolio` ("Edit profile"): the profile, posting work (a link,
or GitHub repositories), and, for graduates, listing on the public website and
coming off it. Community's home links there; it edits nothing itself, and an
old tab's post or link to it lands in the editor. The Overview only reads;
every row links to the page that does the work.

What the editor and the Overview say is what the directory and the public
website show: "listed" is `publicProfileEligibility`, never the status alone.
A held profile is told it waits for a check (and is offered no listing until a
person has looked); mentors and staff are told they aren't listed anywhere;
someone who took themselves off (a draft with `publishedAt`) is never asked to
list again, and Writing and Opportunities tell them why they're closed. Coming
off twice answers the same as once. A held save of the profile or of work is a
save, said as a warning. The handle stays put after the first save ("Change
handle" is a deliberate step that warns old links stop working) and never
changes once the profile has been listed, since it is part of post links.

Every admin page (`/admin/*`) renders in the Admin space while `spaces` is on
for the admin, with the admin navigation as the space's sidebar and the page
title as its h1. Without a spaces context (the flag off for them, a personal
access token, or a context that failed to load) `AdminLayout` draws the
existing admin shell instead. The middleware's ADMIN guard runs first either
way.

### Attention

An `attention_item` is one thing that needs one person, in one space. Its
category (mentions, requests, updates) drives the panel's filters. Producers
write items after the primary action commits, once per event (`eventKey` is
unique per person), best effort: a failed notice never fails the action.
An item never copies message text, notes or replies. On every read, an item
shows only while it still applies (the message is still visible, the request
still waits, the case is still open), so stale notices disappear without
cleanup.

| Kind | Who gets it | When |
|---|---|---|
| `application_status` | The applicant | An admin changes their application's status |
| `recording_ready` | The cohort's members, instructors, TAs and mentors | A session recording in their cohort finishes processing |
| `work_confirmed` | The builder | A mentor confirms their shared work |
| `visitor_message` | The profile owner | Someone writes through their public profile |
| `mention` | Each person named as `@Full Name` who can read the channel | A message mentions them |
| `tembo_answer` | The person who asked | Tembo answers their question |
| `message_hidden` | The author | Their message is hidden (never naming who hid it) |
| `moderation_decided` | The author | An admin decides a case the author knew of |
| `moderation_pending` | Admins, except the author, the request's parties, and a direct conversation's members | A moderation case or a request-note check opens, or an author asks for review |
| `mentor_request`, `mentor_withdrawn` | The mentor | A request arrives (or is released by a check), or is withdrawn |
| `mentor_accepted`, `mentor_redirected`, `mentor_declined` | The person asking | The mentor answers |
| `mentor_checked` | The person asking | A check holds, sends or closes their request |
| `access_request` | Admins, except the requester | Someone asks for mentor or institution access |
| `access_decided` | The requester | An admin decides their access request (never naming the admin) |

`reply` and `opportunity_match` are contract kinds that nothing produces yet.
Replies reach people through mentions and thread summaries. An opportunity
match needs a real recipient, which no current flow has. Shared work waiting
for a mentor's confirmation is a count on the Mentoring space, not attention
(`src/lib/mentoring/README.md`).

Attention follows the recipient's flags: a channel notice needs `spaces` and
`channels`, and a mentor-request notice also needs `mentor_requests`. When a
flag is `STAFF`, only admins receive the notices it covers. There is no
backfill when a flag widens.

### Channels

A channel is `COHORT` (exactly one program), `COMMUNITY` or `DIRECT` (a
private conversation between two people). Messages have one level of threads.
Each message has a per-channel `seq` (its place) and `changeSeq` (its latest
change), so clients page by `seq` and poll by `changeSeq`. Polling picks up
edits, deletions, reactions and moderation as well as new messages. There are
no websockets: an open channel polls every 5 seconds while the tab is visible,
backs off when idle and pauses when the tab is hidden.

- **Seeded channels.** Community: `introductions`, `show-your-work`, `help`,
  `opportunities`, `design-crit`. Each program gets `cohort-NN`, `cNN-help` and
  `cNN-announcements` (STAFF posting), created by a database trigger whenever
  a program is inserted, whichever path inserts it. Never use
  `INSERT OR REPLACE INTO program`: the delete cascades to the program's
  channels and every message in them.
- **Direct conversations** are opened only when a mentor accepts a request,
  with the two people as the only members. Each member sees it named for the
  other person.
- **Code of conduct** (`/dashboard/community/conduct`, "How we talk to each
  other"): posting and editing need a current agreement (403
  `conduct_required`). Reading, reacting and deleting your own message do not.
- **Rate limits:** 10 posts per person per channel per minute and 300 per
  rolling day; 10 edits per channel per minute; 30 reaction changes per
  minute (429 with `retryAfterMs`).
- **Embeds:** up to five per post. A project can be shared only by its owner,
  only while it is published, and only at its current revision. A session clip
  (at most 10 minutes) can be shared only in a cohort channel of that cohort
  where the poster may post. Every embed is checked again on every read and
  shows as unavailable once it no longer passes. Link previews are off.
- **Search** indexes message bodies (never embeds) of messages nobody deleted
  or hid, and returns only channels the caller can read, with contact details
  masked as the reader would see them.

## Access rules

### `capabilitiesFor`: one function for every surface

`capabilitiesFor(db, user)` (`src/lib/platform/server/capabilities.ts`) reads
the person's global roles, applications and program assignments from the
database on each request, with no cache across requests, so a revoked role
takes effect on the next request. It returns the spaces plus `cohortIds`,
`mentorCohortIds`, `isMentor`, `isInstitution` and `isAdmin` (and the
server-only `teachingCohortIds`). Pages, the REST APIs, search, MCP and Tembo
all derive access from it, read once per request through
`requestCapabilities(db, Astro.locals)`.

| Space | Who has it |
|---|---|
| Cohort | Applicants (any status), cohort members (APPROVED, AUDIT, COMPLETED), the program's INSTRUCTOR, TA and MENTOR assignments, and admins. An applicant has the space but no cohort content |
| Community | Every signed-in person, institutions included |
| Mentoring | The global MENTOR role |
| Discover | The INSTITUTION role, and admins |
| Admin | The ADMIN role |
| Profile | Every signed-in person |

`cohortIds` lists the cohorts whose content the person can read: their
APPROVED, AUDIT and COMPLETED applications (so alumni keep access) and their
assignments. Admin authority is the separate `isAdmin`. It never adds cohorts
to `cohortIds`. Onboarding intents never reach `capabilitiesFor`: choosing
"mentor" on the welcome step grants nothing until an admin approves the
access request.

### `channelAccessFor`: who reads, posts and moderates

`channelAccessFor(capabilities, channel, { isMember })`, beside
`capabilitiesFor`, is the only channel rule set. `CHANNEL_ACCESS_MATRIX` in
`capabilities.fixtures.ts` is the parameterised role matrix the tests run
across every surface.

| Channel | Reads and posts | Moderates (hides) |
|---|---|---|
| COMMUNITY | Every signed-in person, institutions included | Admins and global mentors |
| COHORT | That program's members (alumni included, after the cohort ends), its instructors, TAs and invited mentors, and admins | Its instructors, TAs and mentors, and admins |
| DIRECT | Its two members only | Nobody in place (see "Direct conversations" below) |

- **DIRECT is members-only, with no exceptions.** An admin, or any mentor,
  who is not one of the two members cannot open the conversation, its
  threads or its messages (404). Only a single reported or flagged message
  reaches the admin queue.
- **STAFF posting** (the announcements channels): only admins, and the
  cohort's instructors and TAs, post. Everyone who can read the channel reads
  and reacts.
- **Archived** channels stay readable and take no new posts.
- A global MENTOR role moderates community channels only. A mentor joins a
  cohort's channels through a per-program MENTOR assignment, made by an admin
  on the program page.
- **The same 404 for every refusal to read.** A missing channel, another
  cohort's channel and someone else's conversation give the same response,
  so no slug or id confirms that a channel exists.

### Tokens and agents

- A personal access token with `channels:read` or `channels:write` acts as its
  owner, who must be an admin, on the channel APIs only. It sees exactly what
  the owner's browser session sees.
- The moderation routes (`/api/moderation/*`) refuse every token. Admin
  tokens triage through `/api/mcp` instead (`list_moderation_queue` with
  `admin:read`, `moderate_message` with `admin:write`).
- Mentor requests, the mentor directory, availability, onboarding and access
  requests refuse every personal access token, because no token scope covers
  asking a person for their time or deciding someone's access.
- Delegated agent sessions act as their person, under the same rules.
- Browser writes must come from the same origin.

## Moderation runbook

Owner decisions behind this: contact details are flagged, never hidden by a
machine (2026-10-31, decision 2); flagged contact details are masked for other
readers until a person decides (policy 05e89fac, 2026-11-02); Clef may hold
an item for a human, and fails open (2026-10-06).

### What happens to a message

1. **Detectors, before the write** (`src/lib/channels/moderation/detectors.ts`,
   pure and synchronous). They find:
   - phone numbers in Kenyan and international spellings (spaced, dotted,
     bracketed, spelled out in English or Swahili);
   - email addresses, including `name [at] domain [dot] org`;
   - WhatsApp and Telegram links;
   - link shorteners;
   - five or more distinct mentions;
   - the same text posted in three channels within an hour.

   A finding stores the message as FLAGGED with a plain-language reason, in
   the same batch as the write. The message stays visible. Findings on the
   allowlist are dropped.
2. **Masking** (`moderation/mask.ts`, `bodyForReader`). In a FLAGGED message
   whose reasons include a phone number, an email address or a chat
   invitation, only the detected spans are replaced with a marker. The rest of
   the message stays readable. The author, the channel's moderators and admins
   see the full text. Masking applies on every read path: channel pages, every
   polling and thread read, search excerpts, token and MCP reads, and Tembo's
   inputs. Institution users get no exception. The spans are recomputed on
   each read, so an edit that removes the number unmasks the rest at once. A
   message that only Clef flagged has no spans and shows in full until a
   person decides.
3. **Clef, after the response** (`moderation/clef.ts`). Clef flash
   (`@cf/cloudflare/clef-flash`) runs through the AI Gateway with
   `collectLog: false` once a post or a text-changing edit commits. It
   answers three questions: contact details, unrelated promotion, abuse.
   Above a question's threshold it adds a flag. Near-certain abuse (0.9 or
   above) hides the message, with no moderator named. Contact details and
   promotion never hide. **Clef fails open:** a missing binding, a model
   error, an 8-second timeout or an unreadable answer leaves the message as it
   is and logs a warning without the message text.
4. **People.** Members report, channel moderators hide, admins decide (below).

Each flag, hide or report opens a `moderation_case` for that message, or adds
to the open case. Database triggers keep the case and the evidence, so no
write path can skip them. Evidence is the text as it was when it was flagged,
hidden, reported, edited or deleted, kept in `channel_message_version` for
admins only.

### Actions and who takes them

| Action | Who | Effect |
|---|---|---|
| Report | Any reader of the message, except its author | Once per person and message, at most 20 a day. Opens or joins the case. The author sees no change |
| Hide | The channel's moderators and admins, with a reason the author sees | HIDDEN. Other readers no longer see the message. The author is told (never who hid it) and may ask for a review |
| Undo a hide | The moderator who hid it, while no admin has decided | The message goes back to the state the hide found. The case keeps its other signals, or closes if none are left |
| Ask for review | The author of a hidden message, once per case | The case shows the request, and admins are told again |
| Hide, uphold a hide | Admins | Closes the case as decided. The hide is final: no review, no undo |
| Restore | Admins, for a hidden message | VISIBLE, reasons cleared, and the text and its findings are allowlisted |
| Keep ("fine as is") | Admins, for a message that is not hidden | VISIBLE and unmasked, reasons cleared, allowlisted. On a deleted message, keep closes the case and changes nothing else |

**Admin decisions are final.** After an admin hides or upholds a hide, the
author cannot ask for a review and the moderator cannot undo it. After an
admin restores or keeps a message, a moderator cannot hide it again until its
author edits it. These rules read the admin's own events, so a later report
that reopens the case cannot undo a decision. A new signal after a decision
opens the case again, and it keeps its place in the queue with "reopened".

### Working the queue

- **Where:** `/admin/moderation` (works without JavaScript). The default view
  lists open cases, newest first by when each case opened; `?state=DECIDED`
  lists decided cases. Each case shows the message as an
  admin sees it, the channel, the merged reasons, the report count, the
  moderator who hid it, the evidence (oldest first), the author's review
  request and any decision. The tab and the Admin sidebar badge count the
  cases you may decide.
- **From an agent:** `/api/mcp` with an admin token, through
  `list_moderation_queue` and `moderate_message`. These refuse exactly what the
  page refuses.
- **Before deciding:**
  1. Read the evidence as well as the current text: the author may have
     edited the message after it was flagged.
  2. Read the author's review request, if there is one, before upholding a
     hide.
  3. Remember what each decision does to the text. **Keep** lifts the masking
     and allowlists the text and its findings, so the same details are not
     flagged again. **Hide** shows your reason to the author. **Restore**
     brings a hidden message back for every reader and allowlists it too.
- `moderation_pending` notices go to every admin except the author and, for a
  direct conversation, its members. The
  author hears the outcome of a case they knew of in neutral words, never
  naming the admin ("An admin reviewed your message in #help and restored
  it.").

### Direct conversations

A direct conversation has no moderators. Either member can report the other's
messages, and detectors and Clef run there as everywhere. Only that message
reaches the queue, with its evidence, under the name "Direct conversation":
admins see no other message, thread, reaction or name from the conversation,
and still cannot open it (404). Admins outside the conversation decide the
message as any other. An admin who is one of the two members never sees its
cases and cannot decide them (403). Each member sees the other's flagged
contact details masked until an admin decides. A reported Tembo answer can quote or sum up the conversation it
answered, and admins see that text.

### Request-note checks

A mentor request's note is screened like a post: detectors mask contact
details for the mentor, and Clef reads it after the response. Near-certain
abuse **holds** the request: the mentor doesn't see it, it holds no spot of
their capacity, and the person asking sees "Waiting for a check before it's
sent", never "declined". A mentor may also report a waiting request: it then
closes for them (they cannot accept it), and the person asking sees "TTV is
checking this request". The check never names who opened it. Clef failing
leaves the request with the mentor (fail open).

Admins decide these in the **Request notes** tab
(`/admin/moderation?tab=request-notes`, flag `mentor_requests`), a separate
queue from channel cases:

- **Keep** releases the request to the mentor as it was. It takes a spot again,
  even past their monthly capacity, and the tab shows that capacity so the
  admin can see the cost.
- **Remove** closes the request, with a reason. The person asking sees "This
  request wasn't sent" (the mentor never saw it) or "This request was closed",
  and may ask again.

An admin who is one of the request's two parties cannot decide its check.

## Tembo rules

Tembo is the AI assistant, named the same everywhere. In channels
(`tembo_channels`):

- **The channel decides what Tembo reads, never the asker.** An answer is
  posted where every reader of the channel sees it, so an admin asking in a
  cohort channel reaches no more than its members do.

  | Channel | Tembo reads |
  |---|---|
  | COHORT | That program's session transcripts and this channel's messages |
  | COMMUNITY | Saved member profiles and their posted work, projects their owners shared in this channel, and this channel's messages. Never recordings |
  | DIRECT | This conversation only, and only when one of its members asks |

- **Unprivileged reads.** Tembo reads messages as a reader without moderator
  rights (`bodyForReader(…, false)`): no deleted or hidden messages, nothing
  under a hidden root, and contact details masked. It never reads staff
  notes, feedback, applications, moderation evidence, private chats or other
  channels. Questions to Tembo, and its own answers, are never sources.
  `src/lib/tembo/leakage.test.ts` proves this across every kind of channel
  and every role.
- **Citations.** Every sentence must cite a source it was given. The server
  drops sentences without a valid citation. If nothing is left, Tembo says it
  doesn't know and names what it can see there. A citation of a message that
  has since been deleted, hidden, flagged or edited reads "A message since
  edited or removed" for every reader.
- **Answers** go into the asking message's thread as a Tembo message (no
  author, an AI badge). They are screened like a person's post: detectors,
  masking, then Clef. Readers can mark an answer "helpful" or "not quite".
- **Allowance:** 10 accepted questions per person per day, where the day is
  the calendar day in **Africa/Nairobi** (UTC+3, no daylight saving), so it
  resets at 21:00 UTC. A question counts once, however it was asked (mention,
  button, retry). "I don't know" counts. A failed run does not. Out of
  questions, the route answers 429 `quota_exhausted` and a mention is not
  answered.
- **Model:** Gemma 4 through the AI Gateway with `collectLog: false`, after the
  response, within a fixed time budget.

The private Ask Tembo page (`/dashboard/cohort/ask`, `/api/chat`) is the same
assistant with a different scope: the sessions of the person's own cohorts
(every cohort's for staff). It has no daily count, its conversations are kept
with the account, and its requests go through the AI Gateway without the
`collectLog: false` that channel calls set, so the gateway's own log setting
applies.
The page says all of this to the person.

## Mentor connections

`mentor_requests` lets people ask a mentor they are not yet connected with for
time, with their work attached.

- **Personal requests** (policy 9c47fa47, 2026-11-02): any signed-in person may
  ask, as themselves: a cohort member, an alumna or alumnus, or a signed-in
  member of the public. Belonging to an institution neither grants nor blocks
  it, and no account asks on an institution's behalf. The code of conduct,
  capacity, limits and checks apply to everyone.
- **Listed mentors** hold the MENTOR role, have saved availability with a
  capacity above zero, and are not paused. Mentors edit their own headline,
  areas, formats, monthly capacity (0–20) and pause at
  `/dashboard/mentoring/availability`. The directory
  (`/dashboard/community/mentors`) shows only public fields.
- **Capacity** is per Africa/Nairobi calendar month. Each waiting request and
  each request accepted this month holds a spot. Declining, redirecting and
  withdrawing free a spot at once. A full mentor's directory card and the 409
  both give the next opening.
- **Limits:** one waiting request per person and mentor, five waiting at once,
  ten a rolling day.
- **The mentor answers** at `/dashboard/mentoring/requests`: accept, suggest
  another mentor, or "not this month". Nothing counts against the person
  asking. Accepting opens (or reuses) the direct conversation between the two,
  and the note becomes its first message, with the work attached at the
  requested revision.
- **Only the two parties** see a request. Everyone else, admins included, gets
  404. Admins see a request only through a check (above).
- **Worth another look** (`/api/mentoring/another-look`) lists work a mentor
  confirmed at an earlier revision that has changed since.

## Where things are

- Pages: `src/pages/dashboard/**` inside `src/layouts/SpacesLayout.astro`;
  components in `src/components/platform/**` and `src/components/channels/**`
  (the shell, overlays, spaces, mentors and onboarding READMEs there).
- Client state: `src/lib/platform/client/**` (`src/lib/platform/client/README.md`).
- Server: `src/lib/platform/server/**`, `src/lib/{attention,channels,tembo,mentoring,search,onboarding}/**`
  and the routes in `src/pages/api/**`.
- Tests that hold the access rules: `src/lib/platform/server/capabilities.test.ts`
  (the role matrix), `src/lib/tembo/leakage.test.ts`,
  `src/lib/channels/http.test.ts` (flag, origin and token gates),
  `src/lib/channels/moderation/*.test.ts` and the `e2e/platform-*.spec.ts`
  browser specs at 390 and 1440 px with axe checks.

## Open questions for the owner

These are not decided, and nothing in the code assumes an answer:

- How long evidence of decided moderation cases is kept.
- Whether people can create their own community channels (today only
  migrations and the program trigger create channels).
- Whether to raise `CONDUCT_VERSION` before `mentor_requests` widens.
- Whether the private Ask Tembo page should opt out of AI Gateway logs, as
  channel calls do.
- Institutions as organisations with members, rather than a per-person
  INSTITUTION role (policy "Institutions are entities with members").
