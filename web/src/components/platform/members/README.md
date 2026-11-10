# Members

The in-app member directory, in the Community space (semi-public member directory, PR C;
spec: SAM Library `/specs/member-directory/member-directory-SPEC.md`). Everyone with a saved
profile, and all the work they have posted, for everyone signed in. Institutions see exactly
these pages; their only extra is Discover's tools, linked quietly from the directory. The public
website (`/talent`) stays for cohort graduates who chose to publish.

| Route | Page |
|---|---|
| `/dashboard/community/members` | The directory: search, cards, pages |
| `/dashboard/community/members/<handle>` | One member: profile and posted work |

Both exist only with the `spaces` flag (`isMemberPagePath` in
`src/lib/platform/server/space-routes.ts`); there is no flag of their own.

## Reads

Everything comes from the read contract in `src/lib/members/directory.ts`, which applies the one
eligibility rule (listed: a saved profile, not suspended or held, never a mentor or admin, never
the caller). The pages decide nothing about who is listed.

- The directory runs `listMembers` and `readOwnMemberCard` together, started beside the space
  context (`resolveSpacePageWith`), so they are one round trip.
- A member's page runs `readMember` the same way. `null` is a 404 whatever the reason, so a
  handle never confirms that an account exists.
- A failed read records an error and shows the kit's danger `Notice` with a 503. It never
  shows an empty list as if no one were there.

## The page

- **Search** (`MemberFilters`): a GET form, `q`, `skills` (comma-separated, up to five) and
  `open` (`freelance` or `roles`), bounded in `parseMemberUrl` before the read. It lands on the
  results heading (`#member-results`), so a keyboard carries on from the results. It sends no
  cursor, so a new search starts from the first page. On a phone the fields fold into a kit
  `Disclosure` ("Search and filter"), open when a filter is on; on a sheet 38rem or wider it
  stays open with no summary, where the browser supports `::details-content` (`members.css`).
  The tab's title says which search and page it is ("Members: 3 members match",
  "Members: 25–48 of 57"), through `SpacePage`'s `titleSuffix`; the phone's top bar keeps "Members".
- **Order**: the day's fair rotation (Africa/Nairobi), pinned in the cursor. Nothing ranks
  anyone: no scores, no "top", no views, no upvotes (policy af60b59b).
- **Pages** (the kit `Pager` with `firstHref`): a cursor only knows what comes after it, so there is Next and
  "First page", never a guessed Previous. `seen` in the address words "25–48 of 57" and
  changes nothing else.
- **You** (`YouCard`): the caller is never in the list, so the top of the first, unfiltered page
  says where they stand. Listed: their page as others see it. Not listed: one line that is true
  whether they have no profile or one waiting for a check, linking to their profile. Mentors and
  staff are told they aren't listed here.
- **Cards** (`MemberCard`): the community's card, not a table row. The person first, then
  skills, what they are looking for, and the facts at the foot after a hairline. The name is
  the one link, and its press area covers the card. In the app, hover and focus change colour
  only (foundations: Motion), and reduced motion makes even that a cut.
- **A member** (`MemberProfile`, `WorkItem`): who they are, what they are looking for, their
  skills, then every piece of posted work. A confirmation reads as its revision's: once the
  work changes, it says an earlier version was confirmed. Unconfirmed work says so only on the
  author's own page: missing evidence is not evidence against anyone. A repository is dated by
  its last push; the day GitHub's stars and topics were read is in small print. Work links open
  in a new tab, only for `http(s)`. The `/talent` link shows only when `publicUrl` is set.
- **Links to a member**: every in-app surface uses `memberProfileHref` or `memberWorkHref`
  (`src/lib/members/links.ts`): cards, search, the Profile overview, channel project embeds
  (`memberHref`, added on read, never stored) and Discover.

## Tests

| Test | Proves |
|---|---|
| `members-ui.test.tsx` | The address, the words, each component's markup and states |
| `src/pages/dashboard/community/_tests/members.render.test.ts` | Both pages through the real middleware: what they ask the reads for, every answer (a page, none, later pages, failure, 404), methods and the flag |
| `src/lib/platform/server/space-routes.test.ts` | Which paths are member pages, and which never are |
| `src/test/perf/round-trips.render.test.ts` | D1 round trips per page |
| `e2e/platform-members.spec.ts` | axe at 1440, 768, 390 and 320, no sideways scroll, 44px targets on the directory and a member's page, the search folded on a phone, focus on the whole card, reduced motion, the search without JavaScript, the same 404 for unknown, held and out-of-shape handles, institutions |

## Local data

`e2e/platform-members.local.sql` adds seven fictional members (profiles, posted work, a repository,
confirmations at current and earlier revisions, and one profile held by a check) on top of
`e2e/platform-personas.local.sql`. The e2e spec and the screenshots expect both. Local D1 only:

```bash
cd web
npm run db:migrate:local
npx wrangler d1 execute ttv-database --local --file e2e/platform-personas.local.sql
npx wrangler d1 execute ttv-database --local --file e2e/platform-members.local.sql
```

Re-running either puts everything back. Every name, handle and project in it is made up.
