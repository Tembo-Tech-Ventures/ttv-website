import { useEffect, useRef, useState, useSyncExternalStore, type MouseEvent, type ReactNode } from "react";
import { PiList, PiX } from "react-icons/pi";
import type { Me, PersonSummary, SpaceId } from "@/lib/platform/contracts";
import { createSpacesController } from "@/lib/platform/client/spaces";
import { useSpaces } from "@/lib/platform/client/hooks/spaces";
import { Avatar, RoleBadge, SpaceFile, type SpaceTabItem } from "@/components/platform/ui";
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

export type SpacesShellProps = {
  /** The signed-in person's context, from getSpaceContext. Nothing else about the session. */
  me: Me;
  /** The space this page belongs to. */
  space: SpaceId;
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
  /** The current space's sidebar. On phones it becomes a drawer. */
  sidebar?: ReactNode;
  children: ReactNode;
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

function PersonFooter({ person }: { person: PersonSummary }) {
  return (
    <div className="spaces-shell__person">
      <Avatar id={person.id} name={person.name} src={person.avatarUrl ?? undefined} size="md" decorative />
      <div className="min-w-0">
        <p className="text-sm leading-snug font-semibold break-words text-ink-primary">{person.name}</p>
        {person.roleBadges.length > 0 && (
          <p className="mt-1 flex flex-wrap gap-1">
            {person.roleBadges.map((badge) => (
              <RoleBadge key={`${badge.kind}:${badge.programId ?? ""}:${badge.label}`} badge={badge} />
            ))}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * The platform's frame: the TEMBO mark, the space tabs standing on the active
 * space's sheet, search, attention and the account menu; inside the sheet, the
 * space's sidebar and the page. On phones the tabs become a bottom bar and the
 * sidebar a drawer. Everything renders on the server and works without
 * JavaScript; hydration adds the drawer's dialog behaviour, the account menu,
 * and remembering the space you were last in.
 */
export default function SpacesShell({
  me,
  space,
  lastSpace,
  heading,
  account,
  overlays = NO_OVERLAYS,
  persistPreference = true,
  spaceHrefs = SPACE_HOME,
  sidebar,
  children,
}: SpacesShellProps) {
  const [controller] = useState(() =>
    createSpacesController({ me, explicitSpace: remembered(space) ? space : undefined, lastSpace, browser: persistPreference ? undefined : null }),
  );
  const shell = useSpaces(controller);
  const rootRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
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
  const attention = links.reduce((sum, link) => sum + link.count, 0);
  const person = { id: me.user.id, name: me.user.name, src: me.user.avatarUrl ?? undefined };
  const sidebarLabel = `${SPACE_LABEL[space]} menu`;

  function focusables(): HTMLElement[] {
    return Array.from(drawerRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(tabbable);
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
    if (!drawerRef.current) return;
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
      (focusIndex === null ? (items[0] ?? drawerRef.current) : items[focusIndex])?.focus();
    } else if (focusTarget === "trigger" && shown(triggerRef.current)) {
      triggerRef.current.focus();
    }
  }, [focusTarget, focusIndex]);

  /* While the drawer is open, nothing behind it can be reached. */
  useEffect(() => {
    const root = rootRef.current;
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
    const drawer = drawerRef.current;
    if (!drawer) return;
    const onKey = (event: KeyboardEvent) => {
      if (controller.handleDrawerKey(event.key, focusables().length, event.shiftKey)) event.preventDefault();
    };
    const onFocus = (event: FocusEvent) => {
      const items = focusables();
      const index = items.indexOf(event.target as HTMLElement);
      if (index >= 0) controller.dispatchDrawer({ type: "focus", index, itemCount: items.length });
    };
    const onClick = (event: Event) => {
      if ((event.target as Element).closest("a[href]:not([data-drawer-close])")) controller.dispatchDrawer({ type: "close" });
    };
    drawer.addEventListener("keydown", onKey);
    drawer.addEventListener("focusin", onFocus);
    drawer.addEventListener("click", onClick);
    return () => {
      drawer.removeEventListener("keydown", onKey);
      drawer.removeEventListener("focusin", onFocus);
      drawer.removeEventListener("click", onClick);
    };
  }, [controller]);

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
      <a href="/" className={cx("spaces-shell__brand", FOCUS_RING)} aria-label="Tembo Tech Ventures home">
        <span aria-hidden="true" data-wordmark className="font-heading tracking-subhead text-[1.0625rem] leading-none text-ink-primary">
          TEMBO
        </span>
        <span
          aria-hidden="true"
          className="spaces-shell__tagline font-body text-[0.625rem] font-semibold tracking-[0.32em] text-ink-muted uppercase"
        >
          Tech · Ventures
        </span>
      </a>
      <div className="spaces-shell__compact-start">
        {sidebar && (
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
      {overlays.includes("attention") && <AttentionBell count={attention} />}
      <AccountMenu person={me.user} account={account} />
    </>
  );

  return (
    <div
      ref={rootRef}
      className="spaces-shell"
      data-space={space}
      data-sidebar={sidebar ? "" : undefined}
      data-drawer={open ? "open" : "closed"}
      data-hydrated={hydrated ? "" : undefined}
      onClickCapture={rememberSpace}
    >
      <a href={`#${MAIN_ID}`} className={cx("spaces-shell__skip", FOCUS_RING)}>
        Skip to content
      </a>
      <SpaceFile className="spaces-shell__file" tabs={tabs} active={space} person={person} start={start} end={tools}>
        <div className="spaces-shell__body">
          {sidebar && (
            <>
              <div aria-hidden="true" className="spaces-shell__scrim" onClick={() => closeDrawer()} />
              <aside
                ref={drawerRef}
                id={SIDEBAR_ID}
                aria-label={sidebarLabel}
                role={open ? "dialog" : undefined}
                aria-modal={open || undefined}
                tabIndex={-1}
                className="spaces-shell__sidebar"
              >
                <a
                  href={`#${MAIN_ID}`}
                  data-drawer-close
                  aria-label={`Close ${sidebarLabel}`}
                  onClick={closeDrawer}
                  className={cx(
                    "spaces-shell__close inline-grid size-10 place-items-center rounded-xl text-ink-secondary hover:bg-ink-primary/7 hover:text-ink-primary pointer-coarse:size-11",
                    FOCUS_RING,
                  )}
                >
                  <PiX aria-hidden="true" className="size-5" />
                </a>
                <div className="spaces-shell__sidebar-content">{sidebar}</div>
                <PersonFooter person={me.user} />
              </aside>
            </>
          )}
          {/* The page scrolls here, so a keyboard must be able to reach and scroll it (WCAG 2.1.1). */}
          {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scroll container */}
          <main id={MAIN_ID} tabIndex={0} className={cx("spaces-shell__main", FOCUS_RING)}>
            <div className={landingHint ? "spaces-shell__landing" : "sr-only"}>
              {/* Always present, so the hint is announced when it appears. */}
              <output className="min-w-0 flex-1">
                {landingHint && `You’re in ${SPACE_LABEL[space]}, the space you used last. Switch any time from the tabs.`}
              </output>
              {landingHint && (
                <button
                  type="button"
                  onClick={() => {
                    setLandingHint(false);
                    // The button goes with the hint: keep focus where the reader was, in the page.
                    document.getElementById(MAIN_ID)?.focus();
                  }}
                  aria-label="Dismiss"
                  className={cx(
                    "inline-grid size-10 shrink-0 place-items-center rounded-lg text-ink-secondary hover:bg-ink-primary/7 hover:text-ink-primary pointer-coarse:size-11",
                    FOCUS_RING,
                  )}
                >
                  <PiX aria-hidden="true" className="size-4" />
                </button>
              )}
            </div>
            {children}
          </main>
        </div>
      </SpaceFile>
      <SpaceBottomBar links={links} active={space} person={person} />
    </div>
  );
}
