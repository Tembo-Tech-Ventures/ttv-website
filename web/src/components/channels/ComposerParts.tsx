import { Menu, MenuButton, MenuHeading, MenuItem, MenuItems, MenuSection } from "@headlessui/react";
import type { ReactNode } from "react";
import { PiAt, PiFolderSimple, PiPaperPlaneRightFill, PiPlus, PiSparkle, PiVideoCamera, PiX } from "react-icons/pi";
import type { MessageEmbed, TemboUsage } from "@/lib/platform/contracts";
import Avatar from "@/components/platform/ui/Avatar";
import { FOCUS_RING } from "@/components/platform/ui/Button";
import { cx } from "@/components/platform/ui/cx";
import TemboMark from "@/components/platform/ui/TemboMark";
import { sameEmbed, type Shareables } from "./actions";
import { clipTime, type ComposerTools } from "./channel-format";
import type { MentionCandidate } from "./mentions";
import { MENU_ITEM } from "./MessageMenu";

export const MAX_EMBEDS = 5;

const TOOL =
  "inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg px-2.5 text-[0.8125rem] font-semibold text-ink-secondary hover:bg-ink-primary/7 hover:text-ink-primary pointer-coarse:h-11 pointer-coarse:min-w-11";

export function embedLabel(embed: MessageEmbed): string {
  return embed.type === "project" ? `${embed.title} · rev ${embed.version}` : `${embed.title} · ${clipTime(embed.startSeconds)}`;
}

const embedKey = (embed: MessageEmbed) =>
  embed.type === "project" ? `p-${embed.journeyId}-${embed.version}` : `c-${embed.recordingId}-${embed.startSeconds}`;

function EmbedIcon({ embed, className = "size-4 shrink-0" }: { embed: MessageEmbed; className?: string }) {
  return embed.type === "project" ? <PiFolderSimple aria-hidden="true" className={className} /> : <PiVideoCamera aria-hidden="true" className={className} />;
}

type PickProps = { attached: readonly MessageEmbed[]; onPick: (embed: MessageEmbed) => void };

function AttachSection({ title, items, empty, attached, onPick }: PickProps & { title: string; items: readonly MessageEmbed[]; empty: string }) {
  return (
    <MenuSection>
      <MenuHeading className="px-3 pt-1.5 pb-1 text-xs font-semibold text-ink-muted">{title}</MenuHeading>
      {items.length === 0 && (
        <MenuItem disabled>
          <span className={MENU_ITEM}>{empty}</span>
        </MenuItem>
      )}
      {items.map((embed) => {
        const already = attached.some((item) => sameEmbed(item, embed));
        return (
          <MenuItem key={embedKey(embed)} disabled={already || attached.length >= MAX_EMBEDS}>
            <button type="button" className={MENU_ITEM} onClick={() => onPick(embed)}>
              <EmbedIcon embed={embed} className="mt-0.5 size-4 shrink-0 text-ink-muted" />
              <span className="min-w-0">
                {embedLabel(embed)}
                {already && <span className="text-ink-muted"> (attached)</span>}
              </span>
            </button>
          </MenuItem>
        );
      })}
    </MenuSection>
  );
}

const ProjectSection = ({ shareables, ...pick }: PickProps & { shareables: Shareables }) => (
  <AttachSection title="Share a project" items={shareables.projects} empty="You have no projects to share yet." {...pick} />
);
const ClipSection = ({ shareables, ...pick }: PickProps & { shareables: Shareables }) => (
  <AttachSection title="Share a session clip" items={shareables.clips} empty="No session moments to share yet." {...pick} />
);

function ToolMenu({ label, icon, children, iconOnly = false }: { label: string; icon: ReactNode; children: ReactNode; iconOnly?: boolean }) {
  return (
    <Menu>
      <MenuButton aria-label={iconOnly ? label : undefined} className={cx(TOOL, FOCUS_RING)}>
        <span aria-hidden="true" className="inline-flex">{icon}</span>
        {!iconOnly && label}
      </MenuButton>
      <MenuItems anchor={{ to: "top start", gap: 6 }} className="channel-menu">
        {children}
      </MenuItems>
    </Menu>
  );
}

type ToolbarProps = PickProps & {
  tools: ComposerTools;
  shareables: Shareables;
  /** The thread's reply box offers mentions and Tembo only. */
  attachments: boolean;
  thread: boolean;
  canSend: boolean;
  sending: boolean;
  onMention: () => void;
  onAskTembo: () => void;
};

/**
 * Share project and, in cohort channels only, Session clip; on a narrow
 * composer both fold under "+". Then @, Ask Tembo (only while
 * `tembo_channels` is on) and Send, which is always visible.
 */
export function ComposerToolbar({ tools, shareables, attachments, thread, canSend, sending, onMention, onAskTembo, ...pick }: ToolbarProps) {
  return (
    <div className="channel-composer__bar">
      {attachments && (
        <>
          <div className="channel-composer__attach">
            <ToolMenu label="Attach work" icon={<PiPlus className="size-4.5" />} iconOnly>
              <ProjectSection shareables={shareables} {...pick} />
              {tools.sessionClip && <ClipSection shareables={shareables} {...pick} />}
            </ToolMenu>
          </div>
          <div className="channel-composer__wide-tools">
            <ToolMenu label="Share project" icon={<PiFolderSimple className="size-4.5" />}>
              <ProjectSection shareables={shareables} {...pick} />
            </ToolMenu>
            {tools.sessionClip && (
              <ToolMenu label="Session clip" icon={<PiVideoCamera className="size-4.5" />}>
                <ClipSection shareables={shareables} {...pick} />
              </ToolMenu>
            )}
          </div>
        </>
      )}
      <button type="button" aria-label="Mention someone" onClick={onMention} className={cx(TOOL, FOCUS_RING)}>
        <PiAt aria-hidden="true" className="size-4.5" />
      </button>
      {tools.askTembo && (
        <button type="button" onClick={onAskTembo} className={cx(TOOL, "text-peach-ink hover:text-peach-ink", FOCUS_RING)}>
          <PiSparkle aria-hidden="true" className="size-4.5" />
          Ask Tembo
        </button>
      )}
      <button
        type="submit"
        aria-label={thread ? "Send reply" : "Send message"}
        aria-disabled={!canSend || undefined}
        className={cx("channel-composer__send", canSend && "channel-composer__send--ready", FOCUS_RING)}
      >
        {sending ? <span className="channel-spinner" aria-hidden="true" /> : <PiPaperPlaneRightFill aria-hidden="true" className="size-4.5" />}
      </button>
    </div>
  );
}

/** Work attached to the message being written, each with a way to take it off. */
export function AttachedList({ attached, onRemove }: { attached: readonly MessageEmbed[]; onRemove: (embed: MessageEmbed) => void }) {
  if (attached.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5 px-1 pb-1" aria-label="Attached">
      {attached.map((embed) => (
        <li key={embedKey(embed)} className="channel-attached">
          <EmbedIcon embed={embed} />
          <span className="truncate">{embedLabel(embed)}</span>
          <button
            type="button"
            aria-label={`Remove ${embedLabel(embed)}`}
            onClick={() => onRemove(embed)}
            className={cx("channel-attached__remove", FOCUS_RING)}
          >
            <PiX aria-hidden="true" className="size-3.5" />
          </button>
        </li>
      ))}
    </ul>
  );
}

type MentionListProps = {
  listId: string;
  candidates: readonly MentionCandidate[];
  active: number;
  scope: string;
  usage: TemboUsage;
  onChoose: (candidate: MentionCandidate) => void;
};

/**
 * The `@` suggestions, above the box. The textarea keeps focus and the
 * keyboard (aria-activedescendant); options take pointer presses. With Tembo
 * offered, it says what Tembo can read here and today's allowance (m4).
 */
export function MentionList({ listId, candidates, active, scope, usage, onChoose }: MentionListProps) {
  const tembo = candidates.some((candidate) => candidate.kind === "tembo");
  return (
    <div className="channel-mentions">
      {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role, jsx-a11y/no-noninteractive-element-to-interactive-role -- a textarea's suggestion popup: a native select cannot hold people and descriptions */}
      <ul id={listId} role="listbox" aria-label="Suggestions" className="flex flex-col gap-0.5">
        {candidates.map((candidate, index) => (
          // oxlint-disable-next-line jsx-a11y/click-events-have-key-events -- the textarea owns the keyboard; options take pointer presses
          <li
            key={candidate.key}
            id={`${listId}-${index}`}
            // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role, jsx-a11y/no-noninteractive-element-to-interactive-role -- an option of the listbox above
            role="option"
            aria-selected={index === active}
            data-mention-option={candidate.kind}
            // Keep focus in the box, so typing carries on after a pointer choice.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onChoose(candidate)}
            className="channel-mentions__option"
          >
            {candidate.kind === "tembo" ? (
              <TemboMark size="md" decorative />
            ) : (
              <Avatar id={candidate.key} name={candidate.person.name} src={candidate.person.avatarUrl ?? undefined} size="md" decorative />
            )}
            <span className="min-w-0">
              <span className="block font-semibold text-ink-primary">
                {candidate.label}
                {candidate.kind === "tembo" && <span className="channel-ai-badge">AI</span>}
              </span>
              <span className="block text-[0.8125rem] text-ink-secondary">{candidate.description}</span>
            </span>
          </li>
        ))}
      </ul>
      {tembo && (
        <p className="channel-mentions__scope">
          Tembo sees: {scope.charAt(0).toLocaleLowerCase()}
          {scope.slice(1)} You: {usage.used} of {usage.limit} today.
        </p>
      )}
    </div>
  );
}
