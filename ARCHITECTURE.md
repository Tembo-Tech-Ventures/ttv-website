# TTV Website Architecture

This document describes the architecture, technology choices, and conventions used in the TTV Website project.

## Overview

TTV Website is a full-stack web application for **Tembo Tech Ventures**, a tech training platform. It supports:

- **Public marketing pages** with animated hero sections and GSAP animations
- **User authentication** via GitHub OAuth (better-auth)
- **Student application workflow** with dynamic forms and status tracking
- **Admin dashboards** for managing users, applications, and programs
- **Certificate generation** for completed programs
- **Blog** (placeholder — CMS not yet re-implemented)
- **Platform spaces** behind feature flags: a spaces shell with attention and search, cohort and community channels with moderation, Tembo in channels, mentor connections and guided onboarding (see `web/docs/platform-spaces-and-channels.md`)

The entire application lives inside the `web/` directory as a single Astro project deployed to Cloudflare Workers.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Astro 7 (SSR, Cloudflare adapter) |
| Language | TypeScript 5 |
| UI Islands | React 18 (for interactive components) |
| CSS | Tailwind CSS 4 (Vite plugin) |
| Animations | GSAP + ScrollTrigger |
| Database | SQLite via Cloudflare D1 |
| ORM | Drizzle ORM |
| Authentication | better-auth (GitHub OAuth) |
| File Storage | Cloudflare R2 |
| Icons | Phosphor Icons, react-icons |
| ID Generation | CUID2 |
| Deployment | Cloudflare Workers |
| CI/CD | GitHub Actions |

## Directory Structure

```
ttv-website/
├── web/                          # The Astro application
│   ├── src/
│   │   ├── pages/                # File-based routing (Astro pages)
│   │   │   ├── admin/            # Admin dashboard pages
│   │   │   ├── auth/             # Login, logout
│   │   │   ├── blog/             # Blog (placeholder)
│   │   │   ├── certificate/      # Certificate display
│   │   │   ├── dashboard/        # User dashboard pages
│   │   │   ├── api/              # API routes
│   │   │   │   ├── auth/         # better-auth handler
│   │   │   │   └── admin/        # Admin API (data import)
│   │   │   └── index.astro       # Homepage
│   │   ├── layouts/              # Astro layouts
│   │   │   ├── BaseLayout.astro  # Root HTML shell
│   │   │   ├── PublicLayout.astro # Marketing pages (nav + footer)
│   │   │   ├── AdminLayout.astro  # Admin pages (sidebar shell)
│   │   │   ├── DashboardLayout.astro # User dashboard (sidebar shell)
│   │   │   ├── SpacesLayout.astro # Spaces shell (flag `spaces`)
│   │   │   └── CertificateLayout.astro # Minimal layout
│   │   ├── components/           # Reusable components
│   │   │   ├── auth/             # Auth components (GitHubSignInButton)
│   │   │   ├── style-guide/      # The public /style-guide's frame, catalogue and specimens
│   │   │   ├── common/           # Shared UI (Sidebar, Grain, FontPreload)
│   │   │   ├── homepage/         # Homepage sheets, skills map and motion (see web/docs/homepage.md)
│   │   │   ├── platform/         # ui/ (the TTV UI kit), spaces shell, overlays, mentors, onboarding (READMEs inside)
│   │   │   ├── channels/         # Channel view, composer, embeds, Tembo cards
│   │   │   └── shells/           # Layout shells (AdminShell, DashboardShell)
│   │   ├── lib/                  # Core libraries
│   │   │   ├── auth.ts           # better-auth server config
│   │   │   ├── auth-client.ts    # better-auth client helpers
│   │   │   ├── platform/         # contracts.ts (Zod), server/ (capabilitiesFor, flags, space routing), client/ (stores, polling)
│   │   │   ├── design/           # Design tokens read from global.css, and WCAG contrast arithmetic
│   │   │   ├── attention/        # Attention items and producers
│   │   │   ├── channels/         # Channels, messages, moderation
│   │   │   ├── tembo/            # Tembo in channels
│   │   │   ├── mentoring/        # Mentor connections, checks, confirmations
│   │   │   ├── search/           # /api/search
│   │   │   ├── onboarding/       # Intents and access requests
│   │   │   └── db/
│   │   │       ├── schema.ts     # Drizzle schema (all models)
│   │   │       └── migrations/   # D1 migration SQL files
│   │   ├── styles/
│   │   │   └── global.css        # Tailwind config + theme
│   │   ├── middleware.ts         # Auth middleware (session + route guards)
│   │   └── env.d.ts              # TypeScript declarations
│   ├── scripts/
│   │   ├── cloudflare/           # Deploy/destroy scripts
│   │   └── import-data.mjs       # Data migration from old Prisma stack
│   ├── astro.config.mjs          # Astro configuration
│   ├── drizzle.config.ts         # Drizzle ORM config
│   ├── wrangler.jsonc            # Cloudflare Workers config
│   └── package.json
├── .github/workflows/            # CI/CD workflows
├── .claude/                      # Claude Code skills and settings
└── .devcontainer/                # GitHub Codespaces config
```

## Routing

Astro uses file-based routing in `src/pages/`. Layouts provide shared UI shells.

### Layout Hierarchy

```
BaseLayout (HTML shell, global CSS, meta tags)
├── PublicLayout  → Nav bar, footer, grain overlay, gradient background
│   └── index.astro  →  /  (cohorts and skills map, builders, community, hire, principles)
├── AdminLayout   → the Admin space in SpacesLayout (flag `spaces`), else AdminShell (React island with sidebar)
│   └── admin/*  (users, applications, programs, moderation, feedback, recordings, …)
├── DashboardLayout → DashboardShell (React island with sidebar)
│   └── dashboard/*  (apply, applications, profile)
├── SpacesLayout → space tabs, per-space sidebar, attention, search (flag `spaces`)
│   └── dashboard/*  (the same pages through SpacePage, plus channels, mentoring, attention)
├── CertificateLayout → Minimal (no nav, no footer)
│   └── certificate/[id].astro
├── (no layout) → auth/*, blog/*, api/*
```

### Key Routes

| Path | Purpose | Auth |
|------|---------|------|
| `/` | Public homepage: cohorts, skills map, builders, community, hire, principles | None |
| `/blog` | Blog placeholder | None |
| `/style-guide` | The public style guide, five pages in a tab file: Principles, `/foundations`, `/components`, `/patterns`, `/voice`. Renders the UI kit's real components (see `web/docs/design-system/`) | None |
| `/auth/login` | GitHub OAuth sign-in | None |
| `/auth/logout` | Sign out: a GET only asks "Sign out?" (prefetchers and link previews fetch with GET); its POST form, and the account menu's, sign out with a 303 home | Session |
| `/dashboard` | User dashboard home; with flag `spaces`, a 302 to the last-used space (`ttv-last-space` cookie) or the first one the caller has | Session |
| `/dashboard/cohort`, `/dashboard/community`, `/dashboard/mentoring`, `/dashboard/discover`, `/dashboard/me`, `/dashboard/account` | Space homes (flag `spaces`). The old pages live under them (`/dashboard/apply` → `/dashboard/cohort/apply`, `/dashboard/ask` → `/dashboard/cohort/ask`, `/dashboard/mentorship` → `/dashboard/mentoring/confirm`, `/dashboard/portfolio` → `/dashboard/me/portfolio`, `/dashboard/profile` → `/dashboard/account`, …), and the old URLs 301 there (`SPACE_REDIRECTS` in `src/lib/platform/server/space-routes.ts`) | Session; each space needs its capability |
| `/dashboard/me` | The Profile space's Overview (flag `spaces`): the public profile card with "View public page" and "Edit", shared work with its mentor confirmation and revision state, "Needs you" (unopened visitor messages, unconfirmed newer revisions, drafts), opportunities and certificates. Read-only; the editor is `/dashboard/me/portfolio` | Session |
| `/dashboard/attention` | Everything that needs the caller (the bell's page on mobile); flag `spaces` | Session |
| `/dashboard/ask` | Ask Tembo privately: the sessions of the caller's cohorts (with `spaces`, a 301 to `/dashboard/cohort/ask`) | Session |
| `/dashboard/apply` | Program application form | Session |
| `/dashboard/application/[id]` | View/edit own application | Session |
| `/dashboard/profile` | User profile | Session |
| `/dashboard/welcome` | Onboarding: "How will you take part?"; new accounts land here from `/dashboard`; flag `onboarding` (`?intent=` takes the legacy page when off) | Session |
| `/admin` | Admin dashboard home | ADMIN |
| `/admin/users` | User management | ADMIN |
| `/admin/users/[id]` | User detail (roles) | ADMIN |
| `/admin/applications` | Application review | ADMIN |
| `/admin/applications/[id]` | Application detail, status changes | ADMIN |
| `/admin/programs` | Program management | ADMIN |
| `/admin/programs/[id]` | Program detail, role assignments | ADMIN |
| `/admin/programs/new` | Create program | ADMIN |
| `/admin/data-migration` | Import data from old stack | ADMIN |
| `/admin/access-requests` | Mentor and institution access requests to approve or decline; not flag-gated | ADMIN |
| `/admin/platform-flags` | Who sees each platform feature flag (Off, Staff, Everyone); Everyone asks to confirm, and dependency warnings never block. No JavaScript needed | ADMIN |
| `/dashboard/feedback` | The student's own feedback, status and replies | Session |
| `/dashboard/cohort/c/[slug]`, `/dashboard/community/c/[slug]` | A channel; 404 unless the caller can read it (flag `channels`) | Session |
| `/dashboard/community/dm/[id]` | A direct conversation; 404 unless the caller is one of its two members (flag `channels`). A mentor conversation opens with the request that started it. Either member reports a message; admins outside it see that message alone, in the moderation queue | Session |
| `/dashboard/community/mentors`, `/dashboard/mentoring/requests`, `/dashboard/mentoring/availability` | Mentor directory with URL filters, the caller's own requests (withdraw) and the "Ask for time" drawer, which also posts without JavaScript; a mentor's requests (accept, suggest another mentor, not this month) and availability (Mentoring space); any signed-in person may ask, as themselves; flag `mentor_requests` (see `web/src/components/platform/mentors/README.md`) | Session |
| `/dashboard/community/conduct` | "How we talk to each other": the channel code of conduct; flag `channels` | Session |
| `/admin/feedback` | Feedback queue; `/admin/feedback/[id]` to reply, theme and resolve | ADMIN |
| `/admin/feedback/themes` | Feedback themes with agreement stats; `[id]` to plan, ship or decline | ADMIN |
| `/admin/moderation` | The channel moderation queue (`?state=DECIDED` for decided cases), flag `channels`; with flag `mentor_requests`, a "Request notes" tab (`?tab=request-notes`) to keep or remove mentor requests whose note Tembo's check held or a mentor reported, through `/api/moderation/mentor-requests`. Works without JavaScript | ADMIN |
| `/certificate/[id]` | Certificate display | None |
| `/api/auth/[...all]` | better-auth API handler | N/A |
| `/api/chat` | Ask Tembo question (JSON, same-origin); Tembo reads the sessions of the caller's cohorts (`capabilitiesFor`), every cohort's for staff. A new conversation is saved only together with its first answer, in one D1 batch, so a failed request leaves nothing in Recent. Only a signed-out request gets `401` (body `{ "error": "Unauthorized" }`), so clients can offer "sign in again" on the status alone | Session |
| `/api/admin/import` | Data import API | ADMIN |
| `/api/staging/sam-login` | A SAM agent signs in as a fictional persona with its SAM OIDC token (POST), or ends its logins (DELETE); staging only, 404 unless `SAM_LOGIN_PROJECT_ID` and `SAM_LOGIN_USER_IDS` are set (see `web/src/lib/sam-login/README.md`) | SAM OIDC token of an allowed SAM user |
| `/api/admin/platform-flags` | Flag audiences (GET; PUT `[key]` with `OFF`, `STAFF` or `ALL`) | ADMIN; tokens need `admin:read` (GET) or `admin:write` (PUT) |
| `/api/platform/me` | The caller's spaces, capabilities, effective flags, unread counts per space and Tembo allowance; flag `spaces` | Session, browser only |
| `/api/attention` | The caller's attention items, newest first (GET `?filter&cursor`); `/count` per space (GET); `/read` marks items, or everything up to a snapshot, read (POST); flag `spaces` | Session, browser only |
| `/api/search` | Search people, projects, session moments and (flag `channels`) messages the caller can read (GET `?q&scope&programId`); flag `spaces` (see `web/src/lib/search/README.md`) | Session, browser only |
| `/api/feedback` | Feedback widget submission (multipart, same-origin) | Session |
| `/api/feedback/attachments/[id]` | Feedback screenshot (author or admin only) | Session |
| `/api/admin/feedback` | Feedback queue JSON for admins and PAT-holding agents (GET, PATCH `[id]`) | ADMIN |
| `/api/mcp` | MCP (JSON-RPC over HTTP): community tools for community tokens; `list_moderation_queue` (`admin:read`) and `moderate_message` (`admin:write`) for admins while flag `channels` is on | Session (same origin) or token |
| `/api/admin/feedback/themes` | Feedback themes JSON (GET, POST; GET/PATCH `[id]`) | ADMIN |
| `/api/channels` | The caller's readable channels with unread counts (GET); flag `channels` | Session, or a `channels:read` (reads) or `channels:write` (writes) token |
| `/api/channels/[id]/messages` | A page of messages: latest, `?before=`, `?since=` polling, `&thread=` (GET); post, idempotent on `clientNonce`, after the code of conduct and within rate limits, with up to five embeds checked again on every read (POST); flag `channels` | Session, or a `channels:read` (reads) or `channels:write` (writes) token |
| `/api/channels/[id]/shareables` | What the caller can attach here (GET, `?q=` finds session moments): their own published projects, and clips only in that cohort's own channels; flag `channels` | Session, or a `channels:read` (reads) or `channels:write` (writes) token |
| `/api/channels/[id]/read` | Move the caller's read marker forward (POST); the only thing that moves it; flag `channels` | Session, or a `channels:read` (reads) or `channels:write` (writes) token |
| `/api/messages/[id]` | The author edits (PATCH) or deletes, leaving a placeholder (DELETE); `/reactions` sets one fixed reaction on or off (POST); flag `channels` | Session, or a `channels:read` (reads) or `channels:write` (writes) token |
| `/api/channels/[id]/tembo` | Ask Tembo about your own message (POST): 202 pending, answered after the response into that message's thread, then 200 with the answer; idempotent per message, also asked by an `@tembo` mention; 10 accepted questions per person per Africa/Nairobi day, else 429 `quota_exhausted`; flags `channels` and `tembo_channels` (see `web/src/lib/tembo/README.md`) | Session, or a `channels:write` token |
| `/api/messages/[id]/tembo-feedback` | "helpful" or "not quite" on a Tembo answer (POST), one per person and answer; flags `channels` and `tembo_channels` | Session, or a `channels:write` token |
| `/api/messages/[id]/report`, `/review` | Report a message, once per person (POST); the author of a hidden message asks for a review (POST); flag `channels` | Session, or a `channels:read` (reads) or `channels:write` (writes) token |
| `/api/moderation/[messageId]` | Hide (the channel's moderators and admins), restore or keep "fine as is" (admins) (POST); flag `channels` | Session; no personal access tokens (admin tokens use `/api/mcp`) |
| `/api/moderation/[messageId]/undo` | The moderator who hid a message takes the hide back while no admin has decided; the case keeps its other flags and reports, or closes (POST); flag `channels` | Session; no personal access tokens |
| `/api/moderation/queue` | The moderation queue: one case per message, with evidence, review request and decision (GET); flag `channels` | ADMIN; no personal access tokens (admin tokens use `/api/mcp`) |
| `/api/mentors` | Listed mentors with their capacity this Africa/Nairobi month (GET, `?area&format&available`); flag `mentor_requests` (see `web/src/lib/mentoring/README.md`) | Session; no personal access tokens |
| `/api/mentor-requests` | The caller's requests sent or received (GET `?as=requester\|mentor`); ask a mentor for time (POST; any signed-in person, as themselves), one waiting request per mentor, within the mentor's monthly spots; `[id]` (GET) and `[id]/accept`, `/redirect`, `/decline`, `/withdraw`, `/report` (the mentor, while waiting) (POST); accepting opens a direct conversation with the note and work in it; Clef's near-certain abuse or the mentor's report holds a request for an admin's check (no spot used; the person asking sees a neutral, true check, never "declined"); admins never decide their own request; flag `mentor_requests` | Session; its two parties only; no personal access tokens |
| `/api/moderation/mentor-requests` | Checks on request notes (GET `?state=OPEN\|DECIDED`); `[id]` keep (back to the mentor) or remove (closed, never sent) with a reason (POST); separate from the channel moderation queue; flag `mentor_requests` | ADMIN; no personal access tokens |
| `/api/mentoring/availability` | A mentor's own headline, areas, formats, monthly capacity and pause (GET, PUT); flag `mentor_requests` | MENTOR; no personal access tokens |
| `/api/mentoring/another-look` | "Worth another look": the caller's confirmed work that has changed revision since (GET); flag `mentor_requests` | MENTOR or ADMIN, browser only |
| `/api/platform/onboarding` | The caller's onboarding state and intents (GET, PUT); flag `onboarding` | Session, browser only |
| `/api/platform/access-requests` | Ask for mentor or institution access (POST; `[id]/withdraw`, `[id]/dismiss`); flag `onboarding` | Session, browser only |
| `/api/admin/access-requests` | Access-request queue (GET) and decisions (POST `[id]/decision`); not flag-gated | ADMIN, browser only |

## Database

SQLite via Cloudflare D1, managed with Drizzle ORM. Schema at `web/src/lib/db/schema.ts`.

### Core Models

**Authentication (better-auth)**
- `user` — id, name, email, emailVerified, image
- `account` — OAuth provider linking (cascade deletes with User)
- `session` — database-backed sessions (cascade deletes with User)
- `verification` — email verification tokens

**Authorization**
- `Roles` — role definitions (ADMIN, EDUCATOR)
- `UserRoles` — many-to-many user-role assignments

**Programs & Curriculum**
- `curriculum` — training curriculum (title, description)
- `program` — training program with dates, linked to Curriculum
- `programRole` — instructor/TA assignments (enum: INSTRUCTOR, TA)
- `programPartner` — partner organizations

**Applications**
- `programApplication` — student applications
  - `status`: PENDING → APPROVED/REJECTED/AUDIT → COMPLETED
  - `application`: JSON text storing form responses
  - `completedAt`: set when status becomes COMPLETED

**Files**
- `file` — uploaded file metadata (name, type, size, path, ownerId)

**Platform** (see `web/docs/platform-spaces-and-channels.md`)
- `feature_flag` — one row per rollout flag (`spaces`, `onboarding`, `channels`, `tembo_channels`, `mentor_requests`), audience OFF/STAFF/ALL with who changed it; seeded OFF by migration
- `attention_item` — one thing that needs one person: kind, space, category (mentions/requests/updates), subject link, optional actor, read time; `eventKey` unique per person so each event writes once. Kinds: `application_status`, `recording_ready`, `work_confirmed`, `visitor_message`, `mention`, `tembo_answer`, `message_hidden`, `moderation_pending`, `moderation_decided`, `mentor_request`, `mentor_withdrawn`, `mentor_accepted`, `mentor_redirected`, `mentor_declined`, `mentor_checked`, `access_request`, `access_decided` (`reply` and `opportunity_match` are in the contract with no producer yet). An item shows only while its subject still applies (see `web/src/lib/attention/README.md`)
- `member_intent`, `member_onboarding`, `access_request` (flag `onboarding`; see `web/src/lib/onboarding/README.md`) — how a person said they'll take part (routing and copy only, never authority), their onboarding stage, and requests for mentor or institution access that an admin decides

**Staging agent logins** (see `web/src/lib/sam-login/README.md`)
- `staging_sam_login` — one login a SAM agent made with its OIDC token: the spent token id, the SAM project, user, task and workspace, the persona and its session, expiry and revocation. Middleware accepts a `ttv-sam-persona-*` session only while its row is live

**Feedback** (see `web/docs/student-feedback.md`)
- `feedback` — a signed-in user's note: kind, message, page URL, browser context JSON, status (NEW → IN_PROGRESS → RESOLVED/DECLINED), reply shown to the student, staff-only note, link to the fix
- `feedback_attachment` — screenshots in R2 under `feedback/<feedbackId>/`, type sniffed from the bytes
- `feedback_theme` — one problem or wish several notes share (publishable title/summary, status COLLECTING → PROPOSED → PLANNED → IN_PROGRESS → SHIPPED/DECLINED, or DORMANT; issue and PR links); `feedback.themeId` and `feedback.sensitive` link and fence notes

**Channels** (flag `channels`; see `web/src/lib/channels/README.md`)
- `channel` — COHORT (one program), COMMUNITY or DIRECT; slug, topic, postingPolicy ALL/STAFF, archivedAt. Default community channels and each program's `cohort-NN`, `cNN-help` and `cNN-announcements` are seeded by migration, and a trigger creates a new program's channels
- `channel_message` — one-level threads, authorKind USER/TEMBO, per-channel `seq`/`changeSeq` for paging and polling, clientNonce unique per author, moderation VISIBLE/FLAGGED/HIDDEN with reasons
- `channel_member`, `channel_read`, `message_reaction`, `message_report`, `moderation_event` — explicit members, read markers, reactions, member reports and the moderation audit trail
- `channel_conduct` — each person's latest agreement to the channel code of conduct (version, acknowledgedAt); a new version asks again
- `channel_action` — a short-lived log of edits and reaction changes for their rate limits, pruned by a trigger after an hour
- `channel_message_version`, `moderation_case`, `moderation_allowlist` — moderation (B-2.5): earlier texts kept as evidence for moderators, the admin queue (one case per message, kept by triggers on `moderation_event`), and what an admin's "fine as is" allowlisted. Detectors flag contact details and spam before the write; Clef flash checks after the response, hides only near-certain abuse and fails open; flagged contact details are masked for everyone but the author, the channel's moderators and admins until a person decides
- `channel_message_search` + `channel_message_fts` — the FTS5 index over the bodies of messages nobody deleted or hid, kept by triggers (never embeds); `/api/search` reads it for the channels the caller can read (see `web/src/lib/search/README.md`)
- `tembo_ask`, `tembo_usage`, `tembo_feedback` (flag `tembo_channels`, B-3.1; see `web/src/lib/tembo/README.md`) — one question per asking message (PENDING/ANSWERED/FAILED under a run's claim), accepted questions per person per Africa/Nairobi day, and "helpful"/"not quite" per person and answer. Tembo reads only what the channel allows (a cohort's transcripts, public profiles and projects shared there, or the conversation), never masked contact details, and every sentence it posts cites a source it was given
- Access: `channelAccessFor` beside `capabilitiesFor` — cohort channels for that program's members (alumni included), instructors, TAs, invited mentors and admins; community channels for every signed-in person; DIRECT conversations for their two members only (an admin outside one can't open it, and sees only a single reported or flagged message in the moderation queue); STAFF posting for admins and the cohort's instructors/TAs

**Mentor connections** (flag `mentor_requests`; see `web/src/lib/mentoring/README.md`)
- `mentor_profile` — a mentor's own headline, bio, areas, formats offered, monthly capacity and pause; listed only while they hold the MENTOR role
- `mentor_request` — PENDING → ACCEPTED/REDIRECTED/DECLINED/WITHDRAWN, one PENDING per pair; the note (screened like a post), the attached project at its revision, and the DIRECT conversation an acceptance opened. Spots are counted per Africa/Nairobi month
- `mentor_request_case`, `mentor_request_report` — a check on a request's note, opened by Clef's near-certain abuse or the mentor's report (one per request); while open the request holds no spot and its mentor cannot act on it; an admin keeps it (back to the mentor) or removes it (WITHDRAWN, never sent)

### Conventions

- All tables use CUID2 for primary keys (via `cuid()` helper)
- Timestamps use `integer({ mode: "timestamp" })` with `unixepoch()` default
- Relations defined with `relations()` from drizzle-orm
- Cascade deletes on auth-related tables (account, session, userRole)

## Feature Flags

New platform features ship dark behind flags in the `feature_flag` table, each with an audience of `OFF`, `STAFF` (admins) or `ALL`, set at `/admin/platform-flags`. A flag that is off for the caller makes its pages and APIs return 404. `onboarding` is effective only while `spaces` is, and `mentor_requests` only while `channels` is; the Tembo routes check both `channels` and `tembo_channels`. Preview and staging deploys turn every flag on with `PLATFORM_FLAGS_OVERRIDE=all`, which production ignores. Moving a flag to `ALL` needs the owner's approval. Each flag, and the access rules, moderation runbook and Tembo rules behind it, are in `web/docs/platform-spaces-and-channels.md`.

## Authentication

GitHub OAuth via **better-auth**:

1. User clicks "Sign in with GitHub" on `/auth/login`
2. better-auth handles OAuth flow via `/api/auth/[...all]`
3. Session created in D1 with 5-minute cookie cache
4. Middleware attaches `locals.user` and `locals.session` on every request

**Auth flow in middleware (`src/middleware.ts`):**
- Every request: resolve session from cookies via better-auth
- `/dashboard/*`: redirect to `/auth/login` if no session
- `/admin/*`: redirect to `/auth/login` if no session, redirect to `/dashboard` if no ADMIN role

## Styling

- **Tailwind CSS 4**: Custom theme defined in `src/styles/global.css` using `@theme` directive
- **Color tokens**: `--color-primary` (#F28D68), `--color-dark` (#013D39), `--color-teal` (#2C6964), `--color-bg-raised`, `--color-ink-primary`, `--color-ink-secondary`, `--color-ink-muted`, `--color-rule`; for the platform, the ground and sheet tones, `peach-ink`, `ring`, and the status inks `danger-ink`, `success-ink`, `warning-ink` (every one in `web/docs/design-system/foundations.md`)
- **Typography**: Mattone Black (Collletttivo, OFL 1.1, self-hosted) for h1, and for the public site's display h2s through `font-display`; Maven Pro (OFL 1.1, self-hosted, latin file preloaded by `FontPreload`) for body and h2-h6
- **Display tracking**: three named theme tokens (`--tracking-display`, `--tracking-heading`, `--tracking-subhead`) instead of per-element `letter-spacing`, so the display face can be swapped without retuning every heading
- **Animations**: GSAP ScrollTrigger on the homepage's stacked sheets and skills map (see `web/docs/homepage.md`), reveal utility class
- **Grain overlay**: SVG noise texture via `Grain.astro` component

## Deployment

### Cloudflare Workers via GitHub Actions

- **Production**: Auto-deploys on push to `main` → `tembotechventures.com`
- **Staging**: Auto-deploys on PR → `staging.tembotechventures.com`
- **Manual**: Workflow dispatch for arbitrary environments

### Deployment scripts (`scripts/cloudflare/`)

- `deploy.mjs` — Creates D1 database, R2 bucket, applies migrations, deploys Worker, configures domain
- `destroy.mjs` — Tears down environment (protected against production)
- `lib.mjs` — Shared Cloudflare API utilities

### Local Development

```bash
cd web
npm install
npm run dev          # Starts Astro dev server with local D1
```

No Docker needed. Wrangler handles local D1 database emulation.

## Working on This Project

### Adding a New Page

1. Create `src/pages/<path>.astro` (or `src/pages/<path>/index.astro`)
2. Import and wrap with the appropriate layout (`PublicLayout`, `DashboardLayout`, `AdminLayout`)
3. Auth is handled by middleware — no need for per-page auth checks
4. Access database via `drizzle(env.DB, { schema })`
5. Use Astro components by default; React islands only for interactivity

### Adding a Database Model

1. Edit `src/lib/db/schema.ts`
2. Run `cd web && npm run db:generate` to create migration
3. Run `cd web && npm run db:migrate:local` to apply locally
4. Migrations auto-apply on deploy via `scripts/cloudflare/deploy.mjs`

### Adding an API Endpoint

1. Create `src/pages/api/<path>.ts`
2. Export HTTP method handlers (`GET`, `POST`, etc.) as `APIRoute`
3. Auth via `createAuth(env).api.getSession({ headers: request.headers })`
4. Database via `drizzle(env.DB, { schema })`

### Conventions

- **Astro first**: Use `.astro` for pages and static components. React `.tsx` only for interactivity.
- **`client:visible`** for below-fold interactive content, **`client:load`** for above-fold
- **Path alias**: `@/` for `src/` in imports
- **UI kit**: Build UI from the TTV UI kit, `@/components/platform/ui` (buttons, links, fields, notices,
  empty states, chips, avatars, cards, sheets and the tab file). In `.astro` files a kit component with no
  `client:` directive renders as static HTML. Where a component cannot go, use its recipe (`buttonClass`,
  `FOCUS_RING`) rather than copying classes. The older `form-control` utility is frozen to the files that already use it (`legacy-ui.test.ts`);
  the older `common/Button`, `Card` and `Badge` are gone. The guide is
  `web/docs/design-system/`; the public version, with every component live, is `/style-guide`.
- **Theme colors**: Use Tailwind classes (`text-primary`, `bg-dark`, `text-ink-primary`, etc.)
