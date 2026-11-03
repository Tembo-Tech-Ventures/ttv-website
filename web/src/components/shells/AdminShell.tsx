import React, { useEffect, useSyncExternalStore, useState, type ReactNode } from "react";
import { MODERATION_PENDING_EVENT } from "@/components/admin/moderation/case-model";
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
  PiShieldCheckDuotone,
} from "react-icons/pi";
import { PiListBold } from "react-icons/pi";
import type { IconType } from "react-icons";
import { adminNavEntries, type AdminNavKey } from "@/components/admin/admin-nav";

const MAIN_ID = "admin-main";

const ICONS: Record<AdminNavKey, IconType> = {
  back: PiArrowLeftDuotone,
  home: PiGaugeDuotone,
  accessRequests: PiUserPlusDuotone,
  moderation: PiShieldCheckDuotone,
  users: PiUsersDuotone,
  applications: PiFileTextDuotone,
  profiles: PiIdentificationCardDuotone,
  feedback: PiChatTeardropTextDuotone,
  projects: PiBriefcaseDuotone,
  curricula: PiBooksDuotone,
  cohorts: PiBookOpenDuotone,
  recordings: PiVideoCameraDuotone,
  integrations: PiPlugsDuotone,
  flags: PiToggleRightDuotone,
  tokens: PiKeyDuotone,
  demo: PiUsersDuotone,
  migration: PiDatabaseDuotone,
  agentAccess: PiKeyDuotone,
  logout: PiSignOutDuotone,
};

/**
 * The existing admin shell's links (admin-nav.ts, with this shell's icons). pendingModeration is
 * null while the `channels` flag is off for this administrator: there is no moderation queue to
 * link to until channels exist for them.
 */
export function getAdminLinks(
  agentAuthEnabled: boolean,
  dataMigrationEnabled = false,
  stagingDemoEnabled = false,
  pendingAccessRequests = 0,
  pendingModeration: number | null = null
) {
  return adminNavEntries({ agentAuthEnabled, dataMigrationEnabled, stagingDemoEnabled, pendingAccessRequests, pendingModeration })
    .map(({ key, ...link }) => ({ ...link, icon: ICONS[key] }));
}

export default function AdminShell({
  children,
  currentPath = "/admin",
  agentAuthEnabled = false,
  dataMigrationEnabled = false,
  stagingDemoEnabled = false,
  pendingAccessRequests = 0,
  pendingModeration = null,
  pendingRequestNotes = 0,
}: {
  children: ReactNode;
  currentPath?: string;
  agentAuthEnabled?: boolean;
  dataMigrationEnabled?: boolean;
  stagingDemoEnabled?: boolean;
  /** Open mentor and institution requests, for the sidebar badge. */
  pendingAccessRequests?: number;
  /** Moderation cases waiting for a decision, or null while `channels` is off. */
  pendingModeration?: number | null;
  /**
   * Open checks on request notes this admin may decide (0 while `mentor_requests` is off), counted on
   * the Moderation badge too: they wait under its "Request notes" tab (QA4-04).
   */
  pendingRequestNotes?: number;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
  // A decision made without a page load swaps the queue in place; it reports the new waiting count.
  const [waiting, setWaiting] = useState(pendingModeration);
  useEffect(() => {
    if (pendingModeration === null) return;
    const onPending = (event: Event) => {
      const count = (event as CustomEvent<unknown>).detail;
      if (typeof count === "number") setWaiting(count);
    };
    document.addEventListener(MODERATION_PENDING_EVENT, onPending);
    return () => document.removeEventListener(MODERATION_PENDING_EVENT, onPending);
  }, [pendingModeration]);
  // The queue's in-place count is the message cases' alone, so the request notes are added here.
  const links = getAdminLinks(
    agentAuthEnabled, dataMigrationEnabled, stagingDemoEnabled, pendingAccessRequests,
    waiting === null ? null : waiting + pendingRequestNotes
  );

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
