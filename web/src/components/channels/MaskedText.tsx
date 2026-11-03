import { Fragment, type ReactNode } from "react";
import { MASKED_CONTACT } from "@/lib/platform/contracts";
// oxlint-disable-next-line import/no-unassigned-import -- The masked note's style, wherever stored text shows.
import "./masked.css";

/** What a reader sees in place of contact details a moderator has not checked yet (QA2-08). */
export const MASKED_NOTE = "Contact details hidden until a moderator checks this message";

export type MaskedPiece = { kind: "text" | "masked"; text: string; start: number };

/**
 * Stored text split at the server's MASKED_CONTACT markers: the member's words, and in between a
 * marker for each place contact details were taken out. Each piece knows where it starts in the
 * text, so a list of them keys by position, not index. Empty words between markers are dropped.
 */
export function maskedPieces(text: string): MaskedPiece[] {
  const pieces: MaskedPiece[] = [];
  let start = 0;
  text.split(MASKED_CONTACT).forEach((part, index) => {
    if (index > 0) {
      pieces.push({ kind: "masked", text: MASKED_CONTACT, start });
      start += MASKED_CONTACT.length;
    }
    if (part !== "") pieces.push({ kind: "text", text: part, start });
    start += part.length;
  });
  return pieces;
}

type MaskedTextProps = {
  text: string;
  /** How the member's own words render (a search mark, citations). Plain text by default. */
  render?: (words: string) => ReactNode;
  /** Marked as a `note`, as in a message; false inside an element whose children are presentational (a listbox option). */
  asNote?: boolean;
};

const plain = (words: string): ReactNode => words;

/**
 * Stored text (a request note, a reply, a search excerpt, a notice) with every MASKED_CONTACT marker
 * shown as the same inline note as in a channel message, never as the bracketed marker itself (T03).
 */
export default function MaskedText({ text, render = plain, asNote = true }: MaskedTextProps) {
  if (!text.includes(MASKED_CONTACT)) return <>{render(text)}</>;
  return (
    <>
      {maskedPieces(text).map((piece) => (
        <Fragment key={piece.start}>
          {piece.kind === "masked" ? (
            <span className="channel-masked" role={asNote ? "note" : undefined}>{MASKED_NOTE}</span>
          ) : render(piece.text)}
        </Fragment>
      ))}
    </>
  );
}
