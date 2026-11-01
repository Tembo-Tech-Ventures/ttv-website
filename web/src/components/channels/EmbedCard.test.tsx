import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ProjectEmbed } from "@/lib/platform/contracts";
import { people, projects, sessionClip } from "@/lib/platform/fixtures";
import EmbedCard, { clipHref, confirmationText, shownConfirmations } from "./EmbedCard";

const ledger = projects.chamaLedger; // revision 3, confirmed by David on revision 2
const html = (node: React.ReactElement) => renderToStaticMarkup(node).replaceAll("<!-- -->", "").replaceAll("&#x27;", "'");
const text = (node: React.ReactElement) => html(node).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

describe("a shared project", () => {
  it("says which revision was shared and which revision each confirmation covers", () => {
    const card = text(<EmbedCard embed={ledger} />);
    expect(card).toContain("Project · revision 3");
    expect(card).toContain("Chama ledger: M-Pesa receipt parser");
    expect(card).toContain("Confirmed by David on revision 2");
    expect(card).not.toContain("on this revision");
  });

  it("shows one confirmation per mentor: on this revision when there is one, else their latest", () => {
    const embed: ProjectEmbed = {
      ...ledger,
      confirmations: [
        { mentorId: people.david.id, mentorName: people.david.name, version: 1 },
        { mentorId: people.mercy.id, mentorName: people.mercy.name, version: 2 },
        { mentorId: people.david.id, mentorName: people.david.name, version: 2 },
        { mentorId: people.mercy.id, mentorName: people.mercy.name, version: 3 },
      ],
    };
    const shown = shownConfirmations(embed);
    expect(shown.map((c) => [c.mentorName, c.version])).toEqual([["Mercy Wambui", 3], ["David Kamau", 2]]);
    expect(shown.map((c) => confirmationText(embed, c))).toEqual(["Confirmed by Mercy on this revision", "Confirmed by David on revision 2"]);
    expect(html(<EmbedCard embed={embed} />)).toContain('data-confirmation="this-revision"');
  });

  it("says nothing about confirmation when there is none: missing evidence is not evidence against", () => {
    const card = text(<EmbedCard embed={{ ...ledger, confirmations: [] }} />);
    expect(card).not.toMatch(/confirm/i);
    expect(html(<EmbedCard embed={{ ...ledger, confirmations: [] }} />)).not.toContain("Mentor confirmations");
  });

  it("opens an outside link in a new tab and says so, and a TTV page in place", () => {
    const outside = html(<EmbedCard embed={ledger} />);
    expect(outside).toContain('target="_blank"');
    expect(outside).toContain('rel="noopener noreferrer"');
    expect(text(<EmbedCard embed={ledger} />)).toContain("Open Chama ledger: M-Pesa receipt parser (opens in a new tab)");
    const inside = html(<EmbedCard embed={{ ...ledger, link: "/dashboard/community/projects/x" }} />);
    expect(inside).toContain('href="/dashboard/community/projects/x"');
    expect(inside).not.toContain("target=");
    expect(text(<EmbedCard embed={{ ...ledger, link: "/dashboard/community/projects/x" }} />)).not.toContain("new tab");
  });

  it("draws no way in while the project has no link, as B-2.4 serves every project for now", () => {
    const card = html(<EmbedCard embed={{ ...ledger, link: null }} />);
    expect(card).toContain(ledger.title);
    expect(card).not.toContain("<a");
    expect(text(<EmbedCard embed={{ ...ledger, link: null }} />)).toContain("Confirmed by David on revision 2");
    // Nothing to show at the foot: no empty rule either.
    expect(html(<EmbedCard embed={{ ...ledger, link: null, confirmations: [] }} />)).not.toContain("channel-embed__foot");
  });

  it("keeps the title, the confirmation and the way in when compact (a thread's first message)", () => {
    const card = text(<EmbedCard embed={ledger} compact />);
    expect(card).toContain("Chama ledger: M-Pesa receipt parser");
    expect(card).toContain("Confirmed by David on revision 2");
    expect(card).not.toContain("Turns C2B callbacks");
    expect(card).not.toContain("TypeScript");
  });
});

describe("a shared session clip", () => {
  it("plays from its moment, with what was said there", () => {
    const card = html(<EmbedCard embed={sessionClip} />);
    expect(card).toContain(`href="${clipHref(sessionClip)}"`);
    expect(clipHref(sessionClip)).toBe(`/dashboard/cohort/sessions/${sessionClip.recordingId}?t=2052`);
    expect(text(<EmbedCard embed={sessionClip} />)).toContain("Watch from 34:12 , Session 9 · Webhooks and retries");
    expect(text(<EmbedCard embed={sessionClip} />)).toContain(sessionClip.quote);
    // The poster is a larger pointer target for the same link, kept out of the tab order and the accessibility tree.
    expect(card).toMatch(/<a href="[^"]+" tabindex="-1" aria-hidden="true" class="channel-clip__poster"/);
    expect(text(<EmbedCard embed={sessionClip} compact />)).not.toContain(sessionClip.quote);
  });
});

describe("work that is no longer available", () => {
  it("says so, the same for every reason, and nothing about what it was", () => {
    const project = text(<EmbedCard embed={{ type: "unavailable", was: "project" }} />);
    expect(project).toBe("Project This project is no longer available It may have been removed, or it isn't shared with you.");
    const clip = text(<EmbedCard embed={{ type: "unavailable", was: "sessionClip" }} />);
    expect(clip).toBe("Session clip This session clip is no longer available It may have been removed, or it isn't shared with you.");
    const markup = html(<EmbedCard embed={{ type: "unavailable", was: "project" }} />);
    expect(markup).not.toContain("<a ");
    expect(markup).toContain('data-embed="unavailable"');
  });
});
