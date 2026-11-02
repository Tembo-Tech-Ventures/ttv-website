import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MASKED_CONTACT, type Citation } from "@/lib/platform/contracts";
import MessageBody from "./MessageBody";

const html = (body: string) => renderToStaticMarkup(<MessageBody body={body} names={["Achieng Atieno"]} />).replaceAll("<!-- -->", "");

describe("masked contact details (QA2-08)", () => {
  it("shows each marker as a note beside the member's words", () => {
    const markup = html(`Hi @Achieng Atieno, call ${MASKED_CONTACT} or ${MASKED_CONTACT}. Friday!`);
    const note = '<span class="channel-masked" role="note">Contact details hidden until a moderator checks this message</span>';
    expect(markup).toContain(`call ${note} or ${note}. Friday!`);
    expect(markup).toContain('<span class="channel-mention" data-mention="person">@Achieng Atieno</span>');
    expect(markup).not.toContain(MASKED_CONTACT);
  });

  it("shows a marker inside inline code as the note too", () => {
    const markup = html(`call \`${MASKED_CONTACT}\` now`);
    expect(markup).toContain('<code class="channel-code"><span class="channel-masked" role="note">');
    expect(markup).not.toContain(MASKED_CONTACT);
  });

  it("shows a marker inside a web address as the note, never as a broken link (#297 follow-up)", () => {
    const markup = html(`Chat on https://wa.me/${MASKED_CONTACT}?text=hi`);
    expect(markup).toContain('>https://wa.me/<span class="sr-only"> (opens in a new tab)</span></a>');
    expect(markup).toContain('<span class="channel-masked" role="note">Contact details hidden until a moderator checks this message</span>?text=hi');
    expect(markup).not.toContain("[contact");
  });

  it("leaves a body without markers as it was", () => {
    expect(html("Call me after class")).toBe('<div class="channel-body"><p>Call me after class</p></div>');
  });
});

describe("a Tembo answer's markers (QA3-02)", () => {
  const citations: Citation[] = [
    { type: "sessionClip", recordingId: "rec-5", startSeconds: 40, title: "Week 5: REST APIs at 0:40", href: "/dashboard/sessions/rec-5?t=40" },
    { type: "message", messageId: "m-1", channelId: "c-1", title: "Wanjiku Mwangi: “Page with a cursor”", href: "/dashboard/cohort/c/cohort-05?message=m-1" },
  ];
  const cited = (body: string) =>
    renderToStaticMarkup(<MessageBody body={body} names={[]} citations={citations} />).replaceAll("<!-- -->", "");

  it("links each [n] to the source it names, labelled with it, beside the sentence it supports", () => {
    const markup = cited("Use a cursor [1][2]. Offsets drift [1].");
    expect(markup).toContain('Use a cursor <a href="/dashboard/sessions/rec-5?t=40"');
    expect(markup).toContain('aria-label="Source 1: Week 5: REST APIs at 0:40"><sup aria-hidden="true">1</sup></a>');
    expect(markup).toContain('aria-label="Source 2: Wanjiku Mwangi: “Page with a cursor”"><sup aria-hidden="true">2</sup></a>.');
    expect(markup.match(/data-cite="1"/g)).toHaveLength(2);
    expect(markup).not.toContain("[1]");
  });

  it("leaves a number naming no source, and every bracket in a person's message, as text", () => {
    expect(cited("See [3] and [x].")).toBe('<div class="channel-body"><p>See [3] and [x].</p></div>');
    expect(html("Step [1] then [2]")).toBe('<div class="channel-body"><p>Step [1] then [2]</p></div>');
  });

  it("keeps masked details as the note in a cited sentence", () => {
    const markup = cited(`Call ${MASKED_CONTACT} [2].`);
    expect(markup).toContain('<span class="channel-masked" role="note">');
    expect(markup).toContain('data-cite="2"');
    expect(markup).not.toContain(MASKED_CONTACT);
  });
});
