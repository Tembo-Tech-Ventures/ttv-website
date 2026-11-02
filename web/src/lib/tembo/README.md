# Tembo in channels

Tembo answers questions inside channels (B-3.1). Shipped dark behind the
`tembo_channels` flag; every route also needs `channels`. Plan: SAM idea
01M68GQAP1DCSVMRJMZS771ZRB, §3 "Tembo in channels". Wire contracts:
`TemboAsk`, `TemboResponse`, `TemboFeedback`, `TemboUsage` and `Citation` in
`src/lib/platform/contracts.ts`. Migration `0035_tembo.sql`.

## Routes

`src/lib/channels/http.ts` serves both, with every rule of the channel APIs
(`src/lib/channels/README.md`, "APIs"): 404 `flag_off` while `channels` or
`tembo_channels` is off for the caller, before any channel data is read; 404
for a channel or message the caller cannot read; same origin for browser
writes; a `channels:write` personal access token acts as its (admin) owner and
a `channels:read` one is 403; agent sessions act as their person. Restricted
staging identities cannot reach either (they never post).

| Route | Does |
|---|---|
| `POST /api/channels/:id/tembo` `{ messageId }` | Ask about one of your own messages in this channel. 202 `pending` (the answer follows after the response), then 200 `answer` with the posted message once it exists |
| `POST /api/messages/:id/tembo-feedback` `{ feedback }` | "helpful" or "not_quite" on a Tembo answer you can see; one per person and answer, the latest kept |

A post that mentions `@tembo` (`mention.ts`: the word on its own, not
`name@tembo.org`, `@tembotech` or `@tembo.co`) asks exactly as the route
does, after the response, when `tembo_channels` is on for the poster. Out of
questions, a mention is not answered; asking through the route says why (429).
Editing a mention into a message does not ask.

Refusals: someone else's message, a channel you can only read (announcements)
or an archived one is 403; a deleted or hidden message, or a reply under a
deleted or hidden root, is 409; no questions left is 429 `quota_exhausted`
with `retryAfterMs` (and `Retry-After`) until the allowance resets.

## Asking (`ask.ts`)

One `tembo_ask` row per asking message makes a question idempotent: a mention
and the Ask button, a retry or two concurrent requests answer once. One batch
decides everything, so two requests can't both run a question and two
questions can't both take the last place in the allowance:

1. **reclaim**: a PENDING ask whose run has been quiet for two minutes (a
   Worker that died) is claimed again, not counted again;
2. **accept**: a new ask, or one whose run failed, is written PENDING under a
   fresh `claim`, while the asker has questions left and the message and its
   thread are open;
3. **count**: only an accepted ask counts;
4. read back what happened.

Only the run holding the current claim can post the answer. A run that fails
(the model, a timeout, the database) turns the ask FAILED and gives the
question back (`failAsk`), logged as a warning without the question, sources
or model text; asking again runs and counts it again. So does a question closed
(deleted or hidden) before the run read it. A question closed while the model
was answering posts nothing and **keeps its count**: otherwise deleting a
question mid-run would buy another, beyond the allowance.

A mention's run and the post's Clef check run side by side after the response.
If Clef hides the question after Tembo answered, the answer stays: Clef hides
only near-certain abuse, and moderators can hide the answer too.

## Quota (`quota.ts`, `config.ts`)

`TEMBO_CONFIG.dailyLimit` (10, the owner's decision of 2026-10-31, kept in
`src/lib/platform/server/me-config.ts`) accepted questions per person per day.
**The day is the calendar day in Africa/Nairobi** (East Africa Time, UTC+3 all
year, no daylight saving), where most members are: the allowance resets at
21:00 UTC. `tembo_usage` holds one row per person and Nairobi date
(`YYYY-MM-DD`). Asking again about an accepted question never counts. Saying
"I don't know" counts; a failed run does not. Closing a question while Tembo answers it does not give it back (above).
`/me` reports `temboUsage`
(`used`, `limit`, `resetsAt`), read only while `tembo_channels` is on.

## What Tembo sees (`sources.ts`)

The **channel alone** decides, never the asker: the answer is posted where
every reader of the channel sees it, so an admin asking in a cohort channel
reaches no more than its members.

| Channel | Tools | Sources |
|---|---|---|
| COHORT | `search_sessions`, `search_channel` | That program's complete session transcripts (its newest 60 sessions), and this channel's messages |
| COMMUNITY | `search_projects`, `search_channel` | Public builder profiles (the /talent rule: published, after a completed cohort) and their highlights; projects their owners shared in this channel, as shared there and while still shared; this channel's messages. Never recordings |
| DIRECT | `search_channel` | This conversation only, and only when someone in it asks |

Messages are read as a reader without privileges reads them: a person's (never
Tembo's own), neither deleted nor hidden, not a reply under a hidden message,
and with contact details masked wherever a flag masks them
(`bodyForReader(…, false)`, `src/lib/channels/moderation/mask.ts`), so Tembo
never sees a masked span. A search hit that matched only inside a masked span is
dropped. Nothing reads staff notes, feedback, applications, moderation events
or evidence, private chats, other channels, or institution-shared projects
nobody shared here. With the question come the thread so far (its root and
latest replies) or, for a root message, the channel's latest messages.

`leakage.test.ts` is the matrix: every kind of channel × every role that may
ask there, a model that calls every tool (offered or not) with every query
that could find a canary, positive controls in each row, and the same
transcript whoever asks.

## Answering (`answer.ts`, `model.ts`)

After the response (`ctx.waitUntil`): Gemma 4
(`@cf/google/gemma-4-26b-a4b-it`) through the AI Gateway binding with
`collectLog: false` and one attempt (`src/lib/community/native-gateway.ts`), at
most three calls: tool rounds while under nine seconds, then one without tools,
the whole run within 20 seconds (work after a response gets about 30, and Clef's
check of the answer, up to 8 seconds, and the asker's notice follow it). Each call
may use only the time left; with less than two seconds left, or when a call
outlives it, the run fails and the question is given back.
At most four tool calls a round, six results a call and 30 sources an answer.
Prompts treat sources as quoted data, never instructions.

### Grounding (`grounding.ts`)

The model tags each sentence with the sources it used (`[S2]`, `[S2, S5]`). On
the server, a tag naming no source this answer was given cites nothing; a
sentence left without a valid tag is dropped; when nothing is left, or the
model answered `NO_ANSWER`, Tembo says it doesn't know, in words that name what
it can see there. Kept tags become `[1]`, `[2]`, … in order of first use, and the
matching `Citation`s are stored with the message: `message`, `sessionClip`,
`project` or `profile` (a public `/talent/<handle>` page). Answers stop at
2,000 characters, at a whole sentence.

### Posting

The answer is a TEMBO message (no author) in the asking message's thread: the
asking message's own thread, or the thread it replied in. It goes through the
same detectors as a person's post (`screenMessage`, allowlist included): a
finding stores it FLAGGED with a DETECTOR event, which opens a moderation case
and masks contact details for other readers. The write is one batch that holds
only while this run owns the claim and the thread is open: the message, its
root moved for pollers, the flag event, the ask marked ANSWERED. Then Clef
checks it like any post (it may flag or hide it; a Clef failure leaves it as it
is and logs a warning), the asker gets a `tembo_answer` attention item at the
answer, and admins hear of a flag.

## Query budget

`POST /api/channels/:id/tembo`: 10 statements with flags read from the
database (flags, capabilities 3, channel, message, the four-statement accepting
batch); asking again about an answered question reads the answer too.
`POST /api/messages/:id/tembo-feedback`: 7. The run after the response: two
reads, one per search (two for projects), a four-statement batch, then Clef
and attention as for a post; asserted in `routes.test.ts`.
