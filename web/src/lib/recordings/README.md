# Recordings

Session recordings: the Drive importer and admin upload (`importer.ts`, `google-drive.ts`), the
processing pipeline (`pipeline.ts`: audio, transcription, Vectorize embeddings) and the one access
policy every read goes through (`access.ts`).

## Who may watch a recording and read its transcript

`access.ts` holds one rule in two forms, which `access.test.ts` proves equal on SQLite for every
kind of viewer and every scope, cohort, deletion and hiding:

- `recordingAccessFor(viewer, recording, { userId })` for one recording (the viewer, the video,
  `get_recording_details`, posting a clip);
- `recordingScopeSql(viewer, userId, alias, { reach })`, the same rule as a SQL condition for lists
  and search (the Sessions list, platform search, Ask Tembo's `list_recordings` and its Vectorize
  re-check, suggestions, attention reads). The viewer's cohorts and id are written as quoted string
  literals, so the fragment fits Drizzle (`sql.raw`) and numbered-parameter D1 statements alike.

| `recording.accessScope` | Who |
|---|---|
| `COHORT` | People whose `capabilitiesFor` cohorts include it (APPROVED, AUDIT and COMPLETED members, instructors, TAs, invited mentors), and admins |
| `DIRECT` | The two members of its conversation (`channelId`), by `channelAccessFor`'s rule: nobody else, admins neither |
| `COMMUNITY` | Whoever can read its community channel (`channelId`): every signed-in person |
| `ADMIN_ONLY` | Admins. Every recording with no cohort, or one an insert named admins only |
| `deletedAt` set | Nobody, admins included |
| `hiddenAt` set | Of the above, only admins and the cohort's instructors and TAs |

A staging demo identity reaches only the demo cohort's recordings, whatever its roles. Every path
refuses in one way, the same 404, so nobody learns whether a recording they may not see exists.

**Sessions, or everything.** A path reads `DIRECT` and `COMMUNITY` recordings only if it asks for
`reach: "everything"`, passing the recording's channel as it read it for the person asking
(`channel: { id, kind, isMember }`; another channel, or none, admits nobody). Every path today is a
session path and reads cohort sessions only, so a conversation's or an event's recording never
reaches the Sessions pages, search, Ask Tembo or Tembo in channels; `access.matrix.render.test.ts`
proves each path refuses both to everyone, their own members and admins included. A call's
recording page asks for everything when a later slice builds it. `mayReadRecordings` is about
cohort sessions only.

What a reader gets depends on what exists: the video as soon as it is stored (`r2VideoKey`; the
viewer shows the player whenever it is), the transcript once processing is `complete`
(`transcriptReady`, `transcriptReadySql`).

**Read as a whole cohort.** A cohort channel's Tembo (`search_sessions`), clips (posting, reading
and the attach list) and the "ready to watch" notice reach every reader of the channel or every
member of the cohort, so they read recordings as `cohortAudience(programId)` — a member of that
cohort with no other role — never as the person asking. `cohortAudienceSql(alias, programExpr)`
is that rule with the cohort as a SQL expression; the test proves it equal too.

## Migrations 0042 and 0043, and their triggers

`accessScope` (`NOT NULL DEFAULT 'ADMIN_ONLY'`), `deletedAt` and `hiddenAt` were added with ADD
COLUMN only: `recording` is referenced by `transcript_segment` with foreign keys on, so it is never
rebuilt. Triggers allow only the four scopes (a table `check()` would make drizzle-kit rebuild it).

0042's cohort triggers widened: Drizzle sends the default `'ADMIN_ONLY'` explicitly, so an insert
with a cohort and an explicit `ADMIN_ONLY` was stored as `COHORT`, and moving an `ADMIN_ONLY`
recording into a cohort made it the cohort's. 0043 replaced them (0042 itself is never edited:
previews have applied it), so scopes fail closed:

- every insert names its scope (`cohortScope`) and sets `scopeChosen`, and is stored as it says;
- an insert without `scopeChosen` comes from a Worker before 0043, which still relies on the old
  rule: with a cohort, it is that cohort's (`recording_unscoped_insert`);
- a `COHORT` recording moved out of every cohort becomes `ADMIN_ONLY` (`recording_cohort_scope_leave`);
  nothing else follows a cohort change. The admin recording page gives a recording with no cohort
  the cohort the admin chooses (`detailsUpdate`). On the old Worker's page (deploy window or
  rollback) that stays admins only, with no `scopeChosen`; the next save on the current Worker puts
  it in its cohort, even with nothing changed. See `src/lib/meetings/README.md`.

0043 also added `channelId` (a DIRECT or COMMUNITY recording's channel, `SET NULL` with it, which
then admits nobody) and `meetingId` (the call it came from); see `src/lib/meetings/README.md`.

## Hiding a recording (in-app calls P9)

Cohort sessions are recorded from start to end with no pause, and reach the cohort as soon as they
are processed (UX review M9). So a cohort's hosts (its instructors and TAs) and admins can hide one
of the cohort's recordings from the cohort, and show it again, on the session viewer page
(`/dashboard/cohort/sessions/:id`): "Hide from the cohort" asks first (`?confirm=hide`, a
`ConfirmStep` that names what changes), "Show to the cohort" puts it back. Plain forms, while
`meetings` is on for the person; any other post (a member, another cohort's host, a mentor, another
site, the flag off) is the same 404 and changes nothing (`hiding.ts`: `mayHideRecording`,
`setRecordingHidden`).

Hidden sets `hiddenAt`, and the policy does the rest: on every path in the matrix
(`access.matrix.render.test.ts`) only admins and the cohort's hosts still reach it. Its hosts see it
in Sessions marked "Hidden from the cohort". The card of the session it came from says it isn't
available, and Tembo's answers that cite it are withheld (below); both change in open pages at once
(`touchRecordingCard`, `touchAnswersCiting`). Deleting is not built yet.

## Stored copies of transcript text

The policy guards every read of `recording` and `transcript_segment`. Two places keep a copy of
transcript words from when they were read, and each is checked again on every read, in the
statement that reads it, so hiding, deleting or moving a recording takes its words out of them too:

- **Ask Tembo's conversation history** (`lib/chat/stored-sources.ts`), for the conversation's owner
  as they are now (`capabilitiesFor`): `chat_message.citations` holds the citations shown (each
  source's title and up to 240 characters of transcript), then a trace entry
  `{ type: "read", recordingId }` for every recording a tool returned anything of for that answer
  (`search_transcripts`' sources, and what `list_recordings` and `get_recording_details` named,
  cited or not). A follow-up in an existing conversation also carries a trace of every recording an
  earlier answer there named, written in the same statement (`sessions.ts`), because Tembo had those
  answers as history and may restate them without a tool. An answer that drew on a recording the
  owner may no longer read, or whose transcript isn't complete, is replaced by one neutral line, and
  that recording's citations are dropped; trace entries never leave the server. `getChatMessages`
  checks each message and `listChatSessions` each preview, inside their own statements.
- **Tembo's answers in channels** (`lib/channels/messages.ts`, `sessionsGoneSql`): Tembo read a
  cohort's sessions as the whole cohort, and every reader of the channel sees its answer, so an
  answer is checked as `cohortAudienceSql` for the channel's program, with a complete transcript,
  as clips are. While any `sessionClip` citation fails, every reader (hosts and admins too) gets
  `TEMBO_SESSION_GONE` instead of the body, and that citation is dropped. Message search
  (`lib/search/messages.ts`) leaves such an answer out, so its words don't come back as an excerpt.
  Whoever hides, restores or deletes a recording calls `touchMessagesShowing` (`lib/channels/
  mutations.ts`) after the change, which moves those answers and every message sharing a clip of it,
  so open channels pick the change up on their next poll.

Known limits: an answer saved before the traces existed carries only its citations, so a transcript
it read through `get_recording_details` without citing it can't be traced; and Ask Tembo's
follow-up questions send the earlier conversation from the browser, so a tab left open since before
a recording was hidden can still send that answer's words back as context.

Attention items carry no transcript text (their summaries are fixed sentences), and their reads
check the policy (`attentionAccess`). The admin recording pages (`/admin/recordings`) list every
recording, deleted ones included; admins may watch hidden recordings, but they need a decision once
deletion exists.
