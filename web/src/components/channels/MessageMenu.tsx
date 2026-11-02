import { Menu, MenuButton, MenuHeading, MenuItem, MenuItems, MenuSection, MenuSeparator } from "@headlessui/react";
import type { RefObject } from "react";
import { PiChatsCircle, PiCheck, PiDotsThreeBold, PiEye, PiEyeSlash, PiFlag } from "react-icons/pi";
import { ReactionKind, type Message } from "@/lib/platform/contracts";
import { FOCUS_RING } from "@/components/platform/ui/Button";
import { cx } from "@/components/platform/ui/cx";
import { REACTIONS } from "@/components/platform/ui/TextReaction";

export const MENU_ITEM =
  "flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left text-sm text-ink-primary data-focus:bg-ink-primary/10 data-disabled:text-ink-muted pointer-coarse:min-h-11";

type MessageMenuProps = {
  message: Message;
  buttonRef: RefObject<HTMLButtonElement>;
  can: {
    reply: boolean; react: boolean; edit: boolean; remove: boolean;
    report: boolean; reported: boolean; hide: boolean; restore: boolean;
  };
  onReply: () => void;
  onReact: (kind: ReactionKind, active: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
  onReport: () => void;
  onModerate: (action: "hide" | "restore") => void;
};

type Can = MessageMenuProps["can"];

/** The author's own: edit (not while hidden) and delete. */
function OwnSection({ can, separated, onEdit, onDelete }: { can: Can; separated: boolean; onEdit: () => void; onDelete: () => void }) {
  if (!can.edit && !can.remove) return null;
  return (
    <MenuSection>
      {separated && <MenuSeparator className="channel-menu__rule" />}
      {can.edit && (
        <MenuItem>
          <button type="button" className={MENU_ITEM} onClick={onEdit}>
            Edit
          </button>
        </MenuItem>
      )}
      {can.remove && (
        <MenuItem>
          <button type="button" className={cx(MENU_ITEM, "text-danger-ink")} onClick={onDelete}>
            Delete…
          </button>
        </MenuItem>
      )}
    </MenuSection>
  );
}

/** Everyone else's: report (once, then "Reported"); for the channel's moderators, hide or restore. */
function ModerationSection({ can, separated, onReport, onModerate }: {
  can: Can; separated: boolean; onReport: () => void; onModerate: (action: "hide" | "restore") => void;
}) {
  if (!can.report && !can.hide && !can.restore) return null;
  return (
    <MenuSection>
      {separated && <MenuSeparator className="channel-menu__rule" />}
      {can.report && (
        <MenuItem disabled={can.reported}>
          {can.reported ? (
            <span className={MENU_ITEM}>
              <PiCheck aria-hidden="true" className="mt-0.5 size-4" />
              Reported
            </span>
          ) : (
            <button type="button" className={MENU_ITEM} onClick={onReport}>
              <PiFlag aria-hidden="true" className="mt-0.5 size-4" />
              Report…
            </button>
          )}
        </MenuItem>
      )}
      {can.hide && (
        <MenuItem>
          <button type="button" className={MENU_ITEM} onClick={() => onModerate("hide")}>
            <PiEyeSlash aria-hidden="true" className="mt-0.5 size-4" />
            Hide from members…
          </button>
        </MenuItem>
      )}
      {can.restore && (
        <MenuItem>
          <button type="button" className={MENU_ITEM} onClick={() => onModerate("restore")}>
            <PiEye aria-hidden="true" className="mt-0.5 size-4" />
            Restore for members…
          </button>
        </MenuItem>
      )}
    </MenuSection>
  );
}

/** Whether the menu has anything to offer this reader. */
export function hasMenu(can: MessageMenuProps["can"]): boolean {
  return can.reply || can.react || can.edit || can.remove || can.report || can.hide || can.restore;
}

/**
 * A message's actions, behind one quiet button: reply in a thread, a text
 * reaction from the fixed set, for the author edit and delete, for everyone
 * else report, and for the channel's moderators hide or restore. The button
 * stays visible on touch screens, which have no hover.
 */
export default function MessageMenu({ message, buttonRef, can, onReply, onReact, onEdit, onDelete, onReport, onModerate }: MessageMenuProps) {
  const whose = message.deleted ? "the deleted message" : `${message.author.name}'s message`;
  return (
    <Menu>
      <MenuButton ref={buttonRef} aria-label={`Actions for ${whose}`} className={cx("channel-message__more", FOCUS_RING)}>
        <PiDotsThreeBold aria-hidden="true" className="size-5" />
      </MenuButton>
      <MenuItems anchor={{ to: "bottom end", gap: 4 }} className="channel-menu">
        {can.reply && (
          <MenuItem>
            <button type="button" className={MENU_ITEM} onClick={onReply}>
              <PiChatsCircle aria-hidden="true" className="mt-0.5 size-4" />
              Reply in thread
            </button>
          </MenuItem>
        )}
        {can.react && (
          <MenuSection>
            {can.reply && <MenuSeparator className="channel-menu__rule" />}
            <MenuHeading className="px-3 pt-1.5 pb-1 text-xs font-semibold text-ink-muted">React</MenuHeading>
            {ReactionKind.options.map((kind) => {
              const mine = message.reactions.some((reaction) => reaction.kind === kind && reaction.mine);
              return (
                <MenuItem key={kind}>
                  <button type="button" className={MENU_ITEM} onClick={() => onReact(kind, !mine)}>
                    {mine ? `Remove “${REACTIONS[kind]}”` : REACTIONS[kind]}
                  </button>
                </MenuItem>
              );
            })}
          </MenuSection>
        )}
        <OwnSection can={can} separated={can.reply || can.react} onEdit={onEdit} onDelete={onDelete} />
        <ModerationSection can={can} separated={can.reply || can.react || can.edit || can.remove} onReport={onReport} onModerate={onModerate} />
      </MenuItems>
    </Menu>
  );
}
