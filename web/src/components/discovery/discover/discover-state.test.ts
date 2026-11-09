import { describe, expect, it, vi } from "vitest";
import { discoverAccess, readDiscoverGet, readDiscoverPost, runDiscover, validateSearch, NO_SEARCH, type Carried } from "./discover-state";

const ORIGIN = "https://ttv.invalid";
const PAGE = `${ORIGIN}/dashboard/discover`;
const post = (form: Record<string, string>, origin: string | null = ORIGIN) =>
  new Request(PAGE, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...(origin ? { origin } : {}) },
    body: new URLSearchParams(form).toString(),
  });

const PROFILE = { userId: "achieng", name: "Achieng Otieno", image: null, headline: "Frontend builder", bio: "Builds tools.", skills: ["React"], opportunityGoals: "A first role", version: 2, updatedAt: 1 };
const ENTRY = { id: "ledger", userId: "achieng", title: "Chama savings ledger", description: "Built the ledger.", evidenceUrl: "https://github.com/example/ledger", occurredAt: "2026-10-24", visibility: "institution", version: 1, confirmations: [] };
const SCOUT: Carried = { context: "A confidential fintech role", skills: "React, SQL", query: "", lookup: false };

/** A stand-in for the community API, answering by method and path; it records what was asked. */
function api(answers: Record<string, () => Response>) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), ORIGIN);
    const method = init?.method ?? "GET";
    calls.push({ method, path: `${url.pathname.replace("/api/community/", "")}${url.search}`, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const key = `${method} ${url.pathname.replace("/api/community/", "")}`;
    return (answers[key] ?? (() => Response.json({ error: "Route not found." }, { status: 404 })))();
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

describe("what a GET asks for", () => {
  it.each([
    ["", { kind: "criteria", carried: NO_SEARCH }],
    ["?lookup=1", { kind: "criteria", carried: { ...NO_SEARCH, lookup: true } }],
    ["?lookup=1&scout=results&query=Achieng", { kind: "search", carried: { ...NO_SEARCH, lookup: true, query: "Achieng" } }],
    ["?profile=achieng", { kind: "profile", id: "achieng", carried: NO_SEARCH }],
    // An older scouting link opens its form: the opportunity never travels in an address.
    ["?scout=results&skills=React&context=secret", { kind: "criteria", carried: { ...NO_SEARCH, skills: "React" } }],
  ])("%s", (search, request) => {
    expect(readDiscoverGet(new URL(`${PAGE}${search}`))).toEqual(request);
  });
});

describe("what a POST asks for", () => {
  it("scouts with the opportunity from the body", async () => {
    expect(await readDiscoverPost(post({ form: "scout", context: "A role", skills: "React", query: "" })))
      .toEqual({ ok: true, request: { kind: "search", carried: { context: "A role", skills: "React", query: "", lookup: false } } });
  });

  it("asks a suggested question as it is, whatever the field holds", async () => {
    const result = await readDiscoverPost(post({ form: "ask", profile: "achieng", question: "typed", suggestion: "What should I ask them next?" }));
    expect(result).toMatchObject({ ok: true, request: { kind: "profile", id: "achieng", question: "What should I ask them next?" } });
  });

  it("adds and removes assessment criteria without assessing", async () => {
    const added = await readDiscoverPost(post({ form: "assess", profile: "achieng", rows: "1", "label-0": "Accessibility", "terms-0": "aria", intent: "add-criterion" }));
    expect(added).toMatchObject({ ok: true, request: { rows: [{ label: "Accessibility", terms: "aria" }, { label: "", terms: "" }], assess: false } });
    const removed = await readDiscoverPost(post({ form: "assess", profile: "achieng", rows: "2", "label-0": "A", "terms-0": "a1", "label-1": "B", "terms-1": "b1", intent: "remove-0" }));
    expect(removed).toMatchObject({ ok: true, request: { rows: [{ label: "B", terms: "b1" }], assess: false } });
    const assessed = await readDiscoverPost(post({ form: "assess", profile: "achieng", rows: "1", "label-0": "A", "terms-0": "a1", intent: "assess" }));
    expect(assessed).toMatchObject({ ok: true, request: { assess: true } });
  });

  it("refuses another origin, none, or a form it can't read", async () => {
    expect(await readDiscoverPost(post({ form: "scout" }, "https://elsewhere.example"))).toEqual({ ok: false, status: 403 });
    expect(await readDiscoverPost(post({ form: "scout" }, null))).toEqual({ ok: false, status: 403 });
    expect(await readDiscoverPost(post({ form: "open" }))).toEqual({ ok: false, status: 400 });
    expect(await readDiscoverPost(post({ form: "nonsense", profile: "x" }))).toEqual({ ok: false, status: 400 });
    expect(await readDiscoverPost(post({ form: "scout", context: "x".repeat(40_000) }))).toEqual({ ok: false, status: 413 });
  });
});

describe("a search's own checks", () => {
  it("asks for something to search by, and at most 10 skills", () => {
    expect(validateSearch(NO_SEARCH)).toEqual({ context: "Describe the opportunity or the skills you need." });
    expect(validateSearch({ ...NO_SEARCH, skills: Array.from({ length: 11 }, (_, i) => `s${i}`).join(",") })).toEqual({ skills: "Explore up to 10 skills at a time." });
    expect(validateSearch({ ...NO_SEARCH, lookup: true })).toEqual({ query: "Enter the name of the person you're looking for." });
    expect(validateSearch(SCOUT)).toEqual({});
  });
});

describe("running Discover through the API", () => {
  it("scouts through Tembo's discovery, with the opportunity in the body", async () => {
    const { fetcher, calls } = api({ "POST profiles/discover": () => Response.json({ profiles: [{ profile: PROFILE, matches: [] }], evaluated: 1, searched: 3 }) });
    const outcome = await runDiscover({ kind: "search", carried: SCOUT }, fetcher);
    expect(outcome.status).toBe(200);
    expect(outcome.view).toMatchObject({ kind: "results", profiles: [{ id: "achieng", discovery: { evaluated: 1, searched: 3 } }] });
    expect(calls).toEqual([{ method: "POST", path: "profiles/discover", body: { context: SCOUT.context, skills: SCOUT.skills, query: "" } }]);
  });

  it("looks a person up by name only", async () => {
    const { fetcher, calls } = api({ "GET profiles": () => Response.json({ profiles: [PROFILE] }) });
    const outcome = await runDiscover({ kind: "search", carried: { ...NO_SEARCH, lookup: true, query: " Achieng " } }, fetcher);
    expect(outcome.view).toMatchObject({ kind: "results", profiles: [{ name: "Achieng Otieno" }] });
    expect(calls[0]?.path).toBe("profiles?query=Achieng&skills=&limit=50");
  });

  it("answers its own checks with a 400 and calls nothing", async () => {
    const { fetcher, calls } = api({});
    expect(await runDiscover({ kind: "search", carried: NO_SEARCH }, fetcher)).toMatchObject({ status: 400, view: { kind: "criteria", errors: { context: expect.any(String) } } });
    expect(calls).toEqual([]);
  });

  it("keeps the criteria and answers 503 when the search fails, or the API's refusal as it was", async () => {
    const failed = await runDiscover({ kind: "search", carried: SCOUT }, api({ "POST profiles/discover": () => Response.json({ error: "x" }, { status: 500 }) }).fetcher);
    expect(failed).toMatchObject({ status: 503, view: { kind: "criteria", carried: SCOUT, problem: { title: "Search could not be completed" } } });
    const refused = await runDiscover({ kind: "search", carried: SCOUT }, api({ "POST profiles/discover": () => Response.json({ error: "x" }, { status: 403 }) }).fetcher);
    expect(refused.status).toBe(403);
  });

  it("opens a person with their work", async () => {
    const { fetcher } = api({ "GET profiles/achieng": () => Response.json({ profile: PROFILE, entries: [ENTRY] }) });
    const outcome = await runDiscover({ kind: "profile", id: "achieng", carried: SCOUT }, fetcher);
    expect(outcome).toMatchObject({ status: 200, view: { kind: "profile", carried: SCOUT, profile: { id: "achieng", claims: [{ title: "Chama savings ledger" }] }, answer: null } });
  });

  it("says a person it can't open is unavailable", async () => {
    const outcome = await runDiscover({ kind: "profile", id: "gone", carried: NO_SEARCH }, api({}).fetcher);
    expect(outcome).toMatchObject({ status: 404, view: { kind: "unavailable", problem: { detail: "This contribution or profile is no longer available." } } });
  });

  it("asks Tembo about the work with the opportunity as context", async () => {
    const { fetcher, calls } = api({
      "GET profiles/achieng": () => Response.json({ profile: PROFILE, entries: [ENTRY] }),
      "POST chat": () => Response.json({ answer: "They built the ledger.", aiGenerated: true, grounded: true, limited: false, citations: [{ kind: "journey", id: "ledger", userId: "achieng", version: 1 }] }),
    });
    const outcome = await runDiscover({ kind: "profile", id: "achieng", carried: SCOUT, question: "What did they build?" }, fetcher);
    expect(outcome.view).toMatchObject({ kind: "profile", answer: { text: "They built the ledger.", references: ["Chama savings ledger · Revision 1"] } });
    expect(calls[1]).toMatchObject({ method: "POST", path: "chat", body: { message: "What did they build?", profileId: "achieng", context: "A confidential fintech role\nSkills of interest: React, SQL" } });
  });

  it("asks for a question before asking Tembo", async () => {
    const { fetcher, calls } = api({ "GET profiles/achieng": () => Response.json({ profile: PROFILE, entries: [] }) });
    expect(await runDiscover({ kind: "profile", id: "achieng", carried: NO_SEARCH, question: "  " }, fetcher)).toMatchObject({ status: 400, view: { askProblem: { title: "Write a question first" } } });
    expect(calls).toHaveLength(1);
  });

  it("keeps the question and answers 503 when Tembo fails", async () => {
    const { fetcher } = api({
      "GET profiles/achieng": () => Response.json({ profile: PROFILE, entries: [] }),
      "POST chat": () => Response.json({ error: "x" }, { status: 500 }),
    });
    expect(await runDiscover({ kind: "profile", id: "achieng", carried: NO_SEARCH, question: "Anything?" }, fetcher))
      .toMatchObject({ status: 503, view: { question: "Anything?", askProblem: { title: "We couldn't answer that question" } } });
  });

  it("refuses criteria that can't be a rubric with a 400, keeping them", async () => {
    const { fetcher, calls } = api({ "GET profiles/achieng": () => Response.json({ profile: PROFILE, entries: [] }) });
    const rows = [{ label: "Accessibility", terms: "a" }];
    expect(await runDiscover({ kind: "profile", id: "achieng", carried: NO_SEARCH, rows, assess: true }, fetcher))
      .toMatchObject({ status: 400, view: { rows, rowsError: expect.stringContaining("2–80 characters") } });
    expect(calls).toHaveLength(1);
  });

  it("assesses with a rubric built from the rows", async () => {
    const { fetcher, calls } = api({
      "GET profiles/achieng": () => Response.json({ profile: PROFILE, entries: [ENTRY] }),
      "POST profiles/achieng/assessment": () => Response.json({ error: "x" }, { status: 503 }),
    });
    const outcome = await runDiscover({ kind: "profile", id: "achieng", carried: NO_SEARCH, rows: [{ label: "Accessibility", terms: "aria, keyboard" }], assess: true }, fetcher);
    expect(outcome).toMatchObject({ status: 503, view: { assessProblem: { title: "The assessment could not be completed" } } });
    expect(calls[1]?.body).toEqual({ id: "institution-ui", version: 1, criteria: [{ id: "criterion-1", label: "Accessibility", terms: ["aria", "keyboard"], contraryTerms: [] }] });
  });

  it("reads access as the API decides it", async () => {
    expect(await discoverAccess(api({ "GET access": () => Response.json({ isAdmin: false, isInstitution: true, isMentor: false }) }).fetcher)).toBe(true);
    expect(await discoverAccess(api({ "GET access": () => Response.json({ isAdmin: false, isInstitution: false, isMentor: true }) }).fetcher)).toBe(false);
    expect(await discoverAccess(api({ "GET access": () => Response.json({ error: "x" }, { status: 500 }) }).fetcher)).toBeNull();
  });
});
