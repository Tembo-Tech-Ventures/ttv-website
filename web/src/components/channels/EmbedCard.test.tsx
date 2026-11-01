import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { projects, sessionClip } from "@/lib/platform/fixtures";
import EmbedCard from "./EmbedCard";

/** The B-2.4 contract cases (U-2.2 owns the card design): link-less projects and unavailable work. */
describe("EmbedCard", () => {
  it("draws Open only for a project with an evidence link", () => {
    expect(renderToString(<EmbedCard embed={projects.chamaLedger} />)).toContain(`href="${projects.chamaLedger.link}"`);
    const linkless = renderToString(<EmbedCard embed={{ ...projects.chamaLedger, link: null }} />);
    expect(linkless).toContain(projects.chamaLedger.title);
    expect(linkless).not.toContain("<a");
  });

  it.each([
    ["project", "This project is no longer available"],
    ["sessionClip", "This session clip is no longer available"],
  ] as const)("shows unavailable %s work neutrally, with no way in", (was, text) => {
    const html = renderToString(<EmbedCard embed={{ type: "unavailable", was }} />);
    expect(html).toContain(text);
    expect(html).toContain('data-embed="unavailable"');
    expect(html).not.toContain("<a");
    expect(html).not.toContain(sessionClip.title);
  });
});
