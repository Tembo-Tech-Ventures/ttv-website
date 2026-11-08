import type { MutableRefObject } from "react";
import { PiChatsCircle, PiCheck, PiDotsThreeBold, PiEye, PiEyeSlash, PiFlag } from "react-icons/pi";
import type { Message, ReactionKind } from "@/lib/platform/contracts";
import Menu, { MenuItem, MenuSection, MenuSeparator } from "@/components/platform/ui/Menu";
import { REACTIONS } from "@/components/platform/ui/TextReaction";
import { messageActionsLabel } from "./channel-format";

/**
 * The fixed reactions, in the contract's order. Read from the kit's words rather than the contract's
 * zod enum, so the island does not carry the schemas for one list (MessageMenu.test.tsx holds them equal).
 */
export const REACTION_KINDS = Object.keys(REACTIONS) as ReactionKind[];

type MessageMenuProps = {
  message: Message;
  buttonRef: MutableRefObject<HTMLButtonElement | null>;
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
      {separated && <MenuSeparator />}
      {can.edit && <MenuItem onSelect={onEdit}>Edit</MenuItem>}
      {can.remove && (
        <MenuItem tone="danger" onSelect={onDelete}>
          Delete…
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
      {separated && <MenuSeparator />}
      {can.report && (can.reported ? (
        <MenuItem disabled icon={<PiCheck className="size-4" />}>
          Reported
        </MenuItem>
      ) : (
        <MenuItem icon={<PiFlag className="size-4" />} onSelect={onReport}>
          Report…
        </MenuItem>
      ))}
      {can.hide && (
        <MenuItem icon={<PiEyeSlash className="size-4" />} onSelect={() => onModerate("hide")}>
          Hide from members…
        </MenuItem>
      )}
      {can.restore && (
        <MenuItem icon={<PiEye className="size-4" />} onSelect={() => onModerate("restore")}>
          Restore for members…
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
 * is always there, in the muted ink, never revealed only on hover.
 */
export default function MessageMenu({ message, buttonRef, can, onReply, onReact, onEdit, onDelete, onReport, onModerate }: MessageMenuProps) {
  return (
    <Menu
      label={messageActionsLabel(message)}
      icon={<PiDotsThreeBold className="size-5" />}
      iconOnly
      align="end"
      triggerRef={buttonRef}
      triggerClassName="channel-message__more"
      className="channel-message__actions"
    >
      {can.reply && (
        <MenuItem icon={<PiChatsCircle className="size-4" />} onSelect={onReply}>
          Reply in thread
        </MenuItem>
      )}
      {can.react && (
        <>
          {can.reply && <MenuSeparator />}
          <MenuSection heading="React">
            {REACTION_KINDS.map((kind) => {
              const mine = message.reactions.some((reaction) => reaction.kind === kind && reaction.mine);
              return (
                <MenuItem key={kind} onSelect={() => onReact(kind, !mine)}>
                  {mine ? `Remove “${REACTIONS[kind]}”` : REACTIONS[kind]}
                </MenuItem>
              );
            })}
          </MenuSection>
        </>
      )}
      <OwnSection can={can} separated={can.reply || can.react} onEdit={onEdit} onDelete={onDelete} />
      <ModerationSection can={can} separated={can.reply || can.react || can.edit || can.remove} onReport={onReport} onModerate={onModerate} />
    </Menu>
  );
}
