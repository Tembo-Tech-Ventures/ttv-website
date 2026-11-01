import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import SessionViewer from "./SessionViewer";

const props = { videoUrl: "/api/recordings/synthetic/video", title: "Synthetic session", segments: [] };

describe("SessionViewer", () => {
  it("titles the session with an h2 in the existing dashboard", () => {
    expect(renderToStaticMarkup(<SessionViewer {...props} />)).toMatch(/<h2 id="[^"]+" class="text-xl font-semibold text-white">Synthetic session<\/h2>/);
  });

  it("makes the title the page's h1 inside the spaces shell", () => {
    const html = renderToStaticMarkup(<SessionViewer {...props} titleAs="h1" />);
    expect(html).toMatch(/<h1 id="[^"]+" class="text-xl font-semibold text-white">Synthetic session<\/h1>/);
    expect(html).not.toContain("<h2");
  });
});
