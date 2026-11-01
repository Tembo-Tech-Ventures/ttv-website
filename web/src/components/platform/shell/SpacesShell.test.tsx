// @vitest-environment happy-dom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Me } from "@/lib/platform/contracts";
import { meByPersona } from "@/lib/platform/fixtures";
import { OPEN_FEEDBACK_EVENT } from "@/components/feedback/feedback-client";
import { SHELL_OVERLAY_EVENT, type ShellOverlayRequest } from "./overlays";
import SpacesShell from "./SpacesShell";

type Props = ComponentProps<typeof SpacesShell>;

const LINK_OUT: Props["account"] = { signOut: { kind: "link", href: "/auth/logout", label: "Sign out" }, feedback: true };

function props(overrides: Partial<Props> = {}): Props {
  return {
    me: meByPersona.david,
    space: "mentoring",
    lastSpace: null,
    heading: "Requests",
    account: LINK_OUT,
    persistPreference: false,
    sidebar: (
      <nav aria-label="Mentoring pages">
        <a href="#requests">Requests</a>
        <a href="#availability">Availability</a>
      </nav>
    ),
    children: <h1>Requests</h1>,
    ...overrides,
  };
}

type HappyDOM = { setURL(next: string): void; setViewport(size: { width: number; height: number }): void };
const happyDOM = () => (window as unknown as { happyDOM: HappyDOM }).happyDOM;

/** happy-dom's own control surface, for putting the page under /dashboard. */
function setURL(url: string) {
  happyDOM().setURL(url);
}

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function mount(overrides: Partial<Props> = {}) {
  await act(async () => root.render(<SpacesShell {...props(overrides)} />));
  return container;
}

function q<T extends Element = HTMLElement>(selector: string): T {
  const element = container.querySelector<T>(selector);
  if (!element) throw new Error(`No ${selector}`);
  return element;
}

describe("SpacesShell on the server", () => {
  it("shows the person's spaces in order, Profile last, with the page's own as current", () => {
    const html = renderToString(<SpacesShell {...props()} />);
    const tabs = [...html.matchAll(/class="space-tab" data-space="([a-z]+)"/g)].map((match) => match[1]);
    expect(tabs).toEqual(["cohort", "community", "mentoring", "profile"]);
    expect(html.match(/aria-current="page"/g)).toHaveLength(2); // the tab and the bottom-bar item
    expect(html).toContain('data-space-file="mentoring"');
  });

  it("names the page for the phone's top bar and links past the chrome", () => {
    const html = renderToString(<SpacesShell {...props()} />);
    expect(html).toContain('<p class="spaces-shell__heading">Requests</p>');
    expect(html).toContain('href="#spaces-main"');
    expect(html).toContain('<main id="spaces-main" tabindex="0"');
  });

  it("works without JavaScript: the menu link jumps to the sidebar it opens", () => {
    const html = renderToString(<SpacesShell {...props()} />);
    expect(html).toContain('href="#space-sidebar" aria-controls="space-sidebar" aria-expanded="false" aria-label="Open Mentoring menu"');
    expect(html).toContain('<aside id="space-sidebar" aria-label="Mentoring menu" tabindex="-1"');
  });

  it("has no menu button or drawer when the space has no sidebar", () => {
    const html = renderToString(<SpacesShell {...props({ sidebar: undefined })} />);
    expect(html).not.toContain("space-sidebar");
    expect(html).not.toContain("data-sidebar");
  });

  it("puts each space's waiting count on its tab and its bottom-bar item", () => {
    const html = renderToString(<SpacesShell {...props()} />);
    // David: mentoring 2, community 1.
    expect(html.match(/2 new/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html.match(/1 new/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("shows no role chips at all for a person without role badges", () => {
    const me: Me = { ...meByPersona.brian, user: { ...meByPersona.brian.user, roleBadges: [] } };
    const html = renderToString(<SpacesShell {...props({ me, space: "cohort" })} />);
    expect(html).not.toContain("data-role-badge");
    expect(html).toContain("Brian Kiprop");
  });

  it("shows the person's role badges beside their name", () => {
    const html = renderToString(<SpacesShell {...props()} />);
    expect(html).toContain('data-role-badge="MENTOR"');
    expect(html).toContain('data-role-badge="ALUMNI"');
  });

  it("offers no space at all while the spaces flag is off", () => {
    const me: Me = { ...meByPersona.david, flags: { ...meByPersona.david.flags, spaces: false } };
    const html = renderToString(<SpacesShell {...props({ me })} />);
    expect(html).not.toContain('class="space-tab"');
    expect(html).not.toContain("spaces-bottom__item");
  });

  it("serialises nothing but the contract: no cookie or session in the markup", () => {
    const html = renderToString(<SpacesShell {...props({ lastSpace: "community" })} />);
    expect(html).not.toMatch(/cookie|session|token/i);
  });
});

describe("SpacesShell overlay triggers", () => {
  it("shows no search or bell unless the page mounts their overlays", async () => {
    await mount();
    expect(container.querySelector('[aria-label^="Search"]')).toBeNull();
    expect(container.querySelector('[aria-label^="Attention"]')).toBeNull();
  });

  it("asks for search by click and by Ctrl K, and for attention from the bell", async () => {
    const requests: ShellOverlayRequest[] = [];
    const listen = (event: Event) => requests.push((event as CustomEvent<ShellOverlayRequest>).detail);
    window.addEventListener(SHELL_OVERLAY_EVENT, listen);
    await mount({ overlays: ["search", "attention"] });

    const search = q<HTMLButtonElement>('[aria-label="Search, Ctrl K"]');
    const bell = q<HTMLButtonElement>('[aria-label="Attention, 3 waiting"]');
    await act(async () => search.click());
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, cancelable: true }));
    });
    await act(async () => bell.click());

    expect(requests).toEqual([
      { overlay: "search", trigger: search, via: "click" },
      { overlay: "search", trigger: search, via: "shortcut" },
      { overlay: "attention", trigger: bell, via: "click" },
    ]);
    window.removeEventListener(SHELL_OVERLAY_EVENT, listen);
  });

  it("names the search button with the words and keys it shows (WCAG 2.5.3)", async () => {
    await mount({ overlays: ["search"] });
    const search = q<HTMLButtonElement>("button.spaces-search");
    const shown = search.querySelector(".spaces-search__words")?.textContent;
    expect(shown).toBe("Search Ctrl K");
    expect(search.getAttribute("aria-label")).toBe("Search, Ctrl K");
  });

  it("stops listening for the shortcut when it unmounts", async () => {
    const listen = vi.fn();
    window.addEventListener(SHELL_OVERLAY_EVENT, listen);
    await mount({ overlays: ["search"] });
    await act(async () => root.unmount());
    root = createRoot(container);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
    expect(listen).not.toHaveBeenCalled();
    window.removeEventListener(SHELL_OVERLAY_EVENT, listen);
  });
});

describe("SpacesShell drawer", () => {
  it("opens as a modal dialog over an unreachable background, and closes with Escape", async () => {
    await mount();
    const trigger = q<HTMLAnchorElement>('[aria-controls="space-sidebar"]');
    await act(async () => trigger.click());

    const drawer = q("#space-sidebar");
    expect(q(".spaces-shell").dataset.drawer).toBe("open");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(drawer.getAttribute("role")).toBe("dialog");
    expect(drawer.getAttribute("aria-modal")).toBe("true");
    for (const behind of [".space-file__row", "#spaces-main", ".spaces-bottom"]) {
      expect(q(behind).hasAttribute("inert")).toBe(true);
    }
    expect(window.location.hash).not.toBe("#space-sidebar");

    await act(async () => {
      drawer.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    expect(q(".spaces-shell").dataset.drawer).toBe("closed");
    expect(drawer.hasAttribute("role")).toBe(false);
    for (const behind of [".space-file__row", "#spaces-main", ".spaces-bottom"]) {
      expect(q(behind).hasAttribute("inert")).toBe(false);
    }
  });

  it("closes when a link in it is followed, from its close button, or from the scrim", async () => {
    await mount();
    const trigger = q<HTMLAnchorElement>('[aria-controls="space-sidebar"]');
    const isOpen = () => q(".spaces-shell").dataset.drawer === "open";

    await act(async () => trigger.click());
    await act(async () => q<HTMLAnchorElement>('#space-sidebar a[href="#availability"]').click());
    expect(isOpen()).toBe(false);

    await act(async () => trigger.click());
    await act(async () => q<HTMLAnchorElement>("[data-drawer-close]").click());
    expect(isOpen()).toBe(false);

    await act(async () => trigger.click());
    await act(async () => q(".spaces-shell__scrim").click());
    expect(isOpen()).toBe(false);
  });
});

describe("SpacesShell account menu", () => {
  const items = (scope: HTMLElement) =>
    Array.from(scope.querySelectorAll(".spaces-account__panel li > a, .spaces-account__panel li button")).map((item) =>
      item.textContent?.trim(),
    );

  it("works before and without JavaScript: Account and Sign out are links in the page", () => {
    const html = renderToString(<SpacesShell {...props()} />);
    const host = document.createElement("div");
    host.innerHTML = html;
    expect(host.querySelector("details.spaces-account > summary")?.getAttribute("aria-label")).toBe("Account menu, David Kamau, DK");
    // Feedback needs the widget, which needs JavaScript, so it is not offered yet.
    expect(items(host)).toEqual(["Account", "Sign out"]);
    expect(host.querySelector('.spaces-account__panel a[href="/dashboard/account"]')).not.toBeNull();
    expect(host.querySelector('.spaces-account__panel a[href="/auth/logout"]')).not.toBeNull();
  });

  it("offers Feedback once hydrated, which opens the form and closes the menu", async () => {
    const opened = vi.fn();
    window.addEventListener(OPEN_FEEDBACK_EVENT, opened);
    await mount();
    const details = q<HTMLDetailsElement>("details.spaces-account");
    details.open = true;
    expect(items(container)).toEqual(["Account", "Feedback", "Sign out"]);
    await act(async () => q<HTMLButtonElement>(".spaces-account__panel button").click());
    expect(opened).toHaveBeenCalledTimes(1);
    expect(details.open).toBe(false);
    // Focus waits on the avatar, so the form can return it there.
    expect(document.activeElement).toBe(q("details.spaces-account > summary"));
    window.removeEventListener(OPEN_FEEDBACK_EVENT, opened);
  });

  it("leaves Feedback out where the widget is not mounted", async () => {
    await mount({ account: { ...LINK_OUT, feedback: false } });
    expect(items(container)).toEqual(["Account", "Sign out"]);
  });

  it("closes on Escape with focus back on the avatar, and on a click elsewhere", async () => {
    await mount();
    const details = q<HTMLDetailsElement>("details.spaces-account");
    details.open = true;
    q<HTMLAnchorElement>('.spaces-account__panel a[href="/dashboard/account"]').focus();
    details.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(details.open).toBe(false);
    expect(document.activeElement).toBe(q("details.spaces-account > summary"));

    details.open = true;
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(details.open).toBe(false);
  });

  it("forgets this tab's unsent onboarding requests when signing out, by link or by form", async () => {
    for (const account of [LINK_OUT, { signOut: { kind: "form", action: "/api/qa/logout", label: "Sign out of this QA persona" }, feedback: false }] as const) {
      sessionStorage.setItem("ttv-onboarding-drafts:someone", JSON.stringify({ MENTOR: { note: "Unsent", link: "" } }));
      await mount({ account });
      const control = q<HTMLElement>("[data-shell-sign-out]");
      // The sign-out navigation itself is the browser's; only the clearing is checked here.
      if (control instanceof HTMLFormElement) {
        await act(async () => control.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
      } else {
        control.addEventListener("click", (event) => event.preventDefault(), { once: true });
        await act(async () => control.click());
      }
      expect(sessionStorage.getItem("ttv-onboarding-drafts:someone")).toBeNull();
      await act(async () => root.unmount());
      root = createRoot(container);
    }
  });

  it("signs a QA persona out with a POST to its own endpoint, without JavaScript too", () => {
    const html = renderToString(
      <SpacesShell
        {...props({ account: { signOut: { kind: "form", action: "/api/qa/logout", label: "Sign out of this QA persona" }, feedback: false } })}
      />,
    );
    const host = document.createElement("div");
    host.innerHTML = html;
    const form = host.querySelector<HTMLFormElement>(".spaces-account__panel form");
    expect(form?.getAttribute("method")).toBe("post");
    expect(form?.getAttribute("action")).toBe("/api/qa/logout");
    expect(form?.querySelector('button[type="submit"]')?.textContent?.trim()).toBe("Sign out of this QA persona");
  });
});

describe("SpacesShell hydration handoff", () => {
  it("adopts a drawer opened by its no-JS link before hydration, and can then close it", async () => {
    happyDOM().setViewport({ width: 390, height: 844 });
    setURL("https://ttv.test/dashboard/mentoring#space-sidebar");
    await mount();
    const shell = q(".spaces-shell");
    expect(shell.hasAttribute("data-hydrated")).toBe(true);
    expect(shell.dataset.drawer).toBe("open");
    expect(q("#space-sidebar").getAttribute("role")).toBe("dialog");
    // The fragment is dropped, so the stylesheet's no-JS rule can no longer pin it open.
    expect(window.location.hash).toBe("");
    await act(async () => q("#space-sidebar").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(shell.dataset.drawer).toBe("closed");
  });

  it("on a wide screen drops the fragment without opening anything: the sidebar is already in the sheet", async () => {
    happyDOM().setViewport({ width: 1440, height: 900 });
    setURL("https://ttv.test/dashboard/mentoring#space-sidebar");
    await mount();
    const shell = q(".spaces-shell");
    expect(shell.dataset.drawer).toBe("closed");
    expect(q("#space-sidebar").hasAttribute("role")).toBe(false);
    expect(q("#spaces-main").hasAttribute("inert")).toBe(false);
    expect(window.location.hash).toBe("");
  });

  it("is marked hydrated only after hydration, so the no-JS rules apply until then", () => {
    expect(renderToString(<SpacesShell {...props()} />)).not.toContain("data-hydrated");
  });
});

describe("SpacesShell space preference", () => {
  it("remembers a space chosen from the tabs, for the server's next default", async () => {
    setURL("https://ttv.test/dashboard/mentoring");
    document.cookie = "ttv-last-space=; Path=/dashboard; Max-Age=0";
    const stay = (event: Event) => event.preventDefault();
    document.addEventListener("click", stay);
    await mount({ persistPreference: true });

    await act(async () => q<HTMLAnchorElement>('.space-file__nav [data-space="community"] a').click());
    expect(document.cookie).toContain("ttv-last-space=community");

    await act(async () => q<HTMLAnchorElement>('.spaces-bottom [data-space="profile"] a').click());
    expect(document.cookie).toContain("ttv-last-space=profile");
    document.removeEventListener("click", stay);
  });

  it("never remembers Admin, so /dashboard and Admin's way back do not lead back to Admin", async () => {
    setURL("https://ttv.test/dashboard/community");
    document.cookie = "ttv-last-space=community; Path=/dashboard";
    const stay = (event: Event) => event.preventDefault();
    document.addEventListener("click", stay);
    await mount({ me: meByPersona.amina, space: "community", persistPreference: true });
    await act(async () => q<HTMLAnchorElement>('.space-file__nav [data-space="admin"] a').click());
    expect(document.cookie).toContain("ttv-last-space=community");
    document.removeEventListener("click", stay);

    // An admin-context page (the mentor review inside Admin) does not save Admin either.
    await act(async () => root.unmount());
    root = createRoot(container);
    setURL("https://ttv.test/dashboard/mentoring/confirm");
    await mount({ me: meByPersona.amina, space: "admin", persistPreference: true });
    expect(document.cookie).toContain("ttv-last-space=community");
    expect(document.cookie).not.toContain("ttv-last-space=admin");
  });

  it("writes nothing from a fixture harness", async () => {
    setURL("https://ttv.test/dashboard/mentoring");
    document.cookie = "ttv-last-space=; Path=/dashboard; Max-Age=0";
    const stay = (event: Event) => event.preventDefault();
    document.addEventListener("click", stay);
    await mount({ persistPreference: false });
    await act(async () => q<HTMLAnchorElement>('.space-file__nav [data-space="community"] a').click());
    expect(document.cookie).not.toContain("ttv-last-space=community");
    document.removeEventListener("click", stay);
  });
});

describe("SpacesShell names hold the words they show (WCAG 2.5.3)", () => {
  it("names the TEMBO mark with its visible words, kept apart as words", async () => {
    await mount();
    const brand = q<HTMLAnchorElement>("a.spaces-shell__brand");
    expect(brand.getAttribute("aria-label")).toBe("Tembo Tech Ventures home");
    // Read as a voice user sees it: "TEMBO Tech · Ventures", never "TEMBOTech".
    expect(brand.textContent?.replace(/\s+/g, " ").trim()).toBe("TEMBO Tech · Ventures");
  });

  it("ends the account menu's name with the initials its avatar shows, and leaves them out behind a photo", async () => {
    await mount();
    const summary = q("details.spaces-account > summary");
    expect(summary.textContent).toBe("DK");
    expect(summary.getAttribute("aria-label")).toBe("Account menu, David Kamau, DK");

    const photo: Me = { ...meByPersona.david, user: { ...meByPersona.david.user, avatarUrl: "https://avatars.example/david.png" } };
    await mount({ me: photo });
    expect(q("details.spaces-account > summary").textContent).toBe("");
    expect(q("details.spaces-account > summary").getAttribute("aria-label")).toBe("Account menu, David Kamau");
  });
});

describe("SpacesShell bell: shared work waiting for confirmation (QA1R-03)", () => {
  const quiet = { cohort: 0, community: 0, mentoring: 0, discover: 0, admin: 0, profile: 0 };
  const mentor = (awaiting: number | undefined, unreadCounts: Me["unreadCounts"] = quiet): Me => {
    const { mentoring: _omitted, ...rest } = meByPersona.david;
    return { ...rest, unreadCounts, ...(awaiting === undefined ? {} : { mentoring: { awaitingConfirmation: awaiting } }) };
  };
  const bell = () => q<HTMLButtonElement>('button[aria-label^="Attention"]');

  it("shows a dot and names the work when nothing is unread", async () => {
    await mount({ me: mentor(4), overlays: ["attention"] });
    expect(bell().getAttribute("aria-label")).toBe("Attention, 4 shared contributions to confirm");
    expect(bell().querySelector('[data-count-badge="dot"]')).not.toBeNull();
    expect(bell().querySelector('[data-count-badge="count"]')).toBeNull();
  });

  it("keeps the unread count on the badge and adds the work to the name", async () => {
    await mount({ me: mentor(1, { ...quiet, mentoring: 2, community: 1 }), overlays: ["attention"] });
    expect(bell().getAttribute("aria-label")).toBe("Attention, 3 waiting, 1 shared contribution to confirm");
    expect(bell().querySelector('[data-count-badge="count"]')?.textContent).toContain("3");
    expect(bell().querySelector('[data-count-badge="dot"]')).toBeNull();
  });

  it.each([
    ["unknown", undefined],
    ["none", 0],
  ])("says nothing when the count is %s, and never shows a 0", async (_state, awaiting) => {
    await mount({ me: mentor(awaiting), overlays: ["attention"] });
    expect(bell().getAttribute("aria-label")).toBe("Attention");
    expect(bell().querySelector("[data-count-badge]")).toBeNull();
    expect(bell().textContent).not.toMatch(/\d/);
  });

  it("gives nobody without the Mentoring space a confirmation signal", async () => {
    await mount({ me: { ...meByPersona.wanjiku, unreadCounts: quiet }, space: "community", overlays: ["attention"] });
    expect(bell().getAttribute("aria-label")).toBe("Attention");
  });
});

// Last in the file: published counts are page-wide state, as they are in a browser.
describe("SpacesShell live attention counts", () => {
  it("follows the attention overlay's published counts on the bell and tabs, only when it is mounted", async () => {
    const { publishAttentionCounts } = await import("./overlays");
    await mount({ overlays: ["search"] });
    publishAttentionCounts({ cohort: 0, community: 4, mentoring: 1, discover: 0, admin: 0, profile: 0 });
    // Without the attention overlay nothing publishes for this page, so Me's counts stand.
    expect(container.querySelector('[data-space="community"]')?.textContent).toContain("1 new");

    await mount({ overlays: ["search", "attention"] });
    expect(q('[aria-label="Attention, 5 waiting"]')).toBeTruthy();
    expect(container.querySelector('[data-space="community"]')?.textContent).toContain("4 new");
    await act(async () => publishAttentionCounts({ cohort: 0, community: 0, mentoring: 0, discover: 0, admin: 0, profile: 0 }));
    expect(q('[aria-label="Attention"]')).toBeTruthy();
  });
});

describe("SpacesShell last-space landing hint", () => {
  function navigation(redirectCount: number) {
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([{ redirectCount } as unknown as PerformanceEntry]);
  }

  beforeEach(() => {
    sessionStorage.clear();
    setURL("https://ttv.test/dashboard/mentoring");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const hint = () => container.querySelector(".spaces-shell__landing output")?.textContent ?? null;

  it("says /dashboard reopened the space used last, once per session, and can be dismissed", async () => {
    navigation(1);
    await mount({ persistPreference: true, lastSpace: "mentoring" });
    expect(hint()).toBe("You’re in Mentoring, the space you used last. Switch any time from the tabs.");

    const dismiss = q<HTMLButtonElement>('.spaces-shell__landing button[aria-label="Dismiss"]');
    await act(async () => dismiss.click());
    expect(hint()).toBeNull();
    expect(document.activeElement).toBe(q("#spaces-main"));

    // The next landing in the same session stays quiet.
    await act(async () => root.unmount());
    root = createRoot(container);
    await mount({ persistPreference: true, lastSpace: "mentoring" });
    expect(hint()).toBeNull();
  });

  it("keeps an empty status region in place, so the hint is announced when it appears", async () => {
    navigation(0);
    await mount({ persistPreference: true, lastSpace: "mentoring" });
    expect(container.querySelector("#spaces-main output")).not.toBeNull();
    expect(hint()).toBeNull();
  });

  it("stays quiet for a tab choice, a reload, a deeper page or a fixture harness", async () => {
    for (const [overrides, url, redirects] of [
      [{ lastSpace: "community" as const }, "https://ttv.test/dashboard/mentoring", 1], // chosen from another space's tab
      [{ lastSpace: "mentoring" as const }, "https://ttv.test/dashboard/mentoring", 0], // a reload or a direct link
      [{ lastSpace: "mentoring" as const }, "https://ttv.test/dashboard/mentoring/confirm", 1], // a legacy URL's redirect
    ] as const) {
      navigation(redirects);
      setURL(url);
      await act(async () => root.unmount());
      root = createRoot(container);
      await mount({ persistPreference: true, ...overrides });
      expect({ url, hint: hint() }).toEqual({ url, hint: null });
    }
    await act(async () => root.unmount());
    root = createRoot(container);
    navigation(1);
    setURL("https://ttv.test/dashboard/mentoring");
    await mount({ persistPreference: false, lastSpace: "mentoring" });
    expect(hint()).toBeNull();
  });
});

describe("SpacesShell leaving the shell", () => {
  function swap(url: string | null) {
    const skipTransition = vi.fn();
    const event = Object.assign(new Event("pageswap"), {
      viewTransition: { skipTransition },
      activation: url ? { entry: { url } } : null,
    });
    window.dispatchEvent(event);
    return skipTransition;
  }

  it("skips the sheet transition for a page outside the shell, which cannot finish it", async () => {
    setURL("https://ttv.test/dashboard/mentoring");
    await mount();
    expect(swap("https://ttv.test/admin")).toHaveBeenCalledOnce();
    expect(swap("https://ttv.test/community/members")).toHaveBeenCalledOnce();
    expect(swap(null)).toHaveBeenCalledOnce();
  });

  it("keeps it between space pages, and on the same page", async () => {
    setURL("https://ttv.test/dev/platform-shell?space=mentoring");
    await mount();
    expect(swap("https://ttv.test/dashboard/community")).not.toHaveBeenCalled();
    expect(swap("https://ttv.test/dashboard/me/portfolio")).not.toHaveBeenCalled();
    expect(swap("https://ttv.test/dashboard/attention")).not.toHaveBeenCalled();
    expect(swap("https://ttv.test/dev/platform-shell?space=profile")).not.toHaveBeenCalled();
  });
});
