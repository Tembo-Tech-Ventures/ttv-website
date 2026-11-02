import { Fragment, useMemo, type ReactNode } from "react";
import { cx } from "@/components/platform/ui/cx";
import { FOCUS_RING } from "@/components/platform/ui/Button";
import { MASKED_CONTACT, type Citation } from "@/lib/platform/contracts";
import { parseBody, type BodySegment } from "./channel-format";

type MessageBodyProps = {
  body: string;
  /** Names in this conversation, so "@David Kamau" is read as one mention. */
  names: readonly string[];
  /** A Tembo answer's sources: each `[n]` in its words links to citations[n - 1] (QA3-02). */
  citations?: readonly Citation[];
  className?: string;
};

const NO_CITATIONS: readonly Citation[] = [];

type Keyed<T> = T & { key: string };

/** Key every piece by where it starts in the body, so React matches pieces by content position, not list index. */
function keyed(paragraphs: BodySegment[][]): Keyed<{ segments: Keyed<BodySegment>[] }>[] {
  let offset = 0;
  return paragraphs.map((segments) => {
    const start = offset;
    const pieces = segments.map((segment) => {
      const piece = { ...segment, key: `${segment.kind}-${offset}` };
      offset += segment.text.length;
      return piece;
    });
    offset += 1;
    return { key: `p-${start}`, segments: pieces };
  });
}

function Segment({ segment, citations }: { segment: BodySegment; citations: readonly Citation[] }) {
  switch (segment.kind) {
    case "mention":
      return (
        <span className="channel-mention" data-mention={segment.tembo ? "tembo" : "person"}>
          <Masked text={segment.text} citations={NO_CITATIONS} />
        </span>
      );
    case "code":
      return <code className="channel-code"><Masked text={segment.text} citations={NO_CITATIONS} /></code>;
    case "link":
      return (
        <a href={segment.href} rel="nofollow ugc noopener noreferrer" target="_blank" className={cx("channel-link", FOCUS_RING)}>
          {segment.text}
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      );
    default:
      return <Masked text={segment.text} citations={citations} />;
  }
}

/**
 * The server's numbered markers in a Tembo answer, as grounding.ts writes them: after a space or
 * another marker, and before another marker, a sentence stop or the end of the line. So `arr[1]` in
 * the prose stays text.
 */
const MARKER = /(?<=\s|\])\[(\d{1,2})\](?=\[\d|[.!?…"”’)]*(?:\s|$))/gu;

/**
 * Text with each `[n]` naming one of `citations` as a link to that source, labelled with it, so a
 * reader can tell which source supports which sentence (QA3-02). Other brackets stay text.
 */
function Cited({ text, citations }: { text: string; citations: readonly Citation[] }) {
  if (citations.length === 0) return text;
  const pieces: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(MARKER)) {
    const n = Number(match[1]);
    const citation = citations[n - 1];
    if (!citation) continue;
    // The space before a sentence's first marker doesn't break, so a marker never wraps alone onto a line.
    if (match.index > last) pieces.push(text.slice(last, match.index).replace(/ $/u, "\u00A0"));
    pieces.push(
      <a key={match.index} href={citation.href} className={cx("channel-cite-ref", FOCUS_RING)} data-cite={n} aria-label={`Source ${n}: ${citation.title}`}>
        <sup aria-hidden="true">{n}</sup>
      </a>,
    );
    last = match.index + match[0].length;
  }
  if (last === 0) return text;
  if (last < text.length) pieces.push(text.slice(last));
  return pieces;
}

/**
 * Text with the server's MASKED_CONTACT markers shown as a note, not as the member's words: contact
 * details a moderator has not checked yet (QA2-08).
 */
function Masked({ text, citations }: { text: string; citations: readonly Citation[] }) {
  if (!text.includes(MASKED_CONTACT)) return <Cited text={text} citations={citations} />;
  // Each piece is keyed by where it starts in the text.
  let offset = 0;
  return text.split(MASKED_CONTACT).map((part, i) => {
    const start = offset;
    offset += part.length + MASKED_CONTACT.length;
    return (
      <Fragment key={start}>
        {i > 0 && (
          <span className="channel-masked" role="note">
            Contact details hidden until a moderator checks this message
          </span>
        )}
        <Cited text={part} citations={citations} />
      </Fragment>
    );
  });
}

/**
 * A member's words: paragraphs, mentions, inline code and plain links. React
 * escapes every piece of text, and no markup in a message ever renders.
 */
export default function MessageBody({ body, names, citations = NO_CITATIONS, className }: MessageBodyProps) {
  const paragraphs = useMemo(() => keyed(parseBody(body, names)), [body, names]);
  return (
    <div className={cx("channel-body", className)}>
      {paragraphs.map((paragraph) => (
        <p key={paragraph.key}>
          {paragraph.segments.map((segment) => (
            <Segment key={segment.key} segment={segment} citations={citations} />
          ))}
        </p>
      ))}
    </div>
  );
}
