import { useMemo } from "react";
import { cx } from "@/components/platform/ui/cx";
import { FOCUS_RING } from "@/components/platform/ui/Button";
import { parseBody, type BodySegment } from "./channel-format";

type MessageBodyProps = {
  body: string;
  /** Names in this conversation, so "@David Kamau" is read as one mention. */
  names: readonly string[];
  className?: string;
};

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

function Segment({ segment }: { segment: BodySegment }) {
  switch (segment.kind) {
    case "mention":
      return (
        <span className="channel-mention" data-mention={segment.tembo ? "tembo" : "person"}>
          {segment.text}
        </span>
      );
    case "code":
      return <code className="channel-code">{segment.text}</code>;
    case "link":
      return (
        <a href={segment.href} rel="nofollow ugc noopener noreferrer" target="_blank" className={cx("channel-link", FOCUS_RING)}>
          {segment.text}
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      );
    default:
      return segment.text;
  }
}

/**
 * A member's words: paragraphs, mentions, inline code and plain links. React
 * escapes every piece of text, and no markup in a message ever renders.
 */
export default function MessageBody({ body, names, className }: MessageBodyProps) {
  const paragraphs = useMemo(() => keyed(parseBody(body, names)), [body, names]);
  return (
    <div className={cx("channel-body", className)}>
      {paragraphs.map((paragraph) => (
        <p key={paragraph.key}>
          {paragraph.segments.map((segment) => (
            <Segment key={segment.key} segment={segment} />
          ))}
        </p>
      ))}
    </div>
  );
}
