import { useEffect, useRef, useState } from "react";
import { PiChatCircleText, PiGear, PiSignOut } from "react-icons/pi";
import type { PersonSummary } from "@/lib/platform/contracts";
import { openFeedbackWidget } from "@/components/feedback/feedback-client";
import { clearChannelDrafts } from "@/lib/platform/client/channel-drafts";
import { clearOnboardingDrafts } from "@/lib/platform/client/onboarding-drafts";
import { Avatar, initials, RoleBadge } from "@/components/platform/ui";
import { FOCUS_RING } from "@/components/platform/ui/Button";
import { cx } from "@/components/platform/ui/cx";
import { ACCOUNT_HREF } from "./space-routes";

/**
 * How this session ends. A normal session signs out through a link; a staging
 * QA persona has to POST to its own endpoint; a demo session goes back to the
 * demo controls instead. The layout decides, from the server's locals.
 */
export type ShellSignOut =
  | { kind: "link"; href: string; label: string }
  | { kind: "form"; action: string; label: string };

export type ShellAccount = {
  signOut: ShellSignOut;
  /** The feedback widget is mounted on this page, so the menu may open it. */
  feedback: boolean;
};

const ITEM = cx(
  "flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-[0.9375rem] font-semibold text-ink-primary",
  "hover:bg-ink-primary/8 focus-visible:bg-ink-primary/8 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-peach-ink",
);
const ICON = "size-5 shrink-0 text-ink-secondary";

/**
 * The avatar's name. Without a photo the avatar shows initials, and a voice
 * user can only say what they see, so the name ends with them too (WCAG 2.5.3,
 * label in name).
 */
export function accountMenuName(person: Pick<PersonSummary, "name" | "avatarUrl">): string {
  const base = `Account menu, ${person.name}`;
  return person.avatarUrl ? base : `${base}, ${initials(person.name)}`;
}

/** What this tab keeps for the signed-in person and must not hand to the next one. */
function forgetDrafts() {
  clearOnboardingDrafts();
  clearChannelDrafts();
}

/**
 * The avatar in the top bar, disclosing Account, Feedback and Sign out. Who
 * you are lives in Profile, the last space; this only holds the account.
 *
 * A native disclosure (`details`), so Account and Sign out work before and
 * without JavaScript. Hydration adds what a disclosure does not do by itself:
 * Escape and clicking or tabbing away close it, and Feedback appears, because
 * only then is there a widget for it to open.
 */
export default function AccountMenu({ person, account }: { person: PersonSummary; account: ShellAccount }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [hydrated, setHydrated] = useState(false);
  const { signOut } = account;

  useEffect(() => {
    setHydrated(true);
    const details = ref.current;
    if (!details) return;
    const summary = details.querySelector("summary");
    const close = (returnFocus: boolean) => {
      if (!details.open) return;
      details.open = false;
      if (returnFocus) summary?.focus();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !details.open) return;
      event.preventDefault();
      close(true);
    };
    const onPointer = (event: PointerEvent) => {
      if (!details.contains(event.target as Node)) close(false);
    };
    const onFocusOut = (event: FocusEvent) => {
      const next = event.relatedTarget as Node | null;
      if (next && !details.contains(next)) close(false);
    };
    details.addEventListener("keydown", onKey);
    details.addEventListener("focusout", onFocusOut);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      details.removeEventListener("keydown", onKey);
      details.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, []);

  const signOutContent = (
    <>
      <PiSignOut aria-hidden="true" className={ICON} />
      {signOut.label}
    </>
  );

  return (
    <details ref={ref} className="spaces-account">
      <summary
        aria-label={accountMenuName(person)}
        className={cx(
          "spaces-account__trigger inline-grid size-10 shrink-0 cursor-pointer place-items-center rounded-full pointer-coarse:size-11",
          FOCUS_RING,
        )}
      >
        <Avatar id={person.id} name={person.name} src={person.avatarUrl ?? undefined} size="md" decorative />
      </summary>
      <div className="spaces-account__panel w-64 max-w-[calc(100vw-1.5rem)] rounded-2xl border border-hairline p-1.5 shadow-[0_24px_48px_-16px_rgb(0_0_0/0.6)]">
        <div className="flex flex-col gap-1.5 px-3 pt-2 pb-3">
          <p className="text-[0.9375rem] leading-snug font-bold break-words text-ink-primary">{person.name}</p>
          {person.roleBadges.length > 0 && (
            <p className="flex flex-wrap gap-1">
              {person.roleBadges.map((badge) => (
                <RoleBadge key={`${badge.kind}:${badge.programId ?? ""}:${badge.label}`} badge={badge} />
              ))}
            </p>
          )}
        </div>
        <ul className="m-0 list-none p-0">
          <li>
            <a href={ACCOUNT_HREF} className={ITEM}>
              <PiGear aria-hidden="true" className={ICON} />
              Account
            </a>
          </li>
          {account.feedback && hydrated && (
            <li>
              <button
                type="button"
                className={ITEM}
                onClick={() => {
                  // Hand focus to the avatar before this button disappears, so the
                  // form returns it there when it closes, even if it opens later.
                  ref.current?.querySelector("summary")?.focus();
                  if (ref.current) ref.current.open = false;
                  openFeedbackWidget();
                }}
              >
                <PiChatCircleText aria-hidden="true" className={ICON} />
                Feedback
              </button>
            </li>
          )}
          <li className="mt-1 border-t border-hairline pt-1">
            {/* Signing out forgets this tab's unsent onboarding requests (S-O.2) and channel drafts (S-2.2), for whoever uses it next. */}
            {signOut.kind === "link" ? (
              <a href={signOut.href} data-shell-sign-out onClick={forgetDrafts} className={ITEM}>
                {signOutContent}
              </a>
            ) : (
              <form method="post" action={signOut.action} data-shell-sign-out onSubmit={forgetDrafts}>
                <button type="submit" className={ITEM}>
                  {signOutContent}
                </button>
              </form>
            )}
          </li>
        </ul>
      </div>
    </details>
  );
}
