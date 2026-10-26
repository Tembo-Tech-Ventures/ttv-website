# Staging demo: admin and fictional personas

This extends the existing retained demo system. It does not impersonate human
users, add a login provider, create admin credentials, or enable production.

## Presenter steps

1. Open https://staging.tembotechventures.com/auth/login and sign in with the
   existing GitHub account that has ADMIN access **in staging**.
2. In Admin, choose **Staging demo personas**, or open
   https://staging.tembotechventures.com/demo directly in that browser.
3. Check the protected retained-dataset counts. Expected original seed:
   150 fictional people, 150 profiles, 272 contributions, 90 confirmations.
   Contributions and confirmations may increase after a demonstration. These
   are expected seed counts, not a claim that live data was inspected.
4. Choose **Cohort member** or **Community member** to show an own contribution
   at `/dashboard/community`. Prefer the non-cohort role to demonstrate that
   community membership is separate from cohort enrollment.
5. Use **Switch role** to return to the chooser, then **Mentor** to review a
   specific contribution at `/dashboard/mentorship`. Confirmation describes
   that contribution; it does not verify general ability.
6. Switch to **Institution** at `/dashboard/discover` to search the retained
   fictional profiles and inspect their published evidence. A model request is
   optional and can be slow; plain search and evidence inspection do not need it.
7. Choose **Stop impersonating · Return to admin**, then confirm. This revokes
   only the demo sessions belonging to the original admin session and restores
   that same admin session, without extending its lifetime.
8. **Sign out of staging** intentionally ends both the demo and original admin
   session. Sign in again with GitHub to start another presentation.

Every impersonated page identifies the fictional persona and its deadline.
Sessions last at most one hour and end earlier if the parent admin session
expires or loses ADMIN. The feature also stops at 2026-10-26 23:00 UTC. It must
be explicitly enabled on the canonical staging deployment. Ordinary accounts,
bearer tokens and agent sessions cannot start impersonation. Fixed persona IDs,
roles and cohort membership are verified before each switch; no arbitrary user
ID is accepted. A missing or altered persona fails closed instead of reseeding.

Use the same browser tab to switch roles; cookies are shared across tabs. Save
work before switching. The return control still works after the persona's
one-hour expiry while the original admin and overall demo window remain live.
If the original admin session is revoked or expired, sign in again. No restore
path grants ADMIN to an ordinary user.

## Audit and preservation

Switch, return and full logout append transactional `credentialAuditLog` rows
with provider `staging-demo`, the authenticated admin ID, fixed persona when
applicable, parent session ID and expiry. No token or cookie is logged. Audit
failure prevents the session change. No schema or unrelated credential changes
are required. Human user/profile data and retained demo records are preserved;
only controlled demo sessions are revoked when switching or returning.

## Evidence

`chooser-{390,1440}.png` and `return-{390,1440}.png` are screenshots of real UI
components in a **local fictional fixture**. Their API responses are mocked;
they verify layout, confirmation, focus and fixed navigation, not live auth.
Real-SQLite automated tests cover the server-side admin, role, origin, expiry,
production, cookie restoration, audit rollback and synthetic-count boundaries.
Live deployment and dataset verification are reported separately with an exact
SHA; do not infer them from local screenshots or expected seed counts.
