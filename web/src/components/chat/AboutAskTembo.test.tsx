import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PRIVATE_ASK_SEES, privateAskScope } from "@/lib/tembo/private-ask";
import AboutAskTembo from "./AboutAskTembo";
import ChatApp from "./ChatApp";

const text = (markup: string) => markup.replaceAll("<!-- -->", "").replace(/<[^>]+>/g, " ").replaceAll("&#x27;", "'").replaceAll("&quot;", '"')
  .replace(/\s+/g, " ").trim();

describe("what the private Ask Tembo page says about itself (QA3-03, QA3-04)", () => {
  it("says who can see a conversation, how long it is kept, where requests go, and that it doesn't count in channels", () => {
    const about = text(renderToStaticMarkup(<AboutAskTembo scope="COHORTS" />));
    expect(about).toContain("Private · Other members can't see this conversation");
    expect(about).toContain("Nothing here is posted in a channel, and other members can't see it.");
    expect(about).toContain('In a channel, "Ask Tembo here" posts your question and the answer for everyone who can read that channel.');
    // Kept with the account, no deleting yet: a delete feature is the owner's call, not this page's.
    expect(about).toContain("Conversations are saved to your account, with no time limit");
    expect(about).toContain("You can't delete a conversation yet.");
    // /api/chat goes through the gateway without opting out of its logs, unlike channel Tembo.
    expect(about).toContain("TTV's AI gateway on Cloudflare, which keeps request logs that TTV's technical team can read.");
    expect(about).toContain("Questions here don't count toward your daily questions to Tembo in channels.");
  });

  it.each([
    [{ cohortIds: ["cohort-a"], isAdmin: false }, "your cohorts' recorded sessions, your own application and TTV's programs"],
    [{ cohortIds: [], isAdmin: true }, "every cohort's recorded sessions (you're TTV staff)"],
    [{ cohortIds: [], isAdmin: false }, "Session recordings open once you have a place in a cohort"],
  ])("says what Tembo sees with the scope /api/chat gives it (%o)", (caps, words) => {
    const scope = privateAskScope(caps);
    const about = text(renderToStaticMarkup(<AboutAskTembo scope={scope} />));
    expect(about).toContain(`Tembo sees ${PRIVATE_ASK_SEES[scope]}.`);
    expect(about).toContain(words);
    expect(about).toContain("Never channels, other people's messages or their private work.");
  });

  it("opens with the kit's focus ring and a 44px target on a touch screen", () => {
    const summary = /<summary([^>]*)>/.exec(renderToStaticMarkup(<AboutAskTembo scope="COHORTS" />))?.[1] ?? "";
    expect(summary).toContain("focus-visible:outline-peach-ink");
    expect(summary).toContain("pointer-coarse:min-h-11");
    expect(summary).not.toContain("outline-primary");
  });

  it("is on the page in both frames, above the box, and labels every answer as AI", () => {
    for (const variant of ["immersive", "space"] as const) {
      const markup = renderToStaticMarkup(
        <ChatApp mockMode variant={variant} scope="COHORTS" initialMessages={[{ role: "user", content: "Hi" }, { role: "assistant", content: "Hello [1]" }]} />,
      );
      expect(markup.indexOf("data-about-ask")).toBeLessThan(markup.indexOf('id="chat-composer"'));
      expect(text(markup)).toContain(PRIVATE_ASK_SEES.COHORTS);
      // Tembo's own mark and the kit's AI badge, as in channels.
      expect(markup).toMatch(/data-chat-author="true"><span[^>]*data-tembo-mark[^>]*>.*?<\/span><\/span>Tembo<span[^>]*data-role-badge="AI"[^>]*>AI<\/span><\/p>/);
    }
  });
});
