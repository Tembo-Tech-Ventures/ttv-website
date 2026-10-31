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

/** happy-dom's own control surface, for putting the page under /dashboard. */
function setURL(url: string) {
  (window as unknown as { happyDOM?: { setURL(next: string): void } }).happyDOM?.setURL(url);
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
    expect(container.querySelector('[aria-label="Search everything"]')).toBeNull();
    expect(container.querySelector('[aria-label^="Attention"]')).toBeNull();
  });

  it("asks for search by click and by Ctrl K, and for attention from the bell", async () => {
    const requests: ShellOverlayRequest[] = [];
    const listen = (event: Event) => requests.push((event as CustomEvent<ShellOverlayRequest>).detail);
    window.addEventListener(SHELL_OVERLAY_EVENT, listen);
    await mount({ overlays: ["search", "attention"] });

    const search = q<HTMLButtonElement>('[aria-label="Search everything"]');
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
  async function openMenu() {
    await act(async () => q<HTMLButtonElement>('[aria-label="Account menu, David Kamau"]').click());
    const menu = document.querySelector('[role="menu"]');
    if (!menu) throw new Error("menu did not open");
    return menu;
  }

  it("holds Account, Feedback and Sign out", async () => {
    await mount();
    const menu = await openMenu();
    const items = Array.from(menu.querySelectorAll('[role="menuitem"]')).map((item) => item.textContent?.trim());
    expect(items).toEqual(["Account", "Feedback", "Sign out"]);
    expect(menu.querySelector('a[role="menuitem"][href="/dashboard/account"]')).not.toBeNull();
    expect(menu.querySelector('a[role="menuitem"][href="/auth/logout"]')).not.toBeNull();
  });

  it("opens the feedback form, and leaves it out where the widget is not mounted", async () => {
    const opened = vi.fn();
    window.addEventListener(OPEN_FEEDBACK_EVENT, opened);
    await mount();
    let menu = await openMenu();
    await act(async () => (menu.querySelectorAll<HTMLElement>('[role="menuitem"]')[1]).click());
    expect(opened).toHaveBeenCalledTimes(1);
    window.removeEventListener(OPEN_FEEDBACK_EVENT, opened);

    await act(async () => root.unmount());
    root = createRoot(container);
    await mount({ account: { ...LINK_OUT, feedback: false } });
    menu = await openMenu();
    expect(Array.from(menu.querySelectorAll('[role="menuitem"]')).map((item) => item.textContent?.trim())).toEqual([
      "Account",
      "Sign out",
    ]);
  });

  it("signs a QA persona out with a POST to its own endpoint", async () => {
    await mount({ account: { signOut: { kind: "form", action: "/api/qa/logout", label: "Sign out of this QA persona" }, feedback: false } });
    const form = q<HTMLFormElement>("form#spaces-sign-out");
    expect(form.getAttribute("method")).toBe("post");
    expect(form.getAttribute("action")).toBe("/api/qa/logout");
    const menu = await openMenu();
    const submit = menu.querySelector<HTMLButtonElement>('button[type="submit"][form="spaces-sign-out"]');
    expect(submit?.textContent?.trim()).toBe("Sign out of this QA persona");
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
