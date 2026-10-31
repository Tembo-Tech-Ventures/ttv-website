import { Menu, MenuButton, MenuHeading, MenuItem, MenuItems, MenuSection, MenuSeparator } from "@headlessui/react";
import { PiChatCircleText, PiGear, PiSignOut } from "react-icons/pi";
import type { PersonSummary } from "@/lib/platform/contracts";
import { openFeedbackWidget } from "@/components/feedback/feedback-client";
import { Avatar, RoleBadge } from "@/components/platform/ui";
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

export const SIGN_OUT_FORM_ID = "spaces-sign-out";

const ITEM = cx(
  "flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-[0.9375rem] font-semibold text-ink-primary",
  "data-[focus]:bg-ink-primary/8 data-[focus]:outline-none",
);

/**
 * The avatar in the top bar, opening Account, Feedback and Sign out. Who you
 * are lives in Profile, the last space; this menu only holds the account.
 */
export default function AccountMenu({ person, account }: { person: PersonSummary; account: ShellAccount }) {
  const { signOut } = account;
  const signOutContent = (
    <>
      <PiSignOut aria-hidden="true" className="size-5 shrink-0 text-ink-secondary" />
      {signOut.label}
    </>
  );

  return (
    <Menu>
      <MenuButton
        aria-label={`Account menu, ${person.name}`}
        className={cx(
          "inline-grid size-10 shrink-0 place-items-center rounded-full pointer-coarse:size-11",
          "data-[open]:outline-2 data-[open]:outline-offset-2 data-[open]:outline-ink-primary/40",
          FOCUS_RING,
        )}
      >
        <Avatar id={person.id} name={person.name} src={person.avatarUrl ?? undefined} size="md" decorative />
      </MenuButton>
      <MenuItems
        anchor={{ to: "bottom end", gap: 8, padding: 12 }}
        modal={false}
        className={cx(
          "spaces-account-menu z-60 w-64 max-w-[calc(100vw-1.5rem)] rounded-2xl border border-hairline p-1.5",
          "shadow-[0_24px_48px_-16px_rgb(0_0_0/0.6)] focus:outline-none",
        )}
      >
        <MenuSection>
          <MenuHeading className="flex flex-col gap-1.5 px-3 pt-2 pb-3">
            <span className="text-[0.9375rem] leading-snug font-bold break-words text-ink-primary">{person.name}</span>
            {person.roleBadges.length > 0 && (
              <span className="flex flex-wrap gap-1">
                {person.roleBadges.map((badge) => (
                  <RoleBadge key={`${badge.kind}:${badge.programId ?? ""}:${badge.label}`} badge={badge} />
                ))}
              </span>
            )}
          </MenuHeading>
          <MenuItem>
            <a href={ACCOUNT_HREF} className={ITEM}>
              <PiGear aria-hidden="true" className="size-5 shrink-0 text-ink-secondary" />
              Account
            </a>
          </MenuItem>
          {account.feedback && (
            <MenuItem>
              <button type="button" onClick={openFeedbackWidget} className={ITEM}>
                <PiChatCircleText aria-hidden="true" className="size-5 shrink-0 text-ink-secondary" />
                Feedback
              </button>
            </MenuItem>
          )}
        </MenuSection>
        <MenuSeparator className="mx-2 my-1 h-px bg-hairline" />
        <MenuItem>
          {signOut.kind === "link" ? (
            <a href={signOut.href} className={ITEM}>
              {signOutContent}
            </a>
          ) : (
            <button type="submit" form={SIGN_OUT_FORM_ID} className={ITEM}>
              {signOutContent}
            </button>
          )}
        </MenuItem>
      </MenuItems>
    </Menu>
  );
}
