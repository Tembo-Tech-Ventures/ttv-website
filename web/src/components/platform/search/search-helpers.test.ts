// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { meByPersona } from "@/lib/platform/fixtures";
import { ApiError } from "@/lib/platform/client/apiError";
import { askTemboHref, takeAskTemboDraft } from "./ask-handoff";
import { clearRecentSearches, onShellSignOut, recentSearchKey, RECENT_PREFIX } from "./recent-searches";
import { highlight, matchingPart, mentions, opening, scopesFor, searchCoverage, searchProblem, timestamp } from "./search-display";

afterEach(() => {
  localStorage.clear();
  history.replaceState(null, "", "/");
});

describe("scopesFor", () => {
  it("offers a cohort search only to someone in a cohort", () => {
    expect(scopesFor(meByPersona.wanjiku).map((option) => option.scope)).toEqual(["all", "cohort", "community", "people", "projects"]);
    expect(scopesFor(meByPersona.lucy).map((option) => option.scope)).toEqual(["all", "community", "people", "projects"]);
    // An admin sees the Cohort space without belonging to a cohort.
    expect(scopesFor(meByPersona.amina).map((option) => option.scope)).not.toContain("cohort");
  });

  it("calls the widest scope All, not Everywhere: it covers only the scopes beside it", () => {
    for (const me of Object.values(meByPersona)) expect(scopesFor(me)[0]).toEqual({ scope: "all", label: "All" });
  });

  it("never offers message search before channels exist", () => {
    for (const me of Object.values(meByPersona)) expect(scopesFor(me).map((option) => option.scope)).not.toContain("messages");
  });
});

describe("searchCoverage (QA1-11)", () => {
  it("names only what this person's search reaches", () => {
    expect(searchCoverage(meByPersona.wanjiku)).toEqual({
      label: "Search people, projects and your sessions",
      hint: "Finds people with public profiles, your shared projects, and moments from your own cohort's sessions.",
    });
    // No cohort, so no sessions; staff and institutions see projects shared with institutions.
    expect(searchCoverage(meByPersona.lucy).label).toBe("Search people and projects");
    expect(searchCoverage(meByPersona.lucy).hint).not.toMatch(/session/);
    expect(searchCoverage(meByPersona.amina)).toEqual({
      label: "Search people and projects",
      hint: "Finds people with public profiles and projects shared with institutions.",
    });
  });

  it("never promises everything", () => {
    for (const me of Object.values(meByPersona)) {
      const { label, hint } = searchCoverage(me);
      expect(`${label} ${hint}`).not.toMatch(/everything|everywhere/i);
    }
  });
});

describe("why a result matched", () => {
  const bio = `${"Builds offline-first tools for clinics and savings groups. ".repeat(6)}Lately: SQL joins and indexes for a ledger.`;

  it("finds the whole query first, then any of its words, case-insensitively", () => {
    expect(mentions("Week 4: SQL joins and indexes", "sql JOINS")).toBe(true);
    expect(mentions("Idempotent webhook handling", "retry webhook")).toBe(true);
    expect(mentions("Mentor · Backend engineer", "retry webhook")).toBe(false);
    expect(mentions("anything", " ")).toBe(false);
  });

  it("brings a match deep in a long text on screen, cut between words", () => {
    const shown = matchingPart(bio, "sql joins")!;
    expect(shown).toMatch(/^…/);
    expect(shown).toContain("SQL joins and indexes");
    expect(shown.length).toBeLessThanOrEqual(162);
    expect(shown.replace(/^…|…$/g, "").split(" ").every((word) => bio.includes(word))).toBe(true);
  });

  it("keeps a short text whole, and says nothing when the query is not in it", () => {
    expect(matchingPart("SQL for ledgers", "sql")).toBe("SQL for ledgers");
    expect(matchingPart(bio, "kotlin")).toBeNull();
  });

  it("opens a long text at its start for a result whose title matched", () => {
    const start = opening(bio, 60);
    expect(start.startsWith("Builds offline-first")).toBe(true);
    expect(start.endsWith("…")).toBe(true);
    expect(opening("Short.")).toBe("Short.");
  });
});

describe("highlight", () => {
  it("marks each word of the query, case-insensitively, without changing the text", () => {
    const parts = highlight("Idempotent Webhook handling", "retry webhook");
    expect(parts.map((part) => part.text).join("")).toBe("Idempotent Webhook handling");
    expect(parts.filter((part) => part.match).map((part) => part.text)).toEqual(["Webhook"]);
  });

  it("treats the query as text, not a pattern", () => {
    expect(highlight("a (b) c", "(b)").filter((part) => part.match).map((part) => part.text)).toEqual(["(b)"]);
    expect(highlight("anything", "   ")).toEqual([{ text: "anything", match: false }]);
  });
});

describe("timestamp", () => {
  it("reads like a player's clock", () => {
    expect(timestamp(2052)).toBe("34:12");
    expect(timestamp(3725.9)).toBe("1:02:05");
    expect(timestamp(-4)).toBe("0:00");
  });
});

describe("searchProblem", () => {
  it("says what happened and offers only what can help", () => {
    expect(searchProblem(null)).toBeNull();
    expect(searchProblem(new ApiError("forbidden", 401, "x"))).toMatchObject({ signIn: true, retry: false });
    expect(searchProblem(new ApiError("flag_off", 404, "x"))).toMatchObject({ signIn: true, retry: true });
    expect(searchProblem(new ApiError("forbidden", 403, "x"))).toMatchObject({ signIn: false, retry: false });
    expect(searchProblem(new ApiError("validation_error", 0, "x"))?.message).toContain("500 characters");
    expect(searchProblem(new ApiError("rate_limited", 429, "x"))).toMatchObject({ retry: true });
    expect(searchProblem(new ApiError("network_error", 0, "x"))).toMatchObject({ retry: true, signIn: false });
  });
});

describe("recent searches", () => {
  it("are kept per person, and other people's lists are removed", () => {
    localStorage.setItem(recentSearchKey("wanjiku"), '["webhooks"]');
    localStorage.setItem(recentSearchKey("kevin"), '["kevin private"]');
    localStorage.setItem("unrelated", "keep");
    clearRecentSearches(recentSearchKey("wanjiku"));
    expect(localStorage.getItem(recentSearchKey("wanjiku"))).toBe('["webhooks"]');
    expect(localStorage.getItem(recentSearchKey("kevin"))).toBeNull();
    expect(localStorage.getItem("unrelated")).toBe("keep");
  });

  it("are all removed on sign-out", () => {
    localStorage.setItem(recentSearchKey("wanjiku"), '["webhooks"]');
    clearRecentSearches();
    expect(Object.keys(localStorage).some((key) => key.startsWith(RECENT_PREFIX))).toBe(false);
  });

  it("survive blocked storage", () => {
    const broken = { length: 1, key: () => { throw new Error("blocked"); }, removeItem: vi.fn() };
    expect(() => clearRecentSearches(undefined, broken)).not.toThrow();
  });

  it("hear the shell's sign-out link and form, and nothing else", () => {
    const signedOut = vi.fn();
    const stop = onShellSignOut(signedOut);
    document.body.innerHTML = `
      <a href="#x" data-shell-sign-out><span id="inner">Sign out</span></a>
      <a href="#y" id="other">Account</a>
      <form data-shell-sign-out id="qa"></form>`;
    document.getElementById("other")!.click();
    expect(signedOut).not.toHaveBeenCalled();
    document.getElementById("inner")!.click();
    document.getElementById("qa")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(signedOut).toHaveBeenCalledTimes(2);
    stop();
    document.getElementById("inner")!.click();
    expect(signedOut).toHaveBeenCalledTimes(2);
  });
});

describe("Ask Tembo hand-off", () => {
  it("carries the words in the fragment, which never reaches the server", () => {
    const href = askTemboHref("retry webhook & 50%");
    expect(href).toBe("/dashboard/cohort/ask#ask-tembo=retry%20webhook%20%26%2050%25");
    expect(new URL(href, "https://example.test").search).toBe("");
  });

  it("is taken once: read, then removed from the address", () => {
    history.replaceState(null, "", "/dashboard/cohort/ask?x=1#ask-tembo=retry%20webhook");
    expect(takeAskTemboDraft()).toBe("retry webhook");
    expect(location.hash).toBe("");
    expect(location.search).toBe("?x=1");
    expect(takeAskTemboDraft()).toBeNull();
  });

  it("ignores other fragments and anything that is not a valid question", () => {
    history.replaceState(null, "", "/dashboard/ask#section");
    expect(takeAskTemboDraft()).toBeNull();
    expect(location.hash).toBe("#section");
    history.replaceState(null, "", "/dashboard/ask#ask-tembo=%E0%A4%A");
    expect(takeAskTemboDraft()).toBeNull();
    history.replaceState(null, "", `/dashboard/ask#ask-tembo=${"a".repeat(501)}`);
    expect(takeAskTemboDraft()).toBeNull();
    history.replaceState(null, "", "/dashboard/ask#ask-tembo=%20%20");
    expect(takeAskTemboDraft()).toBeNull();
  });
});
