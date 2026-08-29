import React, { useEffect, useState, type ReactNode } from "react";
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
} from "react-icons/pi";
import { PiListBold } from "react-icons/pi";

/**
 * Exported so `/dashboard/ask`, which renders its own shell, can offer the same
 * destinations instead of quietly dropping some of them.
 */
export const DASHBOARD_LINKS = [
  { href: "/dashboard", label: "Dashboard", icon: PiGaugeDuotone },
  { href: "/dashboard/sessions", label: "Sessions", icon: PiVideoCameraDuotone },
  { href: "/dashboard/ask", label: "Ask AI", icon: PiChatCircleDotsDuotone },
  { href: "/dashboard/apply", label: "Apply", icon: PiPaperPlaneTiltDuotone },
  { href: "/dashboard/portfolio", label: "Portfolio", icon: PiSuitcaseSimpleDuotone },
  { href: "/dashboard/leads", label: "Leads", icon: PiTrayDuotone },
  { href: "/dashboard/opportunities", label: "Opportunities", icon: PiHandshakeDuotone },
  { href: "/dashboard/profile", label: "Profile", icon: PiUserDuotone },
  { href: "/auth/logout", label: "Logout", icon: PiSignOutDuotone },
];

export default function DashboardShell({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  return (
    <div className="flex min-h-screen bg-gradient-to-br from-[#2C6964] to-[#013D39]">
      <Sidebar
        links={DASHBOARD_LINKS}
        title="TTV Dashboard"
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
            className="rounded-md p-1.5 text-white/60 hover:text-white lg:hidden"
          >
            <PiListBold className="h-6 w-6" />
          </button>
          <h1 className="text-lg font-semibold text-white">TTV Dashboard</h1>
        </header>

        {/* Content */}
        <main className="min-w-0 flex-1 p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
