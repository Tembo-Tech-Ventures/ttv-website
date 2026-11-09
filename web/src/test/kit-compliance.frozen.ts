/*
 * The kit-compliance ratchet's frozen counts (kit-compliance.test.ts): how many
 * of each rule's matches a file may still hold. A file not listed may hold
 * none. The numbers only go down: when you take matches out of a file, lower
 * its number here, and delete the line at zero.
 */
export const FROZEN: Record<string, Record<string, number>> = {
  "raw white or black": {
    "components/auth/GitHubSignInButton.tsx": 1,
    "components/common/Sidebar.tsx": 6,
    "components/platform/shell/harness/StubOverlays.tsx": 1,
    "components/shells/AdminShell.tsx": 2,
    "components/shells/DashboardShell.tsx": 2,
    "pages/dev/shell-preview.astro": 1,
  },
  "Tailwind palette colours": {
    "components/auth/GitHubSignInButton.tsx": 1,
    "components/common/Button.astro": 3,
    "components/talent/TalentCard.astro": 4,
    "pages/hire/index.astro": 16,
    "pages/talent/[handle].astro": 17,
  },
  "arbitrary colour values": {
    "components/auth/GitHubSignInButton.tsx": 2,
  },
  "inline rgb() and hsl()": {
    "components/certificate/CertificateActions.astro": 4,
    "components/certificate/CertificateCard.astro": 2,
    "components/homepage/BuilderCard.astro": 17,
    "components/homepage/Builders.astro": 4,
    "components/homepage/Cohort.astro": 16,
    "components/homepage/Community.astro": 8,
    "components/homepage/CommunityComp.astro": 29,
    "components/homepage/Hire.astro": 4,
    "components/homepage/Principles.astro": 4,
    "components/homepage/SkillsMap.astro": 27,
    "components/homepage/homepage.css": 5,
    "components/homepage/sheet.css": 11,
    "components/platform/onboarding/onboarding.css": 5,
    "components/platform/ui/platform-ui.css": 4,
    "pages/auth/login.astro": 1,
    "pages/blog/[handle]/[slug].astro": 1,
    "pages/dev/certificate-print/a.astro": 2,
    "pages/dev/certificate-print/b.astro": 2,
    "pages/dev/certificate-print/c.astro": 2,
  },
  "the form-control utility": {
  },
  "the spaces/PageTitle.astro shim": {
  },
  "status flags in the query string": {
    "components/platform/mentors/DirectoryRequests.tsx": 1,
    "components/platform/mentors/MentorsDirectory.astro": 1,
    "components/platform/onboarding/welcome-flow.ts": 3,
    "pages/admin/access-requests.astro": 1,
    "pages/admin/applications/[id].astro": 1,
    "pages/admin/applications/index.astro": 1,
    "pages/admin/curricula/[id].astro": 4,
    "pages/admin/curricula/index.astro": 1,
    "pages/admin/feedback/[id].astro": 2,
    "pages/admin/feedback/themes/[id].astro": 2,
    "pages/admin/programs/[id].astro": 1,
    "pages/admin/programs/index.astro": 1,
    "pages/dashboard/community/mentors.astro": 1,
    "pages/dashboard/mentoring/availability.astro": 2,
    "pages/dev/platform-mentors.astro": 2,
  },
  "eyebrows (uppercase tracked labels)": {
    "components/blog/editor/theme.ts": 2,
    "components/community/CommunityIntro.tsx": 1,
  },
  "the older surface tokens": {
    "pages/dev/shell-preview.astro": 1,
  },
};
