# Tembo in a channel (S-3.1)

`createTemboStore({ channel, usage: me.temboUsage, enabled: me.flags.tembo_channels })`
keeps, for one channel view, what became of each question to Tembo, today's
allowance and the reader's own "Helpful / Not quite". Wire contracts are
B-3.1's (`src/lib/tembo/README.md`): `POST /api/channels/:id/tembo`
`{ messageId }` and `POST /api/messages/:id/tembo-feedback` `{ feedback }`.

## Asking

- A post that mentions `@tembo` already asks on the server. The composer's
  `onSent` hands each confirmed send to `noticeSent`, which asks too
  (`mentionsTembo` is the server's own rule), so the view learns the outcome:
  202 `pending`, 200 `answer`, or 429 `quota_exhausted`. The server answers
  each message once and never counts a question twice, so asking again is safe.
- `asking` → `pending` → `answered`. An answer is found in the open thread (a
  TEMBO reply newer than the question) or, while the thread is closed, when its
  root's reply count moves: the store asks again and the server returns the
  answer, which joins the channel store through `receive`.
- `timeout` after `TEMBO_TIMEOUT_MS` (75 s: the server's run is bounded at 20 s and Clef's check follows,
  and polling may take 30 s more). `retry(messageId)` checks again.
- `error` keeps the `ApiError`; `exhausted` sets `usage` to every question used,
  with `resetsAt` from `retryAfterMs`.
- After a reload the store holds no questions. `unaskedForToday(message, usage)`
  rebuilds `exhausted` for the reader's own `@tembo` message from today that the
  server says nothing asked (`Message.temboAsked === false`) while `/me`'s usage
  is at its limit, so the note stays (QA3-05). It says Tembo didn't take the
  question and that none are left, not that the allowance was why.

## Feedback

`sendFeedback(answerId, kind)` shows the choice at once (`feedback`, `saving`),
and puts the earlier one back when saving fails, unless a newer choice has
replaced it. The server keeps the latest.

## Lifetime

`store.retain()` (ChannelSurface holds it while mounted) watches the channel store while mounted;
the last release aborts requests and timers, and nothing new is asked. A
remount carries on with questions still open. `announcement` is polite
aria-live text for the channel's live region.
