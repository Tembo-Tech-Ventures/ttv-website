import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import SessionViewer from "./SessionViewer";

const props = { videoUrl: "/api/recordings/synthetic/video", labelledBy: "session-title", segments: [] };

describe("SessionViewer", () => {
  it("names the video by the page's h1 and renders no h1 of its own", () => {
    const html = renderToStaticMarkup(<SessionViewer {...props} />);
    expect(html).toContain('aria-labelledby="session-title"');
    expect(html).not.toContain("<h1");
  });

  it("holds the player in a 16:9 box on the ground tone, not black", () => {
    const html = renderToStaticMarkup(<SessionViewer {...props} />);
    expect(html).toMatch(/class="relative aspect-video [^"]*bg-ground"/);
    expect(html).not.toMatch(/bg-black|text-white|border-white|outline-primary/);
  });

  it("starts the video at ?t= with a media fragment, which needs no script", () => {
    expect(renderToStaticMarkup(<SessionViewer {...props} initialTime={75} />)).toContain('src="/api/recordings/synthetic/video#t=75"');
    expect(renderToStaticMarkup(<SessionViewer {...props} />)).toContain('src="/api/recordings/synthetic/video"');
  });
});
