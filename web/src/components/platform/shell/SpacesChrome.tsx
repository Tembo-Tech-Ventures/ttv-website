import { useEffect, useRef, useState, useSyncExternalStore, type MouseEvent } from "react";
import { PiList, PiX } from "react-icons/pi";
import type { Me, PersonSummary, SpaceId } from "@/lib/platform/contracts";
import { createSpacesController } from "@/lib/platform/client/spaces";
import { useSpaces } from "@/lib/platform/client/hooks/spaces";
import { awaitingConfirmation } from "@/components/platform/spaces/awaiting-confirmation";
// ARCH-1 spike (throwaway): SpacesShell split so the chrome can persist across ClientRouter swaps.
import { type SpaceTabItem } from "@/components/platform/ui";
import { SpaceFileRow } from "@/components/platform/ui/SpaceFile";
import { FOCUS_RING } from "@/components/platform/ui/Button";
import { cx } from "@/components/platform/ui/cx";
import AccountMenu, { type ShellAccount } from "./AccountMenu";
import { browserLanding, landedOnLastSpace, rememberLandingHint } from "./landing-hint";
import { latestAttentionCounts, subscribeAttentionCounts, type ShellOverlay } from "./overlays";
import SpaceBottomBar from "./SpaceBottomBar";
import { AttentionBell, SearchTrigger } from "./ShellTools";
import { opensInShell, SPACE_HOME, SPACE_LABEL } from "./space-routes";
import "./spaces-shell.css";

export type SpaceLink = { space: SpaceId; label: string; href: string; count: number };

export type SpacesChromeProps = {
  /** The signed-in person's context, from getSpaceContext. Nothing else about the session. */
  me: Me;
  /** The space this page belongs to. */
  space: SpaceId;
  /**
   * A page of its own that sits in `space` without belonging to it (Attention): the sheet still hangs
   * from that tab, but the phone's bar marks no space as the page you are on (T12).
   */
  outsideSpaces?: boolean;
  /** The ttv-last-space preference, already parsed on the server. Never the Cookie header. */
  lastSpace: SpaceId | null;
  /** Names the page in the phone's top bar, where there are no tabs to say where you are. */
  heading: string;
  account: ShellAccount;
  /** Overlays the page mounts. A trigger appears only for these. */
  overlays?: readonly ShellOverlay[];
  /** Off for fixture harnesses, which live outside the preference cookie's path. */
  persistPreference?: boolean;
  /** Where each tab leads. Fixture harnesses point the tabs back at themselves. */
  spaceHrefs?: Readonly<Record<SpaceId, string>>;
  /** ARCH-1 spike: whether the server rendered a sidebar into the sheet. */
  hasSidebar: boolean;
  /** ARCH-1 spike: which part of the chrome this island draws. */
  part: "row" | "bottom";
};

const NO_OVERLAYS: readonly ShellOverlay[] = [];
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';
const WIDE = "(min-width: 64rem)";
const SIDEBAR_ID = "space-sidebar";
const MAIN_ID = "spaces-main";

/**
 * Whether choosing a space is remembered for /dashboard. Admin is not: it has
 * its own frame outside /dashboard, and remembering it would send /dashboard,
 * including Admin's own "Back to dashboard", straight back to Admin.
 */
function remembered(id: string): boolean {
  return id !== "admin";
}

function shown(element: HTMLElement | null): element is HTMLElement {
  return Boolean(element?.isConnected && element.getClientRects().length > 0);
}

/**
 * Whether keyboard focus can really land here: laid out, not hidden by
 * `visibility`, not inert, and not taken out of the tab order. A slotted
 * sidebar may hold anything, so the drawer's focus cycle trusts none of it.
 */
function tabbable(element: HTMLElement): boolean {
  if (!shown(element) || element.matches(":disabled") || element.closest("[inert]") || element.tabIndex < 0) return false;
  return typeof element.checkVisibility === "function"
    ? element.checkVisibility({ visibilityProperty: true })
    : getComputedStyle(element).visibility !== "hidden";
}

/**
 * The platform's frame: the TEMBO mark, the space tabs standing on the active
 * space's sheet, search, attention and the account menu; inside the sheet, the
 * space's sidebar and the page. On phones the tabs become a bottom bar and the
 * sidebar a drawer. Everything renders on the server and works without
 * JavaScript; hydration adds the drawer's dialog behaviour, the account menu,
 * and remembering the space you were last in.
 */
export default function SpacesChrome({
  me,
  space,
  outsideSpaces,
  lastSpace,
  heading,
  account,
  overlays = NO_OVERLAYS,
  persistPreference = true,
  spaceHrefs = SPACE_HOME,
  hasSidebar,
  part,
}: SpacesChromeProps) {
  const [controller] = useState(() =>
    createSpacesController({ me, explicitSpace: remembered(space) ? space : undefined, lastSpace, browser: persistPreference ? undefined : null }),
  );
  const shell = useSpaces(controller);
    const triggerRef = useRef<HTMLAnchorElement>(null);
  const { open, focusIndex, focusTarget } = shell.drawer;
  // Until hydration the no-JS fallback (the #space-sidebar fragment) may hold the drawer open.
  const [hydrated, setHydrated] = useState(false);
  /** /dashboard just reopened the space used last: say so, once. */
  const [landingHint, setLandingHint] = useState(false);

  // The attention overlay publishes authoritative counts as they change; until then, and without it, Me's.
  const live = useSyncExternalStore(subscribeAttentionCounts, latestAttentionCounts, () => null);
  const counts = (overlays.includes("attention") && live) || me.unreadCounts;
  const links: SpaceLink[] = shell.spaces.map((id) => ({
    space: id,
    label: SPACE_LABEL[id],
    href: spaceHrefs[id],
    count: counts[id] ?? 0,
  }));
  const tabs: SpaceTabItem[] = links;

  /*
   * ARCH-1 motion spike: the card-file gesture starts at the click, not when the server answers. The
   * chosen tab comes forward at once and the sheet you are leaving settles back; the router's view
   * transition then raises the new sheet when it arrives. Server truth (the next page's props) wins.
   */
  const [pending, setPending] = useState<SpaceId | null>(null);
  useEffect(() => {
    if (part !== "row") return;
    const onPrepare = (event: Event) => {
      const to = (event as Event & { to?: URL }).to;
      if (!to) return;
      const target = links.find((link) => new URL(link.href, location.href).href === to.href)?.space ?? null;
      const root = document.querySelector<HTMLElement>(".spaces-shell");
      if (target && target !== space) {
        setPending(target);
        if (root) root.dataset.navPending = target;
      } else if (root) {
        root.dataset.navPending = "page";
      }
    };
    const onSwap = () => setPending(null);
    document.addEventListener("astro:before-preparation", onPrepare);
    document.addEventListener("astro:after-swap", onSwap);
    return () => {
      document.removeEventListener("astro:before-preparation", onPrepare);
      document.removeEventListener("astro:after-swap", onSwap);
    };
  }, [part, links, space]);
  const attention = links.reduce((sum, link) => sum + link.count, 0);
  const person = { id: me.user.id, name: me.user.name, src: me.user.avatarUrl ?? undefined };
  const sidebarLabel = `${SPACE_LABEL[space]} menu`;

  function focusables(): HTMLElement[] {
    return Array.from(document.getElementById(SIDEBAR_ID)?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(tabbable);
  }

  function openDrawer(event: MouseEvent) {
    event.preventDefault();
    shell.dispatchDrawer({ type: "open", itemCount: focusables().length });
  }

  function closeDrawer(event?: MouseEvent) {
    event?.preventDefault();
    shell.dispatchDrawer({ type: "close" });
  }

  /* Choosing a space, from the tabs or the bottom bar, is remembered for next time. */
  function rememberSpace(event: MouseEvent) {
    const link = (event.target as Element).closest<HTMLAnchorElement>("[data-space] a[href]");
    const chosen = link?.closest<HTMLElement>("[data-space]")?.dataset.space;
    if (chosen && chosen !== space && remembered(chosen)) shell.switchSpace(chosen);
  }

  /*
   * Take over from the no-JS fallback. A drawer opened through its link before
   * hydration (or reached later with Back) becomes controller state, and the
   * fragment is dropped, so every way of closing it works from then on.
   */
  useEffect(() => {
    setHydrated(true);
    if (!document.getElementById(SIDEBAR_ID)) return;
    const adopt = () => {
      if (window.location.hash !== `#${SIDEBAR_ID}`) return;
      history.replaceState(history.state, "", window.location.pathname + window.location.search);
      // On a wide screen the sidebar is already in the sheet: there is no drawer to open.
      if (!window.matchMedia(WIDE).matches) controller.dispatchDrawer({ type: "open", itemCount: focusables().length });
    };
    adopt();
    window.addEventListener("hashchange", adopt);
    return () => window.removeEventListener("hashchange", adopt);
  }, [controller]);

  /* Apply the controller's focus intents: into the drawer, or back to the trigger. */
  useEffect(() => {
    if (focusTarget === "drawer") {
      // The drawer was hidden when it was asked to open, so it could not count
      // its items then; the first one is the place to start.
      const items = focusables();
      (focusIndex === null ? (items[0] ?? document.getElementById(SIDEBAR_ID)) : items[focusIndex])?.focus();
    } else if (focusTarget === "trigger" && shown(triggerRef.current)) {
      triggerRef.current.focus();
    }
  }, [focusTarget, focusIndex]);

  /* While the drawer is open, nothing behind it can be reached. */
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".spaces-shell");
    if (!root || !open) return;
    const behind = [root.querySelector(".space-file__row"), root.querySelector(`#${MAIN_ID}`), root.querySelector(".spaces-bottom")];
    for (const element of behind) element?.setAttribute("inert", "");
    return () => {
      for (const element of behind) element?.removeAttribute("inert");
    };
  }, [open]);

  /*
   * The drawer's keyboard and focus tracking, and closing it when a link in it
   * is followed. Listeners rather than JSX props: the aside is a landmark on
   * wide screens and only becomes a dialog while open on phones.
   */
  useEffect(() => {
    if (part !== "row") return;
    const inDrawer = (event: Event) => (event.target as Element | null)?.closest?.(`#${SIDEBAR_ID}`);
    const onKey = (event: KeyboardEvent) => {
      if (!inDrawer(event)) return;
      if (controller.handleDrawerKey(event.key, focusables().length, event.shiftKey)) event.preventDefault();
    };
    const onFocus = (event: FocusEvent) => {
      if (!inDrawer(event)) return;
      const items = focusables();
      const index = items.indexOf(event.target as HTMLElement);
      if (index >= 0) controller.dispatchDrawer({ type: "focus", index, itemCount: items.length });
    };
    const onClick = (event: Event) => {
      const target = event.target as Element;
      if (target.closest?.(".spaces-shell__scrim") || target.closest?.("[data-drawer-close]")) {
        event.preventDefault();
        controller.dispatchDrawer({ type: "close" });
        return;
      }
      if (!inDrawer(event)) return;
      if ((event.target as Element).closest("a[href]:not([data-drawer-close])")) controller.dispatchDrawer({ type: "close" });
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("focusin", onFocus);
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("click", onClick);
    };
  }, [controller, part]);

  /*
   * ARCH-1 spike: the shell's root, sheet and sidebar are server HTML that the router swaps. The
   * persisted chrome re-applies its state to each new root, and a navigation closes the drawer.
   */
  useEffect(() => {
    if (part !== "row") return;
    const apply = () => {
      const root = document.querySelector<HTMLElement>(".spaces-shell");
      if (!root) return;
      root.dataset.hydrated = "";
      root.dataset.drawer = controller.getState().drawer.open ? "open" : "closed";
    };
    const onSwap = () => {
      controller.dispatchDrawer({ type: "close" });
      apply();
    };
    apply();
    document.addEventListener("astro:after-swap", onSwap);
    return () => document.removeEventListener("astro:after-swap", onSwap);
  }, [controller, part]);

  useEffect(() => {
    if (part !== "row") return;
    const root = document.querySelector<HTMLElement>(".spaces-shell");
    if (root) root.dataset.drawer = open ? "open" : "closed";
    // The aside is server HTML now: the chrome makes it a dialog while it is open on a phone.
    const aside = document.getElementById(SIDEBAR_ID);
    if (aside) {
      if (open) {
        aside.setAttribute("role", "dialog");
        aside.setAttribute("aria-modal", "true");
      } else {
        aside.removeAttribute("role");
        aside.removeAttribute("aria-modal");
      }
    }
  }, [open, part]);

  /* A persisted island gets the next page's props: follow its space without losing the island's state. */
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    controller.setContext(me, remembered(space) ? space : undefined);
  }, [controller, me, space]);

  useEffect(() => {
    if (!persistPreference) return;
    if (landedOnLastSpace({ space, lastSpace, home: spaceHrefs[space], ...browserLanding() })) {
      setLandingHint(true);
      rememberLandingHint();
    }
  }, [persistPreference, space, lastSpace, spaceHrefs]);

  /*
   * Switching spaces slides the new sheet in, but only a page in the shell can
   * finish that transition. Leaving for any other page (Admin, a public page)
   * skips it at once, instead of the browser aborting it with an error.
   */
  useEffect(() => {
    const onSwap = (event: PageSwapEvent) => {
      const to = event.activation?.entry.url;
      const path = to ? new URL(to).pathname : null;
      if (event.viewTransition && !(path && (opensInShell(path) || path === window.location.pathname))) {
        event.viewTransition.skipTransition();
      }
    };
    window.addEventListener("pageswap", onSwap);
    return () => window.removeEventListener("pageswap", onSwap);
  }, []);

  /* Widening past the phone layout puts the sidebar back in the sheet, and closes the drawer. */
  useEffect(() => {
    const wide = window.matchMedia(WIDE);
    const onChange = () => {
      if (wide.matches) controller.dispatchDrawer({ type: "close" });
    };
    // Also reconcile now: the page may have widened while it was hydrating.
    onChange();
    wide.addEventListener("change", onChange);
    return () => wide.removeEventListener("change", onChange);
  }, [controller]);

  const start = (
    <>
      {/*
       * The name holds the words the mark shows, in order (WCAG 2.5.3), so a
       * voice user can say them. The space between the two parts is what keeps
       * "TEMBO" and "Tech" two words for anything reading the visible text.
       */}
      <a href="/" className={cx("spaces-shell__brand", FOCUS_RING)} aria-label="Tembo Tech Ventures home">
        <span aria-hidden="true" data-wordmark className="font-heading tracking-subhead text-[1.0625rem] leading-none text-ink-primary">
          TEMBO
        </span>{" "}
        <span
          aria-hidden="true"
          className="spaces-shell__tagline font-body text-[0.625rem] font-semibold tracking-[0.32em] text-ink-muted uppercase"
        >
          Tech · Ventures
        </span>
      </a>
      <div className="spaces-shell__compact-start">
        {hasSidebar && (
          <a
            ref={triggerRef}
            href={`#${SIDEBAR_ID}`}
            aria-controls={SIDEBAR_ID}
            aria-expanded={open}
            aria-label={`Open ${sidebarLabel}`}
            onClick={openDrawer}
            className={cx(
              "inline-grid size-10 shrink-0 place-items-center rounded-xl border border-hairline bg-ink-primary/6 text-ink-secondary pointer-coarse:size-11",
              FOCUS_RING,
            )}
          >
            <PiList aria-hidden="true" className="size-5" />
          </a>
        )}
        <p className="spaces-shell__heading">{heading}</p>
      </div>
    </>
  );

  const tools = (
    <>
      {overlays.includes("search") && <SearchTrigger />}
      {overlays.includes("attention") && <AttentionBell count={attention} awaiting={awaitingConfirmation(me)} />}
      <AccountMenu person={me.user} account={account} />
    </>
  );

  if (part === "bottom") return <SpaceBottomBar links={links} active={space} outside={outsideSpaces} person={person} />;

  return (
    <div className="contents" onClickCapture={rememberSpace}>
      <SpaceFileRow tabs={tabs} active={pending ?? space} person={person} start={start} end={tools} />
    </div>
  );
}
