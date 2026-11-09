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
// The danger Notice's title: the alert also holds its spoken "Problem: " and its two actions.
const alertText = () => container.querySelector('[role="alert"] p')?.textContent ?? null;

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
    await act(async () => root.render(<ChatApp />));
    chatReplies.push({ status: 500, body: { error: "The chat request could not be completed." } });
    await ask("Where did we cover joins?");
  });

  it("says it got no answer and offers to ask again or change it", () => {
    expect(alertText()).toBe("That question didn't get an answer.");
    expect(button("Try again")).toBeDefined();
    expect(button("Edit question")).toBeDefined();
  });

  it("says so in the kit's danger Notice, with its two ways forward inside it", () => {
    const notice = container.querySelector('[data-notice="danger"]')!;
    expect(notice.getAttribute("role")).toBe("alert");
    expect(notice.textContent).toContain("Problem: ");
    // Asking again is the way forward; neither is peach, which is Send's alone.
    expect(notice.contains(button("Try again")!)).toBe(true);
    expect(button("Try again")!.dataset.variant).toBe("quiet");
    expect(button("Edit question")!.dataset.variant).toBe("ghost");
    expect(notice.contains(button("Edit question")!)).toBe(true);
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

describe("a question asked after the session ended", () => {
  beforeEach(async () => {
    await act(async () => root.render(<ChatApp />));
    chatReplies.push({ status: 401, body: { error: "Unauthorized" } });
    await ask("What did week 3 cover?");
  });

  it("says you've been signed out and offers to sign in again, back to this page", () => {
    const notice = container.querySelector("[data-chat-signed-out]")!;
    expect(notice.textContent).toContain("You've been signed out");
    const signIn = Array.from(notice.querySelectorAll("a")).find((link) => link.textContent === "Sign in again");
    expect(signIn?.getAttribute("href")).toBe(`/auth/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    // Not a retry that can't work, and not a second peach control beside Send.
    expect(button("Try again")).toBeUndefined();
    expect(signIn?.getAttribute("data-variant")).toBe("quiet");
  });

  it("puts the question back in the box and leaves no unanswered bubble", () => {
    expect(composer().value).toBe("What did week 3 cover?");
    expect(container.textContent).not.toContain("That question didn't get an answer.");
    expect(asked).toHaveLength(1);
  });
});

describe("opening the page after the session ended", () => {
  it("says you've been signed out instead of a loading error", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => json(url === "/api/chat/sessions" ? { status: 401, body: { error: "Unauthorized" } } : { status: 200, body: { suggestions: [] } })));
    await act(async () => root.render(<ChatApp />));
    expect(container.querySelector("[data-chat-signed-out]")).not.toBeNull();
    expect(alertText()).toBeNull();
  });
});
