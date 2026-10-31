import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import CommunityApp from "./CommunityApp";

describe("CommunityApp", () => {
  it("keeps its own frame on its own", () => {
    const html = renderToStaticMarkup(<CommunityApp view="journey" />);
    expect(html).toContain("Loading your workspace");
    expect(html).toContain("Dashboard ↗");
  });

  it("drops its frame inside the spaces shell, so there is no link back to the page it is on", () => {
    const html = renderToStaticMarkup(<CommunityApp view="journey" embedded />);
    expect(html).toContain("Loading your workspace");
    expect(html).toContain("data-embedded");
    expect(html).not.toContain("Dashboard ↗");
  });
});
