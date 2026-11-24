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

## Known gap: stored copies of transcript text

The policy guards every read of `recording` and `transcript_segment`. Copies of transcript text
stored elsewhere when they were read are not re-checked on read:

- Ask Tembo's conversation history: `chat_message.citations` (each source's title and up to 240
  characters of transcript) and the answer text, returned by `lib/chat/sessions.ts`
  (`getChatMessages`) to the conversation's owner;
- Tembo's answers in channels: the answer body and its `session` citations (title and moment),
  stored on the `channel_message` (`CITATIONS_GONE` in `lib/channels/messages.ts` re-checks only
  `message` citations).

Today this is harmless: each copy was readable by its reader when it was written, and nothing yet
hides or deletes a recording. **Before any UI or API sets `hiddenAt` or `deletedAt`, these copies
must be re-checked on read through the policy** (drop or blank a citation whose recording the
reader may no longer see, as `embedAccessColumn` does for clips), with tests.

The admin recording pages (`/admin/recordings`) list every recording, deleted ones included; they
need the same decision once deletion exists.
