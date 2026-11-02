// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Channel, Me, Message } from "@/lib/platform/contracts";
import { ApiError, createApiClient } from "@/lib/platform/client/apiClient";
import { createChannelStore } from "@/lib/platform/client/channel";
import { createComposer } from "@/lib/platform/client/composer";
import type { MockOptions } from "@/lib/platform/client/mockTransport";
import { FIXTURE_NOW, meByPersona, messages } from "@/lib/platform/fixtures";
import type { ModerationActions } from "./actions";
import { moderationFailure, reportReason } from "./channel-format";
import ChannelSurface from "./ChannelSurface";
import { channelFor, channelPage, shareablesFor } from "./harness/fixture-pages";
import { createHarnessClient } from "./harness/harness-client";
import { createModerationActions } from "./moderation-actions";

/*
 * Reporting, hiding and restoring, and asking for a review (U-2.2), on the
 * channel view over the fixture API (harness-client), which answers as B-2.5's
 * routes are specified in contracts.ts.
 */

const showYourWork = (me: Me) => channelFor("show-your-work", me)!;

function setup(me: Me, channel: Channel, options: { failure?: MockOptions["failure"] } = {}) {
  const initial = channelPage(channel, me);
  const now = () => FIXTURE_NOW + 60_000;
  const client = createHarnessClient({ me, channel, root: initial, shareables: shareablesFor(me), now, failure: options.failure });
  const store = createChannelStore({ channelId: channel.id, enabled: true, viewerId: me.user.id, initial, api: client.api });
  const composer = createComposer({ store, me, api: client.api, now });
  const moderation: ModerationActions = createModerationActions({ store, api: client.api });
  return { client, store, composer, moderation };
}

let root: Root;
let container: HTMLDivElement;

const tick = (ms = 0) => new Promise<void>((resolve) => {
  setTimeout(resolve, ms);
});
const frame = () => new Promise<void>((resolve) => {
  requestAnimationFrame(() => resolve());
});
const $ = <T extends Element = HTMLElement>(selector: string, scope: Element | Document = document) => scope.querySelector<T>(selector);
const article = (id: string) => $<HTMLElement>(`[data-message="${id}"]`)!;
const announcer = () => $("[data-channel-announcer]")?.textContent ?? "";

async function click(target: Element | null | undefined) {
  if (!target) throw new Error("Nothing to click");
  await act(async () => {
    (target as HTMLElement).click();
    await tick();
  });
}

async function typeInto(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Open a message's actions and return the menu's item with this name. */
async function menuItem(messageId: string, name: string): Promise<HTMLElement | null> {
  await click(article(messageId).querySelector("button[aria-label^='Actions']"));
  return [...document.querySelectorAll<HTMLElement>("[role=menuitem]")].find((item) => item.textContent?.trim() === name) ?? null;
}

async function menuNames(messageId: string): Promise<string[]> {
  await click(article(messageId).querySelector("button[aria-label^='Actions']"));
  const names = [...document.querySelectorAll<HTMLElement>("[role=menuitem]")].map((item) => item.textContent?.trim() ?? "");
  await act(async () => {
    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await tick();
  });
  return names;
}

async function mount(me: Me, options: Parameters<typeof setup>[2] & { moderation?: "none" } = {}) {
  const channel = showYourWork(me);
  const wired = setup(me, channel, options);
  await act(async () => root.render(
    <ChannelSurface
      me={me}
      channel={channel}
      store={wired.store}
      composer={wired.composer}
      now={FIXTURE_NOW}
      shareables={shareablesFor(me)}
      moderation={options.moderation === "none" ? null : wired.moderation}
    />,
  ));
  await act(tick);
  return wired;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  window.history.replaceState(null, "", "/dashboard/community/c/show-your-work");
  vi.spyOn(window, "matchMedia").mockImplementation((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }) as MediaQueryList);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("reporting a message", () => {
  const wanjiku = meByPersona.wanjiku;

  it("sends the chosen reason and the reporter's words, then says so under the message and in the menu", async () => {
    const { client } = await mount(wanjiku);
    await click(await menuItem(messages.mentorOffer.id, "Report…"));
    const form = $<HTMLFormElement>("[data-panel=report]")!;
    expect(form.getAttribute("aria-labelledby")).toBeTruthy();
    expect($(`#${CSS.escape(form.getAttribute("aria-labelledby")!)}`)?.textContent).toBe("Report Mercy's message");
    // The first choice has focus, and nothing can be sent before a reason is chosen.
    expect(document.activeElement).toBe(form.querySelector("input[type=radio]"));
    expect($<HTMLButtonElement>("button[type=submit]", form)!.disabled).toBe(true);

    await click([...form.querySelectorAll("label")].find((label) => label.textContent === "Spam or unrelated promotion"));
    await typeInto(form.querySelector("textarea")!, "  Third time this week.  ");
    await click($("button[type=submit]", form));
    await act(frame);

    expect(client.moderation()).toEqual([{ kind: "report", messageId: messages.mentorOffer.id, reason: "Spam or unrelated promotion: Third time this week." }]);
    expect($("[data-panel=report]")).toBeNull();
    expect($("[data-reported]", article(messages.mentorOffer.id))?.textContent).toBe("You reported this. A moderator will look at it.");
    expect(announcer()).toBe("Reported. A moderator will look at it.");
    // Focus is back on the message's actions, which now say it was reported, and offer nothing more.
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Actions for Mercy Wambui's message");
    const reported = await menuItem(messages.mentorOffer.id, "Reported");
    expect(reported?.getAttribute("aria-disabled")).toBe("true");
  });

  it("needs words when the reason is something else, and sends only those words", async () => {
    const { client } = await mount(wanjiku);
    await click(await menuItem(messages.firstPr.id, "Report…"));
    const form = $<HTMLFormElement>("[data-panel=report]")!;
    await click([...form.querySelectorAll("label")].find((label) => label.textContent === "Something else"));
    expect(form.textContent).toContain("Tell the moderators what's wrong");
    expect($<HTMLButtonElement>("button[type=submit]", form)!.disabled).toBe(true);
    await typeInto(form.querySelector("textarea")!, "Posted my private notes without asking.");
    await click($("button[type=submit]", form));
    expect(client.moderation()).toEqual([{ kind: "report", messageId: messages.firstPr.id, reason: "Posted my private notes without asking." }]);
  });

  it("keeps the form and says why when the server refuses, and changes nothing", async () => {
    const { client } = await mount(wanjiku, {
      failure: (request) => (request.url.endsWith("/report") ? { status: 429, data: { error: { code: "rate_limited", message: "Slow down", retryAfterMs: 4_000 } } } : undefined),
    });
    await click(await menuItem(messages.mentorOffer.id, "Report…"));
    const form = $<HTMLFormElement>("[data-panel=report]")!;
    await click(form.querySelector("label"));
    await click($("button[type=submit]", form));
    expect($("[role=alert]", form)?.textContent).toBe("That's a lot at once. Try again in 4 seconds.");
    expect($("[data-panel=report]")).not.toBeNull();
    expect($("[data-reported]")).toBeNull();
    expect(client.moderation()).toEqual([]);
  });

  it("closes on Escape or Cancel and returns focus to the message's actions", async () => {
    await mount(wanjiku);
    await click(await menuItem(messages.mentorOffer.id, "Report…"));
    await act(async () => {
      $("[data-panel=report] input")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await act(frame);
    expect($("[data-panel=report]")).toBeNull();
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Actions for Mercy Wambui's message");
  });

  it("is offered on other people's messages and Tembo's, never on your own, a deleted one, or without the server", async () => {
    await mount(wanjiku);
    expect(await menuNames(messages.mentorOffer.id)).toContain("Report…");
    // Nobody here moderates, so nobody hides.
    expect(await menuNames(messages.mentorOffer.id)).not.toContain("Hide from members…");
    expect($("[aria-label^='Actions']", article(messages.deleted.id))).toBeNull();

    await act(async () => root.unmount());
    root = createRoot(container);
    await mount(meByPersona.brian);
    expect(await menuNames(messages.firstPr.id)).not.toContain("Report…");

    await act(async () => root.unmount());
    root = createRoot(container);
    await mount(wanjiku, { moderation: "none" });
    expect(await menuNames(messages.mentorOffer.id)).not.toContain("Report…");
  });
});

describe("hiding, for the channel's moderators, and restoring, for admins", () => {
  const david = meByPersona.david; // a global mentor: moderates community channels
  const amina = meByPersona.amina; // an admin

  it("lets a mentor hide a message with a reason; they still see it, marked, and only an admin restores it", async () => {
    const { client } = await mount(david);
    await click(await menuItem(messages.firstPr.id, "Hide from members…"));
    const form = $<HTMLFormElement>("[data-panel=hide]")!;
    expect(form.textContent).toContain("Brian will still see it, with your reason, and can ask for a review. An admin looks at every hide and can restore it.");
    expect(document.activeElement).toBe(form.querySelector("textarea"));
    expect($<HTMLButtonElement>("button[type=submit]", form)!.disabled).toBe(true);
    await typeInto(form.querySelector("textarea")!, "Off-topic for this channel");
    await click($("button[type=submit]", form));
    await act(frame);

    expect(client.moderation()).toEqual([{ kind: "hide", messageId: messages.firstPr.id, reason: "Off-topic for this channel" }]);
    const note = $("[data-moderation=HIDDEN]", article(messages.firstPr.id));
    expect(note?.textContent).toBe("Hidden from members: Off-topic for this channel. Moderators can still see it.");
    expect(announcer()).toBe("Message hidden from members.");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Actions for Brian Kiprop's message");
    // Hidden messages take no reactions, and a mentor has no way back: that is an admin's decision.
    const names = await menuNames(messages.firstPr.id);
    expect(names).not.toContain("Hide from members…");
    expect(names).not.toContain("Restore for members…");
    expect(names).not.toContain("Congrats");
  });

  it("lets an admin restore a hidden message with a reason", async () => {
    const { client } = await mount(amina);
    await click(await menuItem(messages.hidden.id, "Restore for members…"));
    const form = $<HTMLFormElement>("[data-panel=restore]")!;
    expect(form.textContent).toContain("Everyone in this channel will see it again.");
    await typeInto(form.querySelector("textarea")!, "Reviewed: it's fine");
    await click($("button[type=submit]", form));
    expect(client.moderation()).toEqual([{ kind: "restore", messageId: messages.hidden.id, reason: "Reviewed: it's fine" }]);
    expect($("[data-moderation]", article(messages.hidden.id))).toBeNull();
    expect(announcer()).toBe("Message restored. Members can see it again.");
  });

  it("tells an admin hiding a message that they can restore it later", async () => {
    await mount(amina);
    await click(await menuItem(messages.firstPr.id, "Hide from members…"));
    expect($("[data-panel=hide]")?.textContent).toContain("Brian will still see it, with your reason. You can restore it later.");
  });

  it("never offers hiding your own message", async () => {
    await mount(david);
    expect(await menuNames(messages.projectPost.id)).toContain("Hide from members…");
    expect(await menuNames(messages.hidden.id)).not.toContain("Restore for members…");
  });

  it("leaves the message as it was when the server refuses, and says why", async () => {
    await mount(david, {
      failure: (request) => (request.url.includes("/api/moderation/") ? { status: 409, data: { error: { code: "conflict", message: "No" } } } : undefined),
    });
    await click(await menuItem(messages.firstPr.id, "Hide from members…"));
    await typeInto($<HTMLTextAreaElement>("[data-panel=hide] textarea")!, "Off-topic");
    await click($("[data-panel=hide] button[type=submit]"));
    expect($("[data-panel=hide] [role=alert]")?.textContent).toBe("An admin has already decided on this message, or it has changed. Close this and look again.");
    expect($("[data-moderation]", article(messages.firstPr.id))).toBeNull();
  });
});

describe("the author's own flagged and hidden messages", () => {
  const dennis = meByPersona.dennis;

  it("lets the author of a hidden message ask for a review once, and says it was asked", async () => {
    const { client } = await mount(dennis);
    const message = article(messages.hidden.id);
    expect($("[data-moderation=HIDDEN]", message)?.textContent).toContain("Hidden from the channel: Harsh, not about the work. Only you can see this message now.");
    await click($("[data-ask-review]", message));
    const form = $<HTMLFormElement>("[data-panel=review]")!;
    expect(document.activeElement).toBe(form.querySelector("textarea"));
    await typeInto(form.querySelector("textarea")!, "I meant the pattern, not the person.");
    await click($("button[type=submit]", form));
    await act(frame);

    expect(client.moderation()).toEqual([{ kind: "review", messageId: messages.hidden.id, note: "I meant the pattern, not the person." }]);
    expect($("[data-ask-review]", message)).toBeNull();
    expect(document.activeElement).toBe($("[data-review-requested]", message));
    expect(document.activeElement?.textContent).toBe("Review requested. An admin will look at it again.");
  });

  it("says a review was asked for after a reload, because the server says so, and offers no second ask", async () => {
    await mount(dennis);
    const message = article(messages.hiddenReviewRequested.id);
    expect($("[data-review-requested]", message)?.textContent).toBe("Review requested. An admin will look at it again.");
    expect($("[data-ask-review]", message)).toBeNull();
  });

  it("keeps the form and says why when the server refuses a review, and asks nothing", async () => {
    const { client } = await mount(dennis, {
      failure: (request) => (request.url.endsWith("/review") ? { status: 409, data: { error: { code: "conflict", message: "An admin has already reviewed this message." } } } : undefined),
    });
    const message = article(messages.hidden.id);
    await click($("[data-ask-review]", message));
    const form = $<HTMLFormElement>("[data-panel=review]")!;
    await click($("button[type=submit]", form));
    await act(frame);
    expect($("[role=alert]", form)?.textContent).toBe("An admin has already decided on this message, or it is no longer hidden. Close this and look again.");
    expect(client.moderation()).toEqual([]);
    expect($("[data-review-requested]", message)).toBeNull();
  });

  it("does not tell a mentor who moderates the channel whether the author asked for a review", async () => {
    await mount(meByPersona.david);
    const message = article(messages.hiddenReviewRequested.id);
    expect($("[data-moderation=HIDDEN]", message)).not.toBeNull();
    expect($("[data-review-requested]", message)).toBeNull();
  });

  it("offers deleting a hidden message, not editing it", async () => {
    await mount(dennis);
    const names = await menuNames(messages.hidden.id);
    expect(names).toContain("Delete…");
    expect(names).not.toContain("Edit");
    expect(names).not.toContain("Report…");
  });

  it("tells the author of a flagged message it stays up, and offers no review: a person already will look", async () => {
    const peter = meByPersona.peter;
    const channel = channelFor("opportunities", peter)!;
    const wired = setup(peter, channel);
    await act(async () => root.render(
      <ChannelSurface me={peter} channel={channel} store={wired.store} composer={wired.composer} now={FIXTURE_NOW} shareables={null} moderation={wired.moderation} />,
    ));
    await act(tick);
    const note = $("[data-moderation=FLAGGED]", article(messages.flagged.id));
    expect(note?.textContent).toContain("Your message stays up until a person looks at it.");
    expect($("[data-ask-review]")).toBeNull();
  });
});

describe("server rendering", () => {
  it("renders the menu button but no forms, so reading without JavaScript is unchanged", () => {
    const me = meByPersona.david;
    const channel = showYourWork(me);
    const { store, composer, moderation } = setup(me, channel);
    const html = renderToString(
      <ChannelSurface me={me} channel={channel} store={store} composer={composer} now={FIXTURE_NOW} shareables={null} moderation={moderation} />,
    );
    expect(html).not.toContain("channel-panel");
    expect(html.replaceAll("<!-- -->", "")).toContain("Hidden from members: Harsh, not about the work.</strong> Moderators can still see it.");
  });
});

describe("createModerationActions", () => {
  function client(reply: (request: Request) => { status?: number; data: unknown }) {
    const seen: { method: string; path: string; body: unknown }[] = [];
    const api = createApiClient({
      retry: { maxRetries: 0 },
      fetch: async (input, init) => {
        const request = new Request(input, init);
        seen.push({ method: request.method, path: new URL(request.url).pathname, body: await request.clone().json() });
        const { status = 200, data } = reply(request);
        return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
      },
    });
    return { api, seen };
  }

  it("reports through B-2.5's route and touches no cached message", async () => {
    const { api, seen } = client(() => ({ data: { ok: true } }));
    const update = vi.fn();
    await createModerationActions({ store: { update }, api }).report("s00000000000000000000408", "Spam or unrelated promotion");
    expect(seen).toEqual([{ method: "POST", path: "/api/messages/s00000000000000000000408/report", body: { reason: "Spam or unrelated promotion" } }]);
    expect(update).not.toHaveBeenCalled();
  });

  it("moderates through B-2.5's route and replaces the cached copy with the confirmed one", async () => {
    const hidden: Message = { ...messages.firstPr, moderation: { state: "HIDDEN", reasons: ["Off-topic"] } };
    const { api, seen } = client(() => ({ data: hidden }));
    const update = vi.fn();
    const result = await createModerationActions({ store: { update }, api }).moderate(messages.firstPr.id, "hide", "Off-topic");
    expect(seen).toEqual([{ method: "POST", path: `/api/moderation/${messages.firstPr.id}`, body: { action: "hide", reason: "Off-topic" } }]);
    expect(update).toHaveBeenCalledWith([hidden]);
    expect(result).toEqual(hidden);
  });

  it("asks for a review through B-2.5's route, with the note only when there is one", async () => {
    const { api, seen } = client(() => ({ data: { ok: true } }));
    const update = vi.fn();
    const actions = createModerationActions({ store: { update }, api });
    await actions.requestReview(messages.hidden.id, "I was quoting the brief.");
    await actions.requestReview(messages.hidden.id, null);
    expect(seen).toEqual([
      { method: "POST", path: `/api/messages/${messages.hidden.id}/review`, body: { note: "I was quoting the brief." } },
      { method: "POST", path: `/api/messages/${messages.hidden.id}/review`, body: {} },
    ]);
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects with the server's error and changes nothing", async () => {
    const { api } = client(() => ({ status: 409, data: { error: { code: "conflict", message: "Changed" } } }));
    const update = vi.fn();
    await expect(createModerationActions({ store: { update }, api }).moderate("x", "restore", "Fine")).rejects.toMatchObject({ code: "conflict", status: 409 });
    expect(update).not.toHaveBeenCalled();
  });

  it("gives up on a request that never answers", async () => {
    const api = createApiClient({ retry: { maxRetries: 0 } });
    const hang = vi.spyOn(api, "call").mockImplementation((_route, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(new ApiError("aborted", 0, "Request aborted")));
    }));
    await expect(createModerationActions({ store: { update: vi.fn() }, api, timeoutMs: 5 }).report("x", "Spam")).rejects.toMatchObject({ code: "aborted" });
    expect(hang).toHaveBeenCalledOnce();
  });
});

describe("words", () => {
  it("joins the chosen reason and the reporter's words, and needs words for something else", () => {
    expect(reportReason("unkind", "")).toBe("Unkind or disrespectful");
    expect(reportReason("personal", " my number ")).toBe("Shares someone's contact or personal details: my number");
    expect(reportReason("other", "   ")).toBeNull();
    expect(reportReason("other", "x".repeat(2_100))).toHaveLength(2_000);
  });

  it("says why a moderation step failed in words a person can act on", () => {
    expect(moderationFailure(new ApiError("rate_limited", 429, "x"), "report")).toBe("That's a lot at once. Try again in a moment.");
    expect(moderationFailure(new ApiError("rate_limited", 429, "x", 1_200), "report")).toBe("That's a lot at once. Try again in 2 seconds.");
    expect(moderationFailure(new ApiError("not_found", 404, "x"), "moderate")).toBe("That message is no longer here.");
    expect(moderationFailure(new ApiError("conflict", 409, "x"), "report")).toBe("That message has changed since you opened this. Close it and look again.");
    expect(moderationFailure(new ApiError("forbidden", 403, "x"), "moderate")).toBe("You can't moderate this channel.");
    expect(moderationFailure(new ApiError("forbidden", 403, "x"), "report")).toBe("You can't report this message.");
    expect(moderationFailure(new ApiError("forbidden", 403, "x"), "review")).toBe("You can ask for a review of your own messages only.");
    expect(moderationFailure(new ApiError("conflict", 409, "x"), "review")).toBe("An admin has already decided on this message, or it is no longer hidden. Close this and look again.");
    expect(moderationFailure(new ApiError("conflict", 409, "x"), "moderate")).toBe("An admin has already decided on this message, or it has changed. Close this and look again.");
    expect(moderationFailure(new ApiError("network_error", 0, "x"), "report")).toBe("Couldn't reach TTV. Check your connection and try again.");
    expect(moderationFailure(new ApiError("server", 500, "x"), "report")).toBe("Something went wrong on our side. Try again.");
    expect(moderationFailure(new ApiError("unauthorized", 401, "x"), "report")).toBe("Your session ended. Sign in again, then try again.");
  });
});
