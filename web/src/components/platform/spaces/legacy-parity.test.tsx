import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import ChatApp from "@/components/chat/ChatApp";
import CommunityApp from "@/components/community/CommunityApp";
import DiscoveryShell, { CommunityNavigation } from "@/components/discovery/DiscoveryShell";
import SessionViewer from "@/components/recordings/SessionViewer";
import type { ChatSession } from "@/components/chat/types";

/**
 * With the spaces flag off, the components U-1.2 gave a spaces mode must
 * render exactly what they rendered before it. The files in __parity__ were
 * written from the components on main before U-1.2 (f3e716f), not from this
 * code, so any change to their default output fails here. Do not update them
 * to make a change pass: a legacy-visible change needs its own review.
 */
const VIEWS: ("journey" | "scout" | "mentor")[] = ["journey", "scout", "mentor"];
const SESSION: ChatSession = { id: "s1", title: "Synthetic session", updatedAt: 1_790_000_000, messageCount: 2, latestMessage: "In week 3." };

const cases: Record<string, () => string> = {
  "chat-empty": () => renderToStaticMarkup(<ChatApp mockMode />),
  "chat-conversation": () =>
    renderToStaticMarkup(
      <ChatApp
        mockMode
        initialSessions={[SESSION]}
        initialMessages={[{ role: "user", content: "Where did we cover testing?" }, { role: "assistant", content: "In **week 3**." }]}
        visibleLinkIds={["home", "apply", "sessions", "ask", "account", "logout"]}
        unreadLeadCount={2}
        canDiscover
      />,
    ),
  "community-journey": () => renderToStaticMarkup(<CommunityApp view="journey" />),
  "community-scout": () => renderToStaticMarkup(<CommunityApp view="scout" />),
  "community-mentor": () => renderToStaticMarkup(<CommunityApp view="mentor" />),
  "discovery-shell": () =>
    renderToStaticMarkup(
      <CommunityNavigation.Provider value={VIEWS}>
        <DiscoveryShell active="scout">
          <p>Workspace</p>
        </DiscoveryShell>
      </CommunityNavigation.Provider>,
    ),
  "discovery-shell-demo": () =>
    renderToStaticMarkup(
      <DiscoveryShell active="journey" demo>
        <p>Workspace</p>
      </DiscoveryShell>,
    ),
  "session-viewer": () =>
    renderToStaticMarkup(
      <SessionViewer
        videoUrl="/api/recordings/r1/video"
        title="Synthetic session"
        segments={[{ id: "t1", startTime: 0, endTime: 4, text: "Welcome back.", speaker: "Mentor" }]}
      />,
    ),
};

describe("existing dashboard output, spaces off", () => {
  // Relative dates in the conversation list must not drift with the clock.
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-31T12:00:00Z"));
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  for (const [name, render] of Object.entries(cases)) {
    it(`renders ${name} exactly as before U-1.2`, async () => {
      await expect(render()).toMatchFileSnapshot(`./__parity__/${name}.html`);
    });
  }
});
