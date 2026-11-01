import type { MouseEvent } from "react";
import type { IconType } from "react-icons";
import {
  PiAt,
  PiBriefcase,
  PiChatCircleText,
  PiEnvelopeSimple,
  PiEyeSlash,
  PiHandshake,
  PiKey,
  PiPaperPlaneTilt,
  PiSealCheck,
  PiShieldCheck,
  PiUserPlus,
  PiVideoCamera,
} from "react-icons/pi";
import type { AttentionItem, AttentionKind } from "@/lib/platform/contracts";
import { Avatar, SpaceGlyph, TemboMark } from "@/components/platform/ui";
import { FOCUS_RING } from "@/components/platform/ui/Button";
import { cx } from "@/components/platform/ui/cx";
import { attentionActor, attentionPlace, attentionTime, summaryLead } from "./attention-display";

const KIND_ICON: Record<AttentionKind, IconType> = {
  mention: PiAt,
  reply: PiChatCircleText,
  tembo_answer: PiChatCircleText,
  mentor_request: PiHandshake,
  mentor_accepted: PiHandshake,
  mentor_redirected: PiHandshake,
  mentor_declined: PiHandshake,
  mentor_withdrawn: PiHandshake,
  recording_ready: PiVideoCamera,
  application_status: PiPaperPlaneTilt,
  work_confirmed: PiSealCheck,
  visitor_message: PiEnvelopeSimple,
  opportunity_match: PiBriefcase,
  moderation_pending: PiShieldCheck,
  message_hidden: PiEyeSlash,
  access_request: PiUserPlus,
  access_decided: PiKey,
};

type Viewer = { id: string; name: string; src?: string };

type AttentionItemRowProps = {
  item: AttentionItem;
  /** The time "now" is measured from. The list's snapshot until the browser takes over, so hydration agrees. */
  now: number;
  viewer: Viewer;
  /** Opening an item marks it read; the row only reports the click. */
  onOpen: (item: AttentionItem, event: MouseEvent<HTMLAnchorElement>) => void;
};

function Leading({ item }: { item: AttentionItem }) {
  const actor = attentionActor(item);
  if (item.kind === "tembo_answer") return <TemboMark size="lg" decorative />;
  if (actor) {
    const mentor = actor.roleBadges.some((badge) => badge.kind === "MENTOR");
    return <Avatar id={actor.id} name={actor.name} src={actor.avatarUrl ?? undefined} size="lg" mentor={mentor} decorative />;
  }
  const Icon = KIND_ICON[item.kind];
  return (
    <span aria-hidden="true" className="attention-item__icon">
      <Icon className="size-[1.375rem]" />
    </span>
  );
}

/**
 * One thing that needs the person: who or what, where it happened, how long
 * ago, and an unread dot. The whole row is the link to it.
 */
export default function AttentionItemRow({ item, now, viewer, onOpen }: AttentionItemRowProps) {
  const actor = attentionActor(item);
  const split = summaryLead(item, item.kind === "tembo_answer" ? "Tembo" : (actor?.name ?? null));
  const time = attentionTime(item.createdAt, now);
  const unread = item.readAt === null;

  return (
    <li className="attention-item" data-attention-item={item.id} data-unread={unread || undefined}>
      <a href={item.subject.href} onClick={(event) => onOpen(item, event)} className={cx("attention-item__link", FOCUS_RING)}>
        <Leading item={item} />
        <span className="attention-item__body">
          <span className="attention-item__summary">
            {unread && <span className="sr-only">Unread: </span>}
            {split ? (
              <>
                <strong className="font-bold text-ink-primary">{split.lead}</strong>
                {split.rest}
              </>
            ) : (
              item.summary
            )}
          </span>
          <span className="attention-item__place">
            <span aria-hidden="true" className="inline-flex shrink-0 items-center">
              <SpaceGlyph space={item.space} person={viewer} />
            </span>
            <span className="min-w-0 break-words">{attentionPlace(item)}</span>
          </span>
        </span>
        <span className="attention-item__aside">
          <time dateTime={new Date(item.createdAt).toISOString()} title={time.title} className="attention-item__time">
            {time.text}
            {time.relative && <span className="sr-only"> ago</span>}
          </time>
          {unread && <span aria-hidden="true" className="attention-item__dot" />}
        </span>
      </a>
    </li>
  );
}
