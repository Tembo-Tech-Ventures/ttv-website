import { useState, type ReactNode } from "react";
import Sidebar from "@/components/common/Sidebar";
import {
  PiGaugeDuotone,
  PiUsersDuotone,
  PiFileTextDuotone,
  PiBookOpenDuotone,
  PiSignOutDuotone,
} from "react-icons/pi";
import { PiListBold } from "react-icons/pi";

const links = [
  { href: "/admin", label: "Admin Home", icon: PiGaugeDuotone },
  { href: "/admin/users", label: "Users", icon: PiUsersDuotone },
  { href: "/admin/applications", label: "Applications", icon: PiFileTextDuotone },
  { href: "/admin/programs", label: "Programs", icon: PiBookOpenDuotone },
  { href: "/auth/logout", label: "Logout", icon: PiSignOutDuotone },
];

export default function AdminShell({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-gradient-to-br from-[#2C6964] to-[#013D39]">
      <Sidebar
        links={links}
        title="TTV Admin"
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="flex flex-1 flex-col">
        {/* Top bar */}
        <header className="flex items-center gap-4 border-b border-teal/20 px-4 py-3 lg:px-6">
          <button
            onClick={() => setSidebarOpen(true)}
            className="rounded-md p-1.5 text-white/60 hover:text-white lg:hidden"
          >
            <PiListBold className="h-6 w-6" />
          </button>
          <h1 className="text-lg font-semibold text-white">TTV Admin</h1>
        </header>

        {/* Content */}
        <main className="flex-1 p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
