import React, { useState, useSyncExternalStore, type ReactNode } from "react";
import Sidebar from "@/components/common/Sidebar";
import {
  PiGaugeDuotone,
  PiPaperPlaneTiltDuotone,
  PiUserDuotone,
  PiSignOutDuotone,
  PiVideoCameraDuotone,
  PiChatCircleDotsDuotone,
  PiSuitcaseSimpleDuotone,
  PiTrayDuotone,
  PiHandshakeDuotone,
  PiArticleDuotone,
} from "react-icons/pi";
import { PiListBold } from "react-icons/pi";
import type { IconType } from "react-icons";
import type { StudentDashboardLinkId } from "@/lib/student/journey";

export interface DashboardLink {
  id: StudentDashboardLinkId;
  href: string;
  label: string;
  icon: IconType;
  badge?: number;
  activePrefixes?: string[];
}

/**
 * Exported so `/dashboard/ask`, which renders its own shell, can offer the same
 * destinations instead of quietly dropping some of them.
 */
export const DASHBOARD_LINKS: DashboardLink[] = [
  { id: "home", href: "/dashboard", label: "Home", icon: PiGaugeDuotone },
  {
    id: "apply",
    href: "/dashboard/apply",
    label: "Apply",
    icon: PiPaperPlaneTiltDuotone,
    activePrefixes: ["/dashboard/application"],
  },
  { id: "sessions", href: "/dashboard/sessions", label: "Sessions", icon: PiVideoCameraDuotone },
  { id: "ask", href: "/dashboard/ask", label: "Ask AI", icon: PiChatCircleDotsDuotone },
  { id: "profile", href: "/dashboard/portfolio", label: "Profile", icon: PiSuitcaseSimpleDuotone },
  { id: "writing", href: "/dashboard/writing", label: "Writing", icon: PiArticleDuotone },
  { id: "opportunities", href: "/dashboard/opportunities", label: "Opportunities", icon: PiHandshakeDuotone },
  { id: "leads", href: "/dashboard/leads", label: "Leads", icon: PiTrayDuotone },
  { id: "account", href: "/dashboard/profile", label: "Account", icon: PiUserDuotone },
  { id: "logout", href: "/auth/logout", label: "Logout", icon: PiSignOutDuotone },
];

export function getDashboardLinks(
  visibleLinkIds: StudentDashboardLinkId[],
  unreadLeadCount = 0
): DashboardLink[] {
  const visible = new Set(visibleLinkIds);
  return DASHBOARD_LINKS.filter((link) => visible.has(link.id)).map((link) =>
    link.id === "leads" && unreadLeadCount > 0
      ? { ...link, badge: unreadLeadCount }
      : link
  );
}

export default function DashboardShell({
  children,
  currentPath,
  visibleLinkIds,
  unreadLeadCount = 0,
}: {
  children: ReactNode;
  currentPath: string;
  visibleLinkIds: StudentDashboardLinkId[];
  unreadLeadCount?: number;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
  const links = getDashboardLinks(visibleLinkIds, unreadLeadCount);

  return (
    <div className="flex min-h-screen bg-gradient-to-br from-surface to-dark">
      <Sidebar
        links={links}
        title="TTV Dashboard"
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
          <span className="text-lg font-semibold text-white">TTV Dashboard</span>
        </header>

        {/* Content */}
        <main className="min-w-0 flex-1 p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
