/**
 * DEV harness only (/dev/platform-embeds): every state of the embed cards,
 * at the width a message gives them. Some states (several mentors, none, no
 * evidence link, work that is no longer available) are carried by no fixture message, so
 * they are composed here from the fixtures.
 */
import { people, projects, sessionClip } from "@/lib/platform/fixtures";
import type { MessageEmbedView } from "@/lib/platform/contracts";
import EmbedCard from "../EmbedCard";
import { served } from "./fixture-pages";
import "../channels.css";

const ledger = served(projects.chamaLedger);
const fare = served(projects.fareSplitter);


export const EMBED_SCENES: readonly { key: string; title: string; embed: MessageEmbedView; compact?: boolean }[] = [
  { key: "earlier-revision", title: "A confirmation that covers an earlier revision", embed: ledger },
  { key: "this-revision", title: "Confirmed on the revision that was shared", embed: fare },
  {
    key: "several-mentors",
    title: "Two mentors, one on this revision",
    embed: {
      ...ledger,
      confirmations: [
        { mentorId: people.mercy.id, mentorName: people.mercy.name, version: 3 },
        { mentorId: people.david.id, mentorName: people.david.name, version: 2 },
      ],
    },
  },
  { key: "unconfirmed", title: "No confirmation yet, so none is mentioned", embed: { ...fare, confirmations: [] } },
  { key: "no-link", title: "A project with no evidence link: no way in to draw", embed: { ...ledger, link: null } },
  { key: "compact", title: "Compact, as a thread's first message", embed: ledger, compact: true },
  { key: "clip", title: "A session clip at its moment", embed: sessionClip },
  { key: "gone-project", title: "A project the reader can no longer open", embed: { type: "unavailable", was: "project" } },
  { key: "gone-clip", title: "A session clip the reader can no longer open", embed: { type: "unavailable", was: "sessionClip" } },
];

export default function EmbedGallery() {
  return (
    <ul className="embed-gallery flex flex-col gap-10">
      {EMBED_SCENES.map((scene) => (
        <li key={scene.key} data-scene={scene.key}>
          <p className="text-sm font-semibold text-ink-secondary">{scene.title}</p>
          <EmbedCard embed={scene.embed} compact={scene.compact} />
        </li>
      ))}
    </ul>
  );
}
