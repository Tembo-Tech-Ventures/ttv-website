import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { loadRenderers } from "astro:container";
import { getContainerRenderer } from "@astrojs/react/container-renderer";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { harnessCases } from "@/components/admin/moderation/harness";
import type { QueueViewProps } from "@/components/admin/moderation/page-flow";
import type { RequestNotesViewProps } from "@/components/admin/moderation/request-notes";
import { FIXTURE_NOW, people, pendingMentorRequest } from "@/lib/platform/fixtures";
import type { MentorRequestCase } from "@/lib/platform/contracts";

/*
 * /admin/moderation on the style guide: the two views the page draws, from fixture cases. The queue's
 * decisions, with and without JavaScript, are e2e/platform-moderation.spec.ts (harness) and
 * platform-moderation-queue.spec.ts (the page); Request notes are platform-mentor-request-notes.spec.ts.
 */
vi.mock("cloudflare:workers", () => ({ env: {} }));

const { default: ModerationQueueView } = await import("@/components/admin/moderation/ModerationQueueView.astro");
const { default: RequestNotesView } = await import("@/components/admin/moderation/RequestNotesView.astro");

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});

const pending = harnessCases().filter((item) => item.state === "PENDING");
function queue(props: Partial<QueueViewProps & { requestNotesHref: string; requestNotesCount: number }> = {}) {
  const base: QueueViewProps = {
    state: "PENDING", items: pending, pendingCount: pending.length, formAction: "/admin/moderation",
    tabHrefs: { PENDING: "/admin/moderation", DECIDED: "/admin/moderation?state=DECIDED" }, nextHref: null, paged: false,
  };
  return container.renderToString(ModerationQueueView, { props: { ...base, ...props } });
}

const held: MentorRequestCase = {
  id: pendingMentorRequest.id, request: { ...pendingMentorRequest, check: null }, state: "OPEN",
  clefReasons: ["Harassment"], report: null, openedAt: FIXTURE_NOW - 60_000, decision: null,
  mentorCapacity: { used: 1, limit: 3, nextOpeningAt: null },
};
const reported: MentorRequestCase = {
  ...held, id: "reported-request", request: { ...pendingMentorRequest, id: "reported-request" }, clefReasons: [],
  report: { reason: "Asked for my phone number.", reportedAt: FIXTURE_NOW - 30_000 },
};
function notes(props: Partial<RequestNotesViewProps> = {}) {
  const base: RequestNotesViewProps = {
    state: "OPEN", items: [held, reported], formAction: "/admin/moderation?tab=request-notes",
    tabHrefs: { OPEN: "/admin/moderation?tab=request-notes", DECIDED: "/admin/moderation?tab=request-notes&state=DECIDED" },
    nextHref: null, paged: false,
  };
  const queueTabs = [
    { label: "Needs a decision", href: "/admin/moderation", count: 4 },
    { label: "Decided", href: "/admin/moderation?state=DECIDED" },
    { label: "Request notes", href: "/admin/moderation?tab=request-notes", current: true, count: 2 },
  ];
  return container.renderToString(RequestNotesView, { props: { ...base, ...props, queueTabs, viewerId: people.amina.id } });
}
const count = (html: string, pattern: RegExp) => html.match(pattern)?.length ?? 0;
const nav = (html: string, label: string) => new RegExp(`<nav aria-label="${label}" data-pill-nav[^>]*>([\\s\\S]*?)</nav>`).exec(html)?.[1] ?? "";

describe("the moderation queue on the style guide", () => {
  it("has one display title, and the lists as a PillNav with the waiting count", async () => {
    const html = await queue({ requestNotesHref: "/admin/moderation?tab=request-notes", requestNotesCount: 2 });
    expect(count(html, /<h1\b/g)).toBe(1);
    expect(html).toMatch(/<h1 [^>]*>Moderation<\/h1>/);
    const lists = nav(html, "Moderation lists");
    expect(lists).toMatch(/href="\/admin\/moderation" aria-current="page"[^>]*>Needs a decision<span[^>]*><span aria-hidden="true">4<\/span><span class="sr-only"> 4 waiting<\/span>/);
    expect(lists).toMatch(/>Request notes<span[^>]*><span aria-hidden="true">2<\/span><span class="sr-only"> 2 waiting</);
  });

  it("puts each case on a kit Card under a Maven h2, never in the mentor's ring", async () => {
    const html = await queue();
    expect(count(html, /<li (?=[^>]*\bdata-card\b)[^>]*data-moderation-case=/g)).toBe(pending.length);
    expect(count(html, /<h2 id="moderation-[^"]+-author" class="[^"]*font-body/g)).toBe(pending.length);
    expect(html).not.toMatch(/data-chip="ring"|border-ring|bg-ring/);
    expect(html).not.toMatch(/Duotone|text-\[2\.5rem\]/);
  });

  it("makes Hide and Keep hidden the danger action, and the rest quiet: no peach", async () => {
    const html = await queue();
    const buttons = [...html.matchAll(/<button name="action" value="(\w+)"[^>]*data-variant="(\w+)"/g)].map(([, action, variant]) => `${action}:${variant}`);
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) expect(button).toMatch(/^(hide:danger|keep:quiet|restore:quiet)$/);
    expect(html).not.toContain('data-variant="primary"');
  });

  it("keeps the live error under each reason, from the field recipes, with a 3:1 control edge", async () => {
    const html = await queue();
    const id = pending[0]!.id;
    const field = new RegExp(`<textarea[^>]*id="moderation-${id}-reason"[^>]*>`).exec(html)?.[0] ?? "";
    expect(field).toContain("border-ink-primary/45");
    expect(field).toContain(`aria-describedby="moderation-${id}-hint"`);
    expect(html).toMatch(new RegExp(`<p id="moderation-${id}-error" role="alert" tabindex="-1" class="[^"]*hidden"[^>]*data-moderation-error></p>`));
  });

  it("confirms a decision in a success Notice that takes focus, with the way to the decided cases", async () => {
    const html = await queue({ notice: "Hidden. Members no longer see the message.", noticeSubject: "Collins's message in #general" });
    const notice = /<div id="moderation-notice"[^>]*>[\s\S]*?See decided cases<\/a>/.exec(html)?.[0] ?? "";
    expect(notice).toContain('data-notice="success"');
    expect(notice).toMatch(/autofocus/i);
    expect(notice).toContain("Collins&#x27;s message in #general");
    // The link is the Notice's action, after its words, not part of them.
    expect(notice).toMatch(/<div class="mt-2 flex flex-wrap gap-2"><a href="\/admin\/moderation\?state=DECIDED" data-variant="ghost"/);
  });

  it("says a refusal in a danger Notice that takes focus", async () => {
    const html = await queue({ failure: "Nothing changed. Try again." });
    expect(html).toMatch(/<div id="moderation-failure"[^>]*autofocus[^>]*role="alert"|<div id="moderation-failure"[^>]*role="alert"[^>]*/i);
    expect(html).toMatch(/<div id="moderation-failure"[^>]*data-notice="danger"/);
  });

  it("says what fills an empty list", async () => {
    const html = await queue({ items: [], pendingCount: 0 });
    expect(html).toMatch(/data-empty-state[\s\S]*?<h2[^>]*>Nothing needs a decision<\/h2>/);
  });
});

describe("Request notes on the style guide", () => {
  it("has one display title, both lists as PillNavs, and each request on a Card under a Maven h2", async () => {
    const html = await notes();
    expect(count(html, /<h1\b/g)).toBe(1);
    expect(nav(html, "Moderation lists")).toMatch(/aria-current="page"[^>]*>Request notes/);
    expect(nav(html, "Request notes")).toMatch(/href="\/admin\/moderation\?tab=request-notes" aria-current="page"[^>]*>Waiting for a decision<\/a>/);
    expect(count(html, /<li (?=[^>]*\bdata-card\b)[^>]*data-request-note=/g)).toBe(2);
    expect(count(html, /<h2 id="request-note-[^"]+" class="font-body/g)).toBe(2);
  });

  it("says what raised each request in a neutral or peach chip, never the mentor's ring", async () => {
    const html = await notes();
    expect(html).toMatch(/data-chip="neutral"[^>]*>[\s\S]*?Held by Tembo&#39;s check/);
    expect(html).toMatch(/data-chip="peach"[^>]*>[\s\S]*?Reported by the mentor/);
    expect(html).not.toMatch(/data-chip="ring"|border-primary\/60/);
  });

  it("gives each reason the kit's field, required and unmarked, and makes Remove the danger action", async () => {
    const html = await notes();
    expect(html).not.toContain("(required)");
    expect(html).toMatch(new RegExp(`<textarea[^>]*required[^>]*id="request-note-${held.id}-reason"`));
    expect(count(html, /value="remove"[^>]*data-variant="danger"/g)).toBe(2);
    expect(count(html, /value="keep"[^>]*data-variant="quiet"/g)).toBe(2);
  });

  it("keeps a refused reason in its field, with focus on it", async () => {
    const html = await notes({ rowError: { id: held.id, message: "Write a reason.", draft: "Too short" } });
    const field = new RegExp(`<div data-field="request-note-${held.id}-reason"[\\s\\S]*?Write a reason\\.</p>`).exec(html)?.[0] ?? "";
    expect(field).toMatch(/<textarea[^>]*autofocus/i);
    expect(field).toMatch(/<textarea[^>]*aria-invalid="true"/);
    expect(field).toContain(">Too short</textarea>");
  });

  it("shows a decided request's standing in a success or danger chip, and names the next page", async () => {
    const decision = (action: "keep" | "remove") => ({ action, reason: "Checked", by: people.amina, decidedAt: FIXTURE_NOW });
    const html = await notes({
      state: "DECIDED", nextHref: "/admin/moderation?tab=request-notes&state=DECIDED&cursor=x",
      items: [{ ...held, state: "DECIDED", decision: decision("keep") }, { ...reported, state: "DECIDED", decision: decision("remove") }],
    });
    expect(html).toMatch(/data-chip="success"[^>]*>[\s\S]*?Kept: sent to David/);
    expect(html).toMatch(/data-chip="danger"[^>]*>[\s\S]*?Removed: closed/);
    expect(html).toContain(">Older request notes</a>");
  });
});
