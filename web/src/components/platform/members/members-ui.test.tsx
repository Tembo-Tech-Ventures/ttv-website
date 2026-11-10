import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import MemberCard from "./MemberCard";
import MemberFilters from "./MemberFilters";
import MemberPager from "./MemberPager";
import MemberProfile from "./MemberProfile";
import WorkItem from "./WorkItem";
import YouCard, { youStanding } from "./YouCard";
import { memberCards, memberProfiles } from "./fixtures";
import {
  cardSkills, confirmedSummary, directoryHref, isFiltered, memberHref, openToLabels, pageSummary, parseMemberUrl, readFilters, resultsHeading, workSummary,
} from "./member-display";

const NO_FILTERS = { q: "", skills: [], openTo: null };
const parse = (query: string) => parseMemberUrl(new URLSearchParams(query));
/** Visible words only, tags gone and spaces collapsed. */
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replaceAll("&#x27;", "'").replaceAll("&amp;", "&").replace(/\s+/g, " ").trim();

describe("the directory's address", () => {
  it("reads search, skills and open-to, dropping anything out of shape rather than refusing it", () => {
    expect(parse("")).toEqual({ filters: NO_FILTERS, cursor: null, seen: 0 });
    expect(parse("q=%20%20chama%20%20savings%20&skills=TypeScript,%20react,typescript,,&open=roles")).toEqual({
      filters: { q: "chama savings", skills: ["TypeScript", "react"], openTo: "roles" }, cursor: null, seen: 0,
    });
    // Repeated `skills` parameters join the comma-separated ones; at most five, each at most 40 characters.
    expect(parse("skills=a,b&skills=c,d,e,f,g").filters.skills).toEqual(["a", "b", "c", "d", "e"]);
    expect(parse(`skills=${"x".repeat(60)}`).filters.skills).toEqual(["x".repeat(40)]);
    expect(parse(`q=${"q".repeat(150)}`).filters.q).toHaveLength(100);
    expect(parse("open=everyone").filters.openTo).toBeNull();
    expect(parse(`cursor=${"c".repeat(513)}&seen=24`)).toMatchObject({ cursor: null, seen: 0 });
  });

  it("counts what came before only on a later page, and only as a whole positive number", () => {
    expect(parse("cursor=abc&seen=24")).toMatchObject({ cursor: "abc", seen: 24 });
    expect(parse("seen=24")).toMatchObject({ cursor: null, seen: 0 });
    for (const seen of ["-3", "2.5", "lots", "1e400"]) expect(parse(`cursor=abc&seen=${seen}`).seen, `${seen}`).toBe(0);
  });

  it("asks the read only for what is set, and links back to the same view", () => {
    expect(readFilters(NO_FILTERS, null)).toEqual({});
    const filters = { q: "chama", skills: ["TypeScript", "React"], openTo: "freelance" as const };
    expect(readFilters(filters, "next")).toEqual({ q: "chama", skills: ["TypeScript", "React"], openTo: "freelance", cursor: "next" });
    expect(directoryHref(NO_FILTERS)).toBe("/dashboard/community/members");
    const href = directoryHref(filters, { cursor: "next", seen: 24 });
    expect(href).toBe("/dashboard/community/members?q=chama&skills=TypeScript%2C+React&open=freelance&cursor=next&seen=24");
    // Following the link reads back exactly the same view.
    expect(parseMemberUrl(new URL(href, "https://ttv.invalid").searchParams)).toEqual({ filters, cursor: "next", seen: 24 });
    expect(isFiltered(NO_FILTERS)).toBe(false);
    expect(isFiltered({ ...NO_FILTERS, openTo: "roles" })).toBe(true);
    expect(memberHref("achieng-otieno")).toBe("/dashboard/community/members/achieng-otieno");
  });

  it("says how many, where the page is, and what each person has posted, in words", () => {
    expect([resultsHeading(1, false), resultsHeading(57, false), resultsHeading(1, true), resultsHeading(0, true)])
      .toEqual(["1 member", "57 members", "1 member matches", "0 members match"]);
    expect([pageSummary(0, 24, 57), pageSummary(48, 9, 57), pageSummary(56, 1, 57), pageSummary(0, 0, 0)])
      .toEqual(["1–24 of 57", "49–57 of 57", "57 of 57", ""]);
    expect([workSummary(0), workSummary(1), workSummary(3)]).toEqual(["No work posted yet", "1 piece of work", "3 pieces of work"]);
    expect([confirmedSummary(0), confirmedSummary(2)]).toEqual([null, "2 confirmed by a mentor"]);
    expect(openToLabels(memberCards.achieng)).toEqual(["Open to freelance", "Open to roles"]);
    expect(openToLabels(memberCards.brian)).toEqual([]);
    expect(cardSkills(memberCards.achieng.skills)).toEqual({ shown: ["TypeScript", "React", "SQLite", "Cloudflare Workers"], more: 2 });
  });
});

describe("a member's card", () => {
  it("is one link named for the person, with what they work with and have posted, and no ranking", () => {
    const html = renderToStaticMarkup(<MemberCard member={memberCards.achieng} />);
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toMatch(/<a href="\/dashboard\/community\/members\/achieng-otieno" class="member-card__link">Achieng Otieno<\/a>/);
    const item = /^<li [^>]*>/.exec(html)![0];
    for (const attribute of ['aria-labelledby="member-achieng-otieno"', 'data-member-card="achieng-otieno"', "data-card"]) expect(item).toContain(attribute);
    const words = text(html);
    for (const fact of ["Full-stack developer", "TypeScript", "+2 more", "2 pieces of work", "1 confirmed by a mentor", "Completed Cohort 04",
      "Open to freelance · Open to roles", "On the public website"]) {
      expect(words).toContain(fact);
    }
    expect(words).not.toMatch(/rank|score|top|best|views/i);
    // The avatar is decoration: the name beside it says who this is.
    expect(html).not.toMatch(/role="img"/);
  });

  it("leaves out what a person has not said, and says when nothing is posted", () => {
    const words = text(renderToStaticMarkup(<MemberCard member={memberCards.brian} />));
    expect(words).toBe("BK Brian Kiprono No work posted yet");
  });
});

describe("the search", () => {
  it("is a GET form that lands on the results, keeps the view, and offers a way back only when filtered", () => {
    const empty = renderToStaticMarkup(<MemberFilters filters={NO_FILTERS} />);
    expect(empty).toMatch(/^<search aria-label="Find members"><form method="get" action="\/dashboard\/community\/members#member-results"/);
    expect(empty).not.toContain('name="cursor"');
    expect(empty).not.toContain("Clear filters");
    const filtered = renderToStaticMarkup(<MemberFilters filters={{ q: "chama", skills: ["TypeScript", "React"], openTo: "roles" }} />);
    expect(filtered).toMatch(/<input[^>]*name="q"[^>]*value="chama"|<input[^>]*value="chama"[^>]*name="q"/);
    expect(filtered).toMatch(/value="TypeScript, React"/);
    expect(filtered).toMatch(/<option value="roles" selected="">Open to roles<\/option>/);
    expect(filtered).toContain(">Clear filters</a>");
    for (const id of ["member-search", "member-skills", "member-open"]) expect(filtered).toMatch(new RegExp(`<label[^>]*for="${id}"`));
  });
});

describe("the pager", () => {
  it("goes to the next page and back to the first, never to a guessed previous one", () => {
    expect(renderToStaticMarkup(<MemberPager firstHref={null} nextHref={null} summary="1–3 of 3" />)).toBe("");
    const html = renderToStaticMarkup(<MemberPager firstHref="/first" nextHref="/next" summary="25–48 of 57" />);
    expect(html).toMatch(/<nav aria-label="More members"/);
    expect(html).toMatch(/<a [^>]*rel="first"[^>]*>/);
    expect(/<a [^>]*rel="first"[^>]*>/.exec(html)![0]).toContain('href="/first"');
    expect(/<a [^>]*rel="next"[^>]*>/.exec(html)![0]).toContain('href="/next"');
    expect(text(html)).toBe("First page Next 25–48 of 57");
    expect(html).not.toContain("Previous");
  });
});

describe("the caller's own card", () => {
  const plain = { isAdmin: false, isMentor: false };

  it("says where the caller stands, from their card and roles, staff before mentor", () => {
    expect(youStanding(memberCards.faith, { isAdmin: true, isMentor: true })).toEqual({ kind: "listed", card: memberCards.faith });
    expect(youStanding(null, plain)).toEqual({ kind: "unlisted" });
    expect(youStanding(null, { isAdmin: false, isMentor: true })).toEqual({ kind: "mentor" });
    expect(youStanding(null, { isAdmin: true, isMentor: true })).toEqual({ kind: "staff" });
  });

  it("links a listed caller to their page as others see it, with no peach action", () => {
    const listed = renderToStaticMarkup(<YouCard standing={youStanding(memberCards.faith, plain)} />);
    expect(text(listed)).toContain("You're in the directory");
    expect(listed).toMatch(/href="\/dashboard\/community\/members\/faith-njoki"[^>]*>See your page/);
    expect(listed).not.toContain('data-variant="primary"');
  });

  it("never asks someone who may already have a profile to make one", () => {
    const words = text(renderToStaticMarkup(<YouCard standing={{ kind: "unlisted" }} />));
    expect(words).toContain("Your profile isn't in the directory yet");
    expect(words).toContain("Open your profile");
    expect(words).not.toMatch(/make your profile|create/i);
  });

  it("tells mentors and staff they are not listed, without a way to be", () => {
    const mentor = renderToStaticMarkup(<YouCard standing={{ kind: "mentor" }} />);
    expect(text(mentor)).toContain("Mentors aren't listed here");
    expect(mentor).toMatch(/href="\/dashboard\/mentoring"[^>]*>Open Mentoring/);
    const staff = renderToStaticMarkup(<YouCard standing={{ kind: "staff" }} />);
    expect(text(staff)).toContain("Staff aren't listed here");
    expect(staff).not.toContain("<a ");
  });
});

describe("a member's page", () => {
  it("shows the person, their work and each confirmation at its revision, and the public page only when they are on it", () => {
    const html = renderToStaticMarkup(<MemberProfile member={memberProfiles.achieng} />);
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toMatch(/<h1 id="member-name"[^>]*>Achieng Otieno<\/h1>/);
    const words = text(html);
    for (const fact of ["Completed Cohort 04", "About", "Looking for", "Skills", "Work", "2 pieces of work · 1 confirmed by a mentor",
      "Confirmed by David Kamau", "An earlier version was confirmed by Grace Wanjiru", "The work has changed since (now revision 2)",
      "How they checked: Watched a demo", "No mentor has confirmed this yet.", "achieng-otieno/mpesa-callbacks", "12 stars", "payments"]) {
      expect(words).toContain(fact);
    }
    expect(html).toMatch(/href="\/talent\/achieng-otieno"[^>]*data-member-public/);
    expect(words).toContain("Achieng's page on the public website");
    // Links to work open elsewhere, say so, and never carry an opener.
    expect(html).toMatch(/href="https:\/\/example.com\/chama-tracker" target="_blank" rel="noopener noreferrer"/);
    expect(words).toContain("(opens in a new tab)");
    // Someone else's page has no editor and no peach action.
    expect(html).not.toContain("Edit your profile");
    expect(html).not.toContain('data-variant="primary"');
  });

  it("never links a work link that is not http(s)", () => {
    // A scheme that runs script, built from parts so no linter mistakes the test for one.
    const work = { ...memberProfiles.achieng.work[0], link: ["javascript", "alert(1)"].join(":") };
    const html = renderToStaticMarkup(<WorkItem work={work} />);
    expect(html).not.toContain("alert(1)");
    expect(html).not.toContain("<a ");
  });

  it("is the caller's own, with the way to their editor and what everyone sees, and no public link off the site", () => {
    const html = renderToStaticMarkup(<MemberProfile member={memberProfiles.brian} />);
    const words = text(html);
    expect(words).toContain("This is your page as others see it");
    expect(words).toContain("Everyone signed in to TTV can see your profile and everything you post.");
    expect(words).not.toContain("public website");
    expect(words).toContain("You haven't posted any work yet");
    expect(html.match(/data-variant="primary"/g)).toHaveLength(1);
    expect(html).not.toContain("data-member-public");
  });
});
