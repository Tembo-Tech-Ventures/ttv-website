import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import DiscoveryShell, { CommunityEmbedded, CommunityNavigation } from "./DiscoveryShell";

const VIEWS: ("journey" | "mentor")[] = ["journey", "mentor"];

function render(embedded: boolean) {
  return renderToStaticMarkup(
    <CommunityEmbedded.Provider value={embedded}>
      <CommunityNavigation.Provider value={VIEWS}>
        <DiscoveryShell active="journey">
          <p>Workspace</p>
        </DiscoveryShell>
      </CommunityNavigation.Provider>
    </CommunityEmbedded.Provider>,
  );
}

describe("DiscoveryShell", () => {
  it("frames the workspace with its own header, navigation and footer on its own", () => {
    const html = render(false);
    expect(html).toContain('aria-label="Community navigation"');
    expect(html).toContain("Dashboard ↗");
    expect(html).toContain("<main");
    expect(html).toContain("discovery-footer");
  });

  it("renders only the workspace inside the spaces shell, which has the navigation and main landmark", () => {
    const html = render(true);
    expect(html).toContain("<p>Workspace</p>");
    expect(html).toContain("data-embedded");
    // No second brand, no way "back" that leads to the same page, no nested main.
    expect(html).not.toContain("Dashboard ↗");
    expect(html).not.toContain("Community navigation");
    expect(html).not.toContain("<main");
    expect(html).not.toContain("discovery-skip");
    expect(html).not.toContain("discovery-footer");
    // Nothing links to a skip target here: the shell's own skip link goes to its main landmark.
    expect(html).not.toContain('id="main-content"');
  });
});
