# Channels in the spaces (U-2.3)

The channels' place in the Community and Cohort spaces, behind the `channels`
flag. The domain (tables, who may read and post, the conduct store) is the
backend lane's: `src/lib/channels/README.md`. This module only presents it.

## What is here

- **Sidebars.** `spaceSidebar` (`../platform/spaces/sidebar.ts`) lists a
  space's channels under "Channels" when it is given them: community channels
  (`#`) in Community, the person's cohort channels (a lock) in Cohort, in the
  backend's order. Unread channels are bold with a count; read ones are
  quieter; the open one is current; archived ones say so. Community ends the
  list with "How we talk to each other". Cohort does not, so no sidebar link
  changes space. Direct conversations wait for mentor requests (Phase 4).
  `SpacePage` reads the list through `loadSidebarChannels`, which returns
  nothing (the sidebar exactly as before) while the flag is off, outside
  Community and Cohort, or when the read fails (reported, never fatal).
- **Channel pages** at `/dashboard/{community,cohort}/c/:slug`
  (`resolveChannelPage` in `channel-page.ts`): `ChannelHeader` (name, topic,
  who reads it, who posts), then `ChannelFrame`'s first-visit habits or
  "Conversations aren't open yet". U-2.1's `ChannelView` replaces that note,
  with `ChannelHeader` as its children.
- **"How we talk to each other"**: the words in `conduct.ts` (coordinator
  approved; change them only with the coordinator), shown on a person's first
  channel and at `/dashboard/community/conduct`. Agreeing is a plain form
  (`ConductAgree`, `conduct-flow.ts`) that works without JavaScript and
  returns to the page asked for. Same-origin posts only, and never from an
  agent's delegated session. It grants nothing. Raise `CONDUCT_VERSION`
  (`lib/channels/conduct.ts`) to ask everyone again.
- `server.ts` is the one seam to the backend: `listChannelsFor` and the
  conduct store.

## Tests

- `npx vitest run src/components/channels src/components/platform/spaces`
  (including flag-off parity: every persona's sidebars are identical without
  channels).
- `e2e/platform-channels.spec.ts`: the DEV harness `/dev/platform-channels`
  (`?persona=&space=`, `&channel=<slug>`, `&agreed`, `&view=conduct`,
  `&channels=off`) at 1440 and 390 with axe, no-JS agreeing and personas.
  Then the same journeys on real sessions, set up as in
  `../platform/spaces/README.md`. Locally, the seed resets every persona's
  agreement.
