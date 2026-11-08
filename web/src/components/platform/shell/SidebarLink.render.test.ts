import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { loadRenderers } from "astro:container";
import { getContainerRenderer } from "@astrojs/react/container-renderer";
import { beforeAll, describe, expect, it } from "vitest";
import { FOCUS_RING } from "@/components/platform/ui";
import SidebarLink from "./SidebarLink.astro";

let container: AstroContainer;

beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});

const render = (props: Record<string, unknown>) => container.renderToString(SidebarLink, { props });

describe("SidebarLink", () => {
  it("takes the kit's focus ring rather than a copy of it", async () => {
    const html = await render({ href: "/dashboard/community", label: "Home", current: true });
    for (const name of FOCUS_RING.split(" ")) expect(html).toContain(name);
    expect(html).toContain('aria-current="page"');
  });

  it("counts with the kit's CountBadge, read with what it counts", async () => {
    const html = await render({ href: "/admin/moderation", label: "Moderation", count: 3, countLabel: "waiting" });
    expect(html).toContain('data-count-badge="count"');
    expect(html).toContain("3 waiting");
  });

  it("shows a toned note as the kit's Chip, and names the link with it", async () => {
    const html = await render({ href: "/dashboard/account#taking-part-request-mentor", label: "Mentor access", note: "Pending", noteTone: "ring" });
    expect(html).toMatch(/<span data-chip="ring"[^>]*>.*Pending/s);
    expect(html).toContain('aria-label="Mentor access, Pending"');
  });

  it("keeps an untoned note as quiet words", async () => {
    const html = await render({ href: "/dashboard/cohort/sessions", label: "Sessions", note: "Not open yet" });
    expect(html).not.toContain("data-chip");
    expect(html).toContain("text-ink-muted");
  });
});
