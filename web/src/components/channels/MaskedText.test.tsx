import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MASKED_CONTACT } from "@/lib/platform/contracts";
import MaskedText, { MASKED_NOTE, maskedPieces } from "./MaskedText";

const NOTE = `<span class="channel-masked" role="note">${MASKED_NOTE}</span>`;

describe("MaskedText (T03)", () => {
  it("splits stored text at each marker, each piece knowing where it starts", () => {
    const text = `WhatsApp me on ${MASKED_CONTACT} or ${MASKED_CONTACT}.`;
    expect(maskedPieces(text)).toEqual([
      { kind: "text", text: "WhatsApp me on ", start: 0 },
      { kind: "masked", text: MASKED_CONTACT, start: 15 },
      { kind: "text", text: " or ", start: 15 + MASKED_CONTACT.length },
      { kind: "masked", text: MASKED_CONTACT, start: 19 + MASKED_CONTACT.length },
      { kind: "text", text: ".", start: 19 + 2 * MASKED_CONTACT.length },
    ]);
    expect(maskedPieces(MASKED_CONTACT)).toEqual([{ kind: "masked", text: MASKED_CONTACT, start: 0 }]);
  });

  it("shows each marker as the channels' inline note, never the bracketed marker", () => {
    const html = renderToStaticMarkup(<MaskedText text={`Call ${MASKED_CONTACT} today`} />);
    expect(html).toBe(`Call ${NOTE} today`);
    expect(html).not.toContain(MASKED_CONTACT);
  });

  it("leaves text without a marker as it is, and escapes it", () => {
    expect(renderToStaticMarkup(<MaskedText text="<b>hi</b> [contact]" />)).toBe("&lt;b&gt;hi&lt;/b&gt; [contact]");
  });

  it("renders the words between markers its caller's way, and drops the note role where children are presentational", () => {
    const html = renderToStaticMarkup(<MaskedText text={`a ${MASKED_CONTACT} b`} asNote={false} render={(words) => <mark>{words}</mark>} />);
    expect(html).toBe(`<mark>a </mark><span class="channel-masked">${MASKED_NOTE}</span><mark> b</mark>`);
  });
});
