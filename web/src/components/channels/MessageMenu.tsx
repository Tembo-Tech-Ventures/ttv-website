import { Menu, MenuButton, MenuHeading, MenuItem, MenuItems, MenuSection, MenuSeparator } from "@headlessui/react";
import type { RefObject } from "react";
import { PiChatsCircle, PiDotsThreeBold } from "react-icons/pi";
import { ReactionKind, type Message } from "@/lib/platform/contracts";
import { FOCUS_RING } from "@/components/platform/ui/Button";
import { cx } from "@/components/platform/ui/cx";
import { REACTIONS } from "@/components/platform/ui/TextReaction";

export const MENU_ITEM =
  "flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left text-sm text-ink-primary data-focus:bg-ink-primary/10 data-disabled:text-ink-muted pointer-coarse:min-h-11";

type MessageMenuProps = {
  message: Message;
  buttonRef: RefObject<HTMLButtonElement>;
  can: { reply: boolean; react: boolean; change: boolean };
  onReply: () => void;
  onReact: (kind: ReactionKind, active: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
};

/**
 * A message's actions, behind one quiet button: reply in a thread, a text
 * reaction from the fixed set, and for the author, edit and delete. The
 * button stays visible on touch screens, which have no hover.
 */
export default function MessageMenu({ message, buttonRef, can, onReply, onReact, onEdit, onDelete }: MessageMenuProps) {
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
        {can.change && (
          <MenuSection>
            {(can.reply || can.react) && <MenuSeparator className="channel-menu__rule" />}
            <MenuItem>
              <button type="button" className={MENU_ITEM} onClick={onEdit}>
                Edit
              </button>
            </MenuItem>
            <MenuItem>
              <button type="button" className={cx(MENU_ITEM, "text-danger-ink")} onClick={onDelete}>
                Delete…
              </button>
            </MenuItem>
          </MenuSection>
        )}
      </MenuItems>
    </Menu>
  );
}
