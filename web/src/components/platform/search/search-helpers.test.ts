// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/platform/client/apiError";
import { askTemboHref, takeAskTemboDraft } from "./ask-handoff";
import { clearRecentSearches, onShellSignOut, recentSearchKey, RECENT_PREFIX } from "./recent-searches";
import { meByPersona, searchResults } from "@/lib/platform/fixtures";
import type { SearchItem } from "@/lib/platform/client/search";
import { highlight, matchReason, scopesFor, searchCoverage, searchProblem, timestamp } from "./search-display";

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

  it("never offers message search before channels exist", () => {
    for (const me of Object.values(meByPersona)) expect(scopesFor(me).map((option) => option.scope)).not.toContain("messages");
  });
});

describe("searchCoverage", () => {
  it("names only what this person's search reaches: sessions for cohort members only", () => {
    expect(searchCoverage(meByPersona.wanjiku)).toBe("people, projects and your cohort's sessions");
    expect(searchCoverage(meByPersona.lucy)).toBe("people and projects");
    expect(searchCoverage(meByPersona.joseph)).toBe("people and projects");
    // Staff see the Cohort space but search no cohort they do not belong to.
    expect(searchCoverage(meByPersona.amina)).toBe("people and projects");
    for (const me of Object.values(meByPersona)) expect(searchCoverage(me)).not.toMatch(/everything/i);
  });
});

describe("matchReason", () => {
  const person: SearchItem = { group: "people", item: searchResults.people[0]! };
  const project: SearchItem = { group: "projects", item: searchResults.projects[0]! };
  const moment: SearchItem = { group: "sessionMoments", item: searchResults.sessionMoments[0]! };

  it("says nothing when the highlighted words already show why", () => {
    expect(matchReason(person, "backend")).toBeNull();
    expect(matchReason(person, searchResults.people[0]!.person.name.split(" ")[0]!)).toBeNull();
    expect(matchReason(project, "webhook")).toBeNull();
  });

  it("explains a match the result does not show", () => {
    expect(matchReason(person, "SQL")).toBe("Matches “SQL” elsewhere in their public profile");
    expect(matchReason(project, "  bank reconciliation ")).toBe("Matches “bank reconciliation” in the project's full description");
  });

  it("leaves moments to their quote, which is cut around the match", () => {
    expect(matchReason(moment, "zzz")).toBeNull();
    expect(matchReason(person, "   ")).toBeNull();
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
