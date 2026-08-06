import React, { useEffect, useState, type ReactNode } from "react";
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
} from "react-icons/pi";
import { PiListBold } from "react-icons/pi";

const primaryLinks = [
  { href: "/admin", label: "Admin Home", icon: PiGaugeDuotone },
  { href: "/admin/users", label: "Users", icon: PiUsersDuotone },
  { href: "/admin/applications", label: "Applications", icon: PiFileTextDuotone },
  { href: "/admin/profiles", label: "Profiles", icon: PiIdentificationCardDuotone },
  { href: "/admin/projects", label: "Client Projects", icon: PiBriefcaseDuotone },
  { href: "/admin/curricula", label: "Curricula", icon: PiBooksDuotone },
  { href: "/admin/programs", label: "Cohorts", icon: PiBookOpenDuotone },
  { href: "/admin/recordings", label: "Recordings", icon: PiVideoCameraDuotone },
];

export function getAdminLinks(
  agentAuthEnabled: boolean,
  dataMigrationEnabled = false
) {
  return [
    ...primaryLinks,
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
  agentAuthEnabled = false,
  dataMigrationEnabled = false,
}: {
  children: ReactNode;
  agentAuthEnabled?: boolean;
  dataMigrationEnabled?: boolean;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);
  const links = getAdminLinks(agentAuthEnabled, dataMigrationEnabled);

  return (
    <div className="flex min-h-screen bg-gradient-to-br from-[#2C6964] to-[#013D39]">
      <Sidebar
        links={links}
        title="TTV Admin"
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="flex items-center gap-4 border-b border-teal/20 px-4 py-3 lg:px-6">
          <button
            type="button"
            aria-label="Open navigation"
            disabled={!hydrated}
            onClick={() => setSidebarOpen(true)}
            className="rounded-md p-1.5 text-white/60 hover:text-white lg:hidden"
          >
            <PiListBold className="h-6 w-6" />
          </button>
          <h1 className="text-lg font-semibold text-white">TTV Admin</h1>
        </header>

        {/* Content */}
        <main className="min-w-0 flex-1 p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
