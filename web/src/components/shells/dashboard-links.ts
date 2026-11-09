/*
 * The old dashboard's destinations, apart from its shell: Ask Tembo's immersive frame offers the
 * same links, and importing them from DashboardShell put its Sidebar and Headless UI in that island.
 */
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
import type { IconType } from "react-icons";
import type { StudentDashboardLinkId } from "@/lib/student/journey";

export interface DashboardLink {
  id: StudentDashboardLinkId | "community" | "discover";
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
  { id: "discover", href: "/dashboard/discover", label: "Discover", icon: PiSuitcaseSimpleDuotone },
  { id: "community", href: "/dashboard/community", label: "Community", icon: PiHandshakeDuotone },
  {
    id: "apply",
    href: "/dashboard/apply",
    label: "Apply",
    icon: PiPaperPlaneTiltDuotone,
    activePrefixes: ["/dashboard/application"],
  },
  { id: "sessions", href: "/dashboard/sessions", label: "Sessions", icon: PiVideoCameraDuotone },
  { id: "ask", href: "/dashboard/ask", label: "Ask Tembo", icon: PiChatCircleDotsDuotone },
  { id: "profile", href: "/dashboard/portfolio", label: "Profile", icon: PiSuitcaseSimpleDuotone },
  { id: "writing", href: "/dashboard/writing", label: "Writing", icon: PiArticleDuotone },
  { id: "opportunities", href: "/dashboard/opportunities", label: "Opportunities", icon: PiHandshakeDuotone },
  { id: "leads", href: "/dashboard/leads", label: "Leads", icon: PiTrayDuotone },
  { id: "account", href: "/dashboard/profile", label: "Account", icon: PiUserDuotone },
  { id: "logout", href: "/auth/logout", label: "Logout", icon: PiSignOutDuotone },
];

export function getDashboardLinks(
  visibleLinkIds: StudentDashboardLinkId[],
  unreadLeadCount = 0,
  demoSession = false,
  canDiscover = false,
  allowedHrefs?: readonly string[]
): DashboardLink[] {
  const visible = new Set<DashboardLink["id"]>([
    ...visibleLinkIds,
    ...(canDiscover ? ["discover" as const] : []),
    "community",
    "logout",
  ]);
  return DASHBOARD_LINKS.filter((link) => visible.has(link.id) && (!allowedHrefs || allowedHrefs.includes(link.href))).map((link) =>
    link.id === "logout" && demoSession
      ? { ...link, href: "/demo", label: "Demo controls" }
      : link.id === "leads" && unreadLeadCount > 0
      ? { ...link, badge: unreadLeadCount }
      : link
  );
}
