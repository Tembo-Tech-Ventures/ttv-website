import type { MouseEvent, ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import TextReaction, { REACTION_KINDS, REACTION_LABELS, reactionName, type TextReactionProps } from "./TextReaction";

const html = renderToStaticMarkup;

/** The rendered <button> element, so its click handler can be called without a DOM. */
function button(props: TextReactionProps) {
  return TextReaction(props) as ReactElement<{ onClick: (event: MouseEvent) => void }>;
}

function click(props: TextReactionProps, defaultPrevented = false) {
  button(props).props.onClick({ defaultPrevented } as MouseEvent);
}

describe("TextReaction", () => {
  it("offers the contract's five reactions, in words", () => {
    expect(REACTION_KINDS).toEqual(["useful", "learned", "thanks", "agree", "congrats"]);
    expect(Object.values(REACTION_LABELS)).toEqual(["Useful", "Learned something", "Thanks", "Agree", "Congrats"]);
  });

  it("is a toggle button whose state says whether it is yours", () => {
    const mine = html(<TextReaction kind="learned" count={4} mine />);
    expect(mine).toContain('aria-pressed="true"');
    expect(mine).toContain("text-peach-ink");
    const theirs = html(<TextReaction kind="useful" count={6} mine={false} />);
    expect(theirs).toContain('aria-pressed="false"');
    expect(theirs).toContain("text-sheet-ink-secondary");
    expect(theirs).toContain('type="button"');
  });

  it("reads as a sentence, and shows a count only when there is one", () => {
    expect(reactionName("useful", 6)).toBe("Useful, 6 people");
    expect(reactionName("thanks", 1)).toBe("Thanks, 1 person");
    expect(reactionName("agree", 0)).toBe("Agree");
    expect(reactionName("congrats", 250)).toBe("Congrats, 99+ people");

    const markup = html(<TextReaction kind="useful" count={6} mine={false} />);
    expect(markup).toContain('aria-label="Useful, 6 people"');
    expect(markup).toContain("· 6");
    expect(html(<TextReaction kind="agree" count={0} mine={false} />)).not.toContain("·");
  });

  it("asks for the membership the reader wants, never a blind toggle", () => {
    const onChange = vi.fn();
    click({ kind: "useful", count: 6, mine: false, onChange });
    click({ kind: "useful", count: 7, mine: true, onChange });
    expect(onChange.mock.calls).toEqual([[true], [false]]);
  });

  it("lets a caller's click handler run first and cancel the change", () => {
    const onChange = vi.fn();
    const onClick = vi.fn();
    click({ kind: "useful", count: 6, mine: false, onChange, onClick }, true);
    expect(onClick).toHaveBeenCalledOnce();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("gives a finger a 44px-tall target without growing the chip", () => {
    const markup = html(<TextReaction kind="useful" count={1} mine={false} />);
    expect(markup).toContain("h-[26px]");
    expect(markup).toContain("pointer-coarse:before:-inset-y-[10px]");
    expect(markup).toContain("focus-visible:outline-primary");
  });
});
