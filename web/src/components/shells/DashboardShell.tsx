import React, { useState, useSyncExternalStore, type ReactNode } from "react";
import Sidebar from "@/components/common/Sidebar";
import { PiListBold } from "react-icons/pi";
import type { StudentDashboardLinkId } from "@/lib/student/journey";
import { getDashboardLinks } from "./dashboard-links";

export default function DashboardShell({
  children,
  currentPath,
  visibleLinkIds,
  unreadLeadCount = 0,
  demoSession = false,
  canDiscover = false,
  allowedHrefs,
}: {
  children: ReactNode;
  currentPath: string;
  visibleLinkIds: StudentDashboardLinkId[];
  unreadLeadCount?: number;
  demoSession?: boolean;
  canDiscover?: boolean;
  allowedHrefs?: string[];
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
  const links = getDashboardLinks(visibleLinkIds, unreadLeadCount, demoSession, canDiscover, allowedHrefs);

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
        {/* Bottom padding keeps the last control clear of the floating feedback button. */}
        <main className="min-w-0 flex-1 p-4 pb-24 lg:p-6 lg:pb-24">{children}</main>
      </div>
    </div>
  );
}
