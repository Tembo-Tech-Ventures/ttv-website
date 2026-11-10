# Member profiles and work

## Visibility

`studentProfile` is the single saved profile for every signed-in person. `communityProfile`
has been migrated and dropped. A saved profile is discoverable while it is neither
SUSPENDED nor held by moderation; MENTOR and ADMIN owners are excluded. All signed-in
readers, including institutions, see the same directory. Institutions add AI discovery
and assessment tools, not access to more people or evidence.

`communityJourney` stores both contributions and repository work. `profileHighlight`
has been migrated and dropped; repository snapshots and chosen order live on work rows.
POSTED work follows the profile's visibility. DRAFT work is author-only; old private
rows became drafts. The retired NOT NULL `visibility` column always receives the legacy
constant `institution` and is never used for authorization. REST work requests and responses use `status: "posted" | "draft"`. PATCH
`/api/community/journey/:id` changes that status. The old `visibility` input
is deprecated and normalized once at validation; responses never emit it.

Clef checks saved profile text and posted work, fails open on errors, and can hold an
item for a human. Shared reads never include held items. Author/editor and admin reads
can inspect them. The shared predicates live in `src/lib/community/eligibility.ts`.
Public surfaces additionally require PUBLISHED and a valid cohort completion;
PUBLISHED means opting into the public website, not becoming visible to members.

`src/lib/members/directory.ts` provides cursor-paginated cards and profile reads in
one D1 batch each. The directory always shows the shared view, even to the author.


Community read tokens may read the same saved members as signed-in browsers. Institution scope adds AI discovery and assessment, not additional evidence.

Wire `status` is `posted` or `draft`; storage `state` is `POSTED` or `DRAFT`. The retired NOT NULL `visibility` column permanently uses `institution` because rebuilding this referenced D1 table would delete dependent rows.
