// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ChatApp from "./ChatApp";

type Reply = { status: number; body: unknown };

let root: Root;
let container: HTMLDivElement;
let chatReplies: Reply[];
let asked: { message: string; conversationHistory: unknown[] }[];

function json({ status, body }: Reply) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  chatReplies = [];
  asked = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/chat/sessions") return json({ status: 200, body: { sessions: [] } });
    if (url === "/api/chat/suggestions") return json({ status: 200, body: { suggestions: [] } });
    if (url === "/api/chat") {
      asked.push(JSON.parse(String(init?.body)));
      return json(chatReplies.shift() ?? { status: 500, body: { error: "The chat request could not be completed." } });
    }
    throw new Error(`unexpected ${url}`);
  }));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const composer = () => container.querySelector<HTMLTextAreaElement>("#chat-composer")!;
const button = (name: string) => Array.from(container.querySelectorAll("button")).find((element) => element.textContent === name);
const alertText = () => container.querySelector('[role="alert"]')?.textContent ?? null;

async function ask(question: string) {
  const textarea = composer();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    setter.call(textarea, question);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => textarea.form!.requestSubmit());
}

describe("a question that fails", () => {
  beforeEach(async () => {
    await act(async () => root.render(<ChatApp variant="space" />));
    chatReplies.push({ status: 500, body: { error: "The chat request could not be completed." } });
    await ask("Where did we cover joins?");
  });

  it("says it got no answer and offers to ask again or change it", () => {
    expect(alertText()).toBe("That question didn't get an answer.");
    expect(button("Try again")).toBeDefined();
    expect(button("Edit question")).toBeDefined();
  });

  it("asks the same question again, in the same conversation, and answers it", async () => {
    chatReplies.push({ status: 200, body: { answer: "In week 4.", citations: [], sessionId: null } });
    button("Try again")!.focus();
    await act(async () => button("Try again")!.click());
    // The button goes as the question is asked again; focus waits in the composer, not on the page.
    expect(document.activeElement).toBe(composer());
    expect(asked).toHaveLength(2);
    expect(asked[1]!.message).toBe("Where did we cover joins?");
    // Asked once: the failed copy is not left in the history it is sent with.
    expect(asked[1]!.conversationHistory).toEqual([{ role: "user", content: "Where did we cover joins?" }]);
    expect(alertText()).toBeNull();
    expect(container.textContent).toContain("In week 4.");
    expect(container.textContent?.match(/Where did we cover joins\?/g)).toHaveLength(1);
  });

  it("puts the question back in the box, unsent, to change it first", async () => {
    await act(async () => button("Edit question")!.click());
    expect(composer().value).toBe("Where did we cover joins?");
    expect(document.activeElement).toBe(composer());
    expect(alertText()).toBeNull();
    expect(asked).toHaveLength(1);
    // The unanswered copy leaves the transcript; sending again adds it back once.
    expect(container.querySelector("[data-message-index]")).toBeNull();
  });
});
