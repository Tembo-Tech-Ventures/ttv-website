import type { ReactNode } from "react";
import { PiAt, PiFolderSimple, PiPaperPlaneRightFill, PiPlus, PiSparkle, PiVideoCamera, PiX } from "react-icons/pi";
import type { MessageEmbed, TemboUsage } from "@/lib/platform/contracts";
import Avatar from "@/components/platform/ui/Avatar";
import Button from "@/components/platform/ui/Button";
import { cx } from "@/components/platform/ui/cx";
import IconButton from "@/components/platform/ui/IconButton";
import Menu, { MenuItem, MenuSection } from "@/components/platform/ui/Menu";
import RoleBadge from "@/components/platform/ui/RoleBadge";
import TemboMark from "@/components/platform/ui/TemboMark";
import { RAISED } from "@/components/platform/ui/tones";
import { sameEmbed, type Shareables } from "./actions";
import { clipTime, type ComposerTools } from "./channel-format";
import type { MentionCandidate } from "./mentions";

export const MAX_EMBEDS = 5;

/** What "Ask Tembo here" does, unlike the private Ask Tembo page (QA3-03, QA3-15). */
export const ASK_HERE = "Adds @tembo to your message. Everyone who can read this channel sees the question and Tembo's answer.";
/** The same, in one line under a narrow composer. */
export const ASK_HERE_SHORT = "Ask Tembo here: everyone in this channel sees it.";

/** Tembo's badge, as the server words it on Tembo's own messages. */
const AI_BADGE = { kind: "AI", label: "AI" } as const;

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
    <MenuSection heading={title}>
      {items.length === 0 && <MenuItem disabled>{empty}</MenuItem>}
      {items.map((embed) => {
        const already = attached.some((item) => sameEmbed(item, embed));
        return (
          <MenuItem
            key={embedKey(embed)}
            disabled={already || attached.length >= MAX_EMBEDS}
            icon={<EmbedIcon embed={embed} />}
            onSelect={() => onPick(embed)}
          >
            {embedLabel(embed)}
            {already && <span className="text-ink-muted"> (attached)</span>}
          </MenuItem>
        );
      })}
    </MenuSection>
  );
}

const ProjectSection = ({ shareables, ...pick }: PickProps & { shareables: Shareables }) => (
  <AttachSection title="Share a project" items={shareables.projects} empty="You have no projects to share yet." {...pick} />
);
/** In the narrow composer's "+" menu: the way to the clip finder, which needs room for its words. */
const ClipSection = ({ onFindClip }: { onFindClip: () => void }) => (
  <MenuSection heading="Share a session clip">
    <MenuItem icon={<PiVideoCamera className="size-4" />} onSelect={onFindClip} data-find-clip>
      Find a moment…
    </MenuItem>
  </MenuSection>
);

/** A composer tool that opens a menu above the box. */
function ToolMenu({ label, icon, children, iconOnly = false }: { label: string; icon: ReactNode; children: ReactNode; iconOnly?: boolean }) {
  return (
    <Menu label={label} icon={icon} iconOnly={iconOnly} variant="ghost" size="sm" placement="top">
      {children}
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
  /** The clip finder is open; it belongs to the box with this id. */
  clipFinder: { open: boolean; id: string };
  /** The visible line under the box that says what "Ask Tembo here" does. */
  askHereId: string;
  onFindClip: (trigger: HTMLElement | null) => void;
  onMention: () => void;
  onAskTembo: () => void;
};

/**
 * Share project and, in cohort channels only, Session clip; on a narrow
 * composer both fold under "+". Then @, Ask Tembo (only while
 * `tembo_channels` is on) and Send, which is always visible. Send is the
 * view's one peach action, and only once there is something to send.
 */
export function ComposerToolbar({
  tools, shareables, attachments, thread, canSend, clipFinder, askHereId, onFindClip, onMention, onAskTembo, ...pick
}: ToolbarProps) {
  return (
    <div className="channel-composer__bar">
      {attachments && (
        <>
          <div className="channel-composer__attach">
            <ToolMenu label="Attach work" icon={<PiPlus className="size-4.5" />} iconOnly>
              <ProjectSection shareables={shareables} {...pick} />
              {/* The menu item goes with the menu: closing the finder returns focus to the box instead. */}
              {tools.sessionClip && <ClipSection onFindClip={() => onFindClip(null)} />}
            </ToolMenu>
          </div>
          <div className="channel-composer__wide-tools">
            <ToolMenu label="Share project" icon={<PiFolderSimple className="size-4.5" />}>
              <ProjectSection shareables={shareables} {...pick} />
            </ToolMenu>
            {tools.sessionClip && (
              <Button
                variant="ghost"
                size="sm"
                icon={<PiVideoCamera className="size-4.5" />}
                aria-expanded={clipFinder.open}
                aria-controls={clipFinder.open ? clipFinder.id : undefined}
                onClick={(event) => onFindClip(event.currentTarget)}
                data-find-clip
              >
                Session clip
              </Button>
            )}
          </div>
        </>
      )}
      <IconButton label="Mention someone" icon={<PiAt className="size-4.5" />} variant="ghost" size="sm" onClick={onMention} />
      {tools.askTembo && (
        // "here", unlike the private Ask Tembo page: this one posts in the channel (QA3-03), as the line under the box says.
        <Button variant="ghost" size="sm" icon={<PiSparkle className="size-4.5" />} onClick={onAskTembo} aria-describedby={askHereId} data-ask-tembo>
          Ask Tembo here
        </Button>
      )}
      <IconButton
        type="submit"
        label={thread ? "Send reply" : "Send message"}
        icon={<PiPaperPlaneRightFill className="size-4.5" />}
        variant={canSend ? "primary" : "quiet"}
        aria-disabled={!canSend || undefined}
        className="ml-auto aria-disabled:cursor-not-allowed"
      />
    </div>
  );
}

/** Work attached to the message being written, each with a way to take it off. */
export function AttachedList({ attached, onRemove }: { attached: readonly MessageEmbed[]; onRemove: (embed: MessageEmbed) => void }) {
  if (attached.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5 px-1 pb-1" aria-label="Attached">
      {attached.map((embed) => (
        <li
          key={embedKey(embed)}
          className={cx("channel-attached flex max-w-full min-w-0 items-center gap-1.5 rounded-lg border border-hairline pl-2.5 text-[0.8125rem] text-ink-primary", RAISED)}
        >
          <EmbedIcon embed={embed} />
          <span className="min-w-0 truncate">{embedLabel(embed)}</span>
          <IconButton label={`Remove ${embedLabel(embed)}`} icon={<PiX className="size-3.5" />} variant="ghost" size="sm" onClick={() => onRemove(embed)} />
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
                {candidate.kind === "tembo" && <RoleBadge badge={AI_BADGE} className="ml-2 align-middle" />}
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

/**
 * Under the channel's box: what Tembo reads here, and the reader's questions in channels today (02, QA3-04). A narrow
 * composer shows the short form (`reach`, channels.css), so a phone still says what Tembo sees.
 */
export function TemboScopeNote({ scope, reach, usage }: { scope: string; reach: string; usage: TemboUsage }) {
  const spent = usage.used >= usage.limit;
  return (
    <p className="channel-composer__scope" data-tembo-scope>
      <span className="channel-composer__scope-wide">
        <span className="font-semibold text-ink-secondary">Tembo</span> · Sees: {scope} · You: {usage.used} of {usage.limit} in channels today
        {spent && <> · No questions left in channels today; more after midnight East Africa Time</>}
      </span>
      <span className="channel-composer__scope-narrow">
        <span className="font-semibold text-ink-secondary">Tembo</span> sees {reach} · {spent ? "No questions left in channels today" : `${usage.used} of ${usage.limit} in channels today`}
      </span>
    </p>
  );
}
