// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { MODERATION_PENDING_EVENT } from "./case-model";
import { followModerationBadge, setModerationBadge } from "./sidebar-badge";

/** The markup SidebarLink and CountBadge render for a counted entry. */
function sidebar(count: number | null) {
  document.body.innerHTML = `
    <nav id="space-sidebar">
      <a href="/admin/access-requests">Access requests<span data-count-badge="count"><span aria-hidden="true">2</span><span class="sr-only">2 pending</span></span></a>
      <a href="/admin/moderation">Moderation${count === null ? "" : `<span data-count-badge="count"><span aria-hidden="true">${count}</span><span class="sr-only">${count} waiting</span></span>`}</a>
    </nav>`;
  return document.querySelector<HTMLElement>('a[href="/admin/moderation"] [data-count-badge]');
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("the Admin space's Moderation badge", () => {
  it("follows the queue's count after an in-place decision, with the request notes added", () => {
    const badge = sidebar(5);
    const stop = followModerationBadge(document, 2);
    document.dispatchEvent(new CustomEvent(MODERATION_PENDING_EVENT, { detail: 1 }));
    expect(badge?.textContent).toBe("33 waiting");
    expect(badge?.hidden).toBe(false);
    stop();
    document.dispatchEvent(new CustomEvent(MODERATION_PENDING_EVENT, { detail: 0 }));
    expect(badge?.querySelector("[aria-hidden='true']")?.textContent).toBe("3");
  });

  it("hides at zero, caps the number shown, and never touches another entry's badge", () => {
    const badge = sidebar(1);
    setModerationBadge(document, 0);
    expect(badge?.hidden).toBe(true);
    setModerationBadge(document, 150);
    expect(badge?.hidden).toBe(false);
    expect(badge?.textContent).toBe("99+150 waiting");
    expect(document.querySelector('a[href="/admin/access-requests"]')?.textContent).toBe("Access requests22 pending");
  });

  it("ignores anything but a whole, non-negative count", () => {
    const badge = sidebar(4);
    followModerationBadge(document, 0);
    for (const detail of ["3", -1, 1.5, null]) document.dispatchEvent(new CustomEvent(MODERATION_PENDING_EVENT, { detail }));
    expect(badge?.textContent).toBe("44 waiting");
  });

  it("leaves a badge the server did not draw absent", () => {
    sidebar(null);
    expect(setModerationBadge(document, 2)).toBe(false);
    expect(document.querySelector("[data-count-badge]")?.closest("a")?.getAttribute("href")).toBe("/admin/access-requests");
  });
});
