import React, { useSyncExternalStore, useState, type ReactNode } from "react";
import Sidebar from "@/components/common/Sidebar";
import {
  PiGaugeDuotone,
  PiUsersDuotone,
  PiFileTextDuotone,
  PiBookOpenDuotone,
  PiSignOutDuotone,
  PiDatabaseDuotone,
  PiVideoCameraDuotone,
  PiKeyDuotone,
  PiIdentificationCardDuotone,
  PiBriefcaseDuotone,
  PiBooksDuotone,
  PiPlugsDuotone,
  PiChatTeardropTextDuotone,
  PiArrowLeftDuotone,
  PiUserPlusDuotone,
  PiToggleRightDuotone,
} from "react-icons/pi";
import { PiListBold } from "react-icons/pi";

const MAIN_ID = "admin-main";
const ACCESS_REQUESTS_HREF = "/admin/access-requests";

const primaryLinks = [
  // Admin is one of the person's spaces: the way back to the rest of the app comes first.
  { href: "/dashboard", label: "Back to dashboard", icon: PiArrowLeftDuotone },
  { href: "/admin", label: "Admin Home", icon: PiGaugeDuotone },
  // People waiting on a decision come straight after home, with how many are waiting.
  { href: ACCESS_REQUESTS_HREF, label: "Access requests", icon: PiUserPlusDuotone },
  { href: "/admin/users", label: "Users", icon: PiUsersDuotone },
  { href: "/admin/applications", label: "Applications", icon: PiFileTextDuotone },
  { href: "/admin/profiles", label: "Profiles", icon: PiIdentificationCardDuotone },
  { href: "/admin/feedback", label: "Feedback", icon: PiChatTeardropTextDuotone },
  { href: "/admin/projects", label: "Client Projects", icon: PiBriefcaseDuotone },
  { href: "/admin/curricula", label: "Curricula", icon: PiBooksDuotone },
  { href: "/admin/programs", label: "Cohorts", icon: PiBookOpenDuotone },
  { href: "/admin/recordings", label: "Recordings", icon: PiVideoCameraDuotone },
  { href: "/admin/settings/integrations", label: "Integrations", icon: PiPlugsDuotone },
  { href: "/admin/platform-flags", label: "Feature flags", icon: PiToggleRightDuotone },
  {
    href: "/admin/personal-access-tokens",
    label: "Personal Access Tokens",
    icon: PiKeyDuotone,
  },
];

export function getAdminLinks(
  agentAuthEnabled: boolean,
  dataMigrationEnabled = false,
  stagingDemoEnabled = false,
  pendingAccessRequests = 0
) {
  return [
    ...primaryLinks.map((link) =>
      link.href === ACCESS_REQUESTS_HREF
        ? { ...link, badge: pendingAccessRequests, badgeLabel: "pending" }
        : link
    ),
    ...(stagingDemoEnabled ? [{ href: "/demo", label: "Staging demo personas", icon: PiUsersDuotone }] : []),
    ...(dataMigrationEnabled
      ? [{ href: "/admin/data-migration", label: "Data Migration", icon: PiDatabaseDuotone }]
      : []),
    ...(agentAuthEnabled
      ? [{ href: "/admin/agent-access", label: "Agent Access", icon: PiKeyDuotone }]
      : []),
    { href: "/auth/logout", label: "Logout", icon: PiSignOutDuotone },
  ];
}

export default function AdminShell({
  children,
  currentPath = "/admin",
  agentAuthEnabled = false,
  dataMigrationEnabled = false,
  stagingDemoEnabled = false,
  pendingAccessRequests = 0,
}: {
  children: ReactNode;
  currentPath?: string;
  agentAuthEnabled?: boolean;
  dataMigrationEnabled?: boolean;
  stagingDemoEnabled?: boolean;
  /** Open mentor and institution requests, for the sidebar badge. */
  pendingAccessRequests?: number;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
  const links = getAdminLinks(agentAuthEnabled, dataMigrationEnabled, stagingDemoEnabled, pendingAccessRequests);

  return (
    <div className="flex min-h-screen bg-gradient-to-br from-surface to-dark">
      <a
        href={`#${MAIN_ID}`}
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-dark"
      >
        Skip to content
      </a>
      <Sidebar
        links={links}
        title="TTV Admin"
        currentPath={currentPath}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        {/*
          Mobile only. It holds the drawer trigger and the app title; on desktop
          the sidebar shows both, so this was 52px of sticky duplication. Sticky
          and opaque because the page scrolls beneath it.
        */}
        <header className="sticky top-0 z-30 flex items-center gap-4 border-b border-teal/20 bg-dark/80 px-4 py-3 backdrop-blur lg:hidden">
          <button
            type="button"
            aria-label="Open navigation"
            aria-expanded={sidebarOpen}
            disabled={!hydrated}
            onClick={() => setSidebarOpen(true)}
            className="rounded-md p-1.5 text-ink-secondary hover:text-white lg:hidden"
          >
            <PiListBold className="h-6 w-6" />
          </button>
          {/* font-body, as in the sidebar: the page's own heading is the one display line. */}
          <h1 className="font-body text-lg font-semibold text-white">TTV Admin</h1>
        </header>

        {/* Content */}
        {/* Bottom padding keeps the last control clear of the floating feedback button. */}
        <main id={MAIN_ID} tabIndex={-1} className="min-w-0 flex-1 p-4 pb-24 focus:outline-none lg:p-6 lg:pb-24">
          {children}
        </main>
      </div>
    </div>
  );
}
