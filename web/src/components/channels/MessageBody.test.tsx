import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MASKED_CONTACT } from "@/lib/platform/contracts";
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

  it("leaves a body without markers as it was", () => {
    expect(html("Call me after class")).toBe('<div class="channel-body"><p>Call me after class</p></div>');
  });
});
