import { readFileSync, readdirSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { loadRenderers } from "astro:container";
import { getContainerRenderer } from "@astrojs/react/container-renderer";
import { Window } from "happy-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createSqliteD1, readMigration } from "@/test/sqlite-d1";
import { withRaw } from "@/lib/attention/test-support";

/*
 * /dashboard/discover rebuilt on the kit (style-guide rollout M16, D5): the kit title "Discover" and
 * a sentence, onboarding after it, the two ways in as a PillNav, kit fields, no decorative numbers or
 * editorial display, one peach action per view, and no island. Lookups and profile links are GETs;
 * scouting, opening, asking and assessing are POSTs, so the opportunity never enters an address.
 * Through the real middleware and page on SQLite with every migration; authentication is mocked, and
 * there is no AI binding, so Tembo's calls fail as a 503 the page explains.
 */
const mocks = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
  getSession: vi.fn(),
}));
vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
vi.mock("@/lib/auth", async () => {
  const { sessionApi } = await import("@/test/auth-mock");
  return { createAuth: () => ({ api: sessionApi(mocks.getSession) }) };
});

const { onRequest } = await import("@/middleware");
const { default: Page } = await import("../discover.astro");

const SCOUT = "synthetic-joseph";
const MEMBER = "synthetic-achieng";
const ORIGIN = "https://ttv.invalid";
const PATH = "/dashboard/discover";
const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

/** An approved institution, and a member with a saved profile and one shared contribution. */
function seeded(extra = "") {
  const { database, db } = createSqliteD1();
  databases.push(database);
  for (const file of readdirSync(
    new URL("../../../lib/db/migrations/", import.meta.url),
  )
    .filter((name) => name.endsWith(".sql"))
    .toSorted()) {
    database.exec(readMigration(file));
  }
  database.exec(`INSERT INTO user(id,name,email) VALUES ('${SCOUT}','Joseph Mutua','joseph@example.test'), ('${MEMBER}','Achieng Otieno','achieng@example.test');
    INSERT INTO UserRoles(id,userId,roleId) SELECT 'institution-role','${SCOUT}',id FROM Roles WHERE name='INSTITUTION';
    INSERT INTO studentProfile(id,handle,userId,headline,bio,skills,opportunityGoals) VALUES ('${MEMBER}','${MEMBER}','${MEMBER}','Frontend builder','Builds savings tools.','["React"]','A first developer role');
    INSERT INTO communityJourney(id,userId,title,description,evidenceUrl,occurredAt,visibility) VALUES ('ledger','${MEMBER}','Chama savings ledger','Built and tested a fictional savings ledger.','https://github.com/example/ledger','2026-10-24','institution');
    UPDATE feature_flag SET audience='ALL';
    ${extra}`);
  Object.assign(mocks.env, {
    DB: withRaw(database, db),
    DEPLOYMENT_ENVIRONMENT: "production",
  });
}

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create({
    renderers: await loadRenderers([getContainerRenderer()]),
  });
});

async function visit({
  path = PATH,
  form,
  user = SCOUT,
}: { path?: string; form?: Record<string, string>; user?: string } = {}) {
  const url = new URL(path, ORIGIN);
  mocks.getSession.mockResolvedValue({
    user: {
      id: user,
      name: "Joseph Mutua",
      email: "joseph@example.test",
      image: null,
      emailVerified: true,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    },
    session: { id: `${user}-session`, userId: user, userAgent: "Mozilla/5.0" },
  });
  const method = form ? "POST" : "GET";
  const headers: Record<string, string> = form
    ? { "content-type": "application/x-www-form-urlencoded", origin: ORIGIN }
    : {};
  const request = () =>
    new Request(url, {
      method,
      headers,
      body: form ? new URLSearchParams(form).toString() : undefined,
    });
  const locals = {} as App.Locals;
  const context = {
    url,
    request: request(),
    locals,
    params: {},
    cookies: { get: () => undefined, set: () => {} },
    redirect: (location: string, status = 302) =>
      new Response(null, { status, headers: { location } }),
  };
  const response = (await onRequest(context as never, async () =>
    container.renderToResponse(Page, { request: request(), locals }),
  )) as Response;
  return { status: response.status, body: await response.text() };
}

const dom = (html: string) => {
  const { document } = new Window();
  document.body.innerHTML = html;
  return document.body;
};
const main = (html: string) => dom(html).querySelector("#spaces-main")!;
const primaries = (root: ReturnType<typeof main>) =>
  [...root.querySelectorAll("a, button")]
    .filter((control) => control.getAttribute("data-variant") === "primary")
    .map((control) => control.textContent?.trim());

describe("Discover", () => {
  it("leads with the kit title and a sentence, then the two ways in, with no hero, numbers or eyebrows", async () => {
    seeded();
    const { status, body } = await visit();
    expect(status).toBe(200);
    const page = main(body);
    expect(page.querySelectorAll("h1")).toHaveLength(1);
    expect(page.querySelector("h1")?.textContent).toBe("Discover");
    expect(page.querySelector("h1, h2, h3")).toBe(page.querySelector("h1"));
    const nav = page.querySelector("nav[aria-label='How to discover people']")!;
    expect(nav.querySelector("[aria-current='page']")?.textContent).toBe(
      "Scout by criteria",
    );
    expect(page.textContent).not.toMatch(/See the work\.|01 \/|\b02\b|AI /);
    expect(page.innerHTML).not.toMatch(
      /discovery-|<em>|\buppercase\b|astro-island/,
    );
    expect(primaries(page)).toEqual(["Discover people"]);
    // The opportunity is posted, never put in an address.
    expect(
      page
        .querySelector("textarea[name='context']")
        ?.closest("form")
        ?.getAttribute("method"),
    ).toBe("POST");
  });

  it("looks someone up by name with a GET, and lists them as kit cards", async () => {
    seeded();
    const form = main(
      (await visit({ path: `${PATH}?lookup=1` })).body,
    ).querySelector("[data-discover-criteria='lookup'] form")!;
    expect(form.getAttribute("method")).toBe("GET");
    const { status, body } = await visit({
      path: `${PATH}?lookup=1&scout=results&query=Achieng`,
    });
    expect(status).toBe(200);
    const page = main(body);
    const person = page.querySelector(`[data-person='${MEMBER}']`)!;
    expect(person.hasAttribute("data-card")).toBe(true);
    expect(person.querySelector("h3")?.textContent).toBe("Achieng Otieno");
    expect(person.querySelector(`[data-avatar='${MEMBER}']`)).not.toBeNull();
    const explore = person.querySelector("a")!;
    expect(explore.textContent?.trim()).toBe("Explore Achieng's work");
    expect(explore.getAttribute("data-variant")).toBe("quiet");
    expect(explore.getAttribute("href")).toBe(
      `${PATH}?profile=${MEMBER}&lookup=1&query=Achieng`,
    );
    expect(primaries(page)).toEqual([]);
  });

  it("opens a person's profile and work, with Explore evidence as the one peach action", async () => {
    seeded();
    const { status, body } = await visit({
      path: `${PATH}?profile=${MEMBER}&lookup=1&query=Achieng`,
    });
    expect(status).toBe(200);
    const page = main(body);
    expect(page.querySelector("#discover-person-name")?.textContent).toBe(
      "Achieng Otieno",
    );
    expect(page.querySelector("[data-back-link]")?.getAttribute("href")).toBe(
      `${PATH}?lookup=1&scout=results&query=Achieng`,
    );
    const work = page.querySelector("[data-data-list] [data-data-list-item]")!;
    expect(work.querySelector("h3")?.textContent).toBe("Chama savings ledger");
    expect(work.querySelector("time")?.textContent).toBe("24 Oct 2026");
    expect(work.textContent).toContain("No confirmation recorded");
    expect(primaries(page)).toEqual(["Explore evidence"]);
    for (const form of page.querySelectorAll(
      "[data-discover-ask] form, [data-discover-assess] form",
    ))
      expect(form.getAttribute("method")).toBe("POST");
    expect(page.textContent).toContain(
      "Tembo's answer is not a mentor confirmation.",
    );
  });

  it("scouts with a POST, and when Tembo can't search, keeps the criteria and answers 503", async () => {
    seeded();
    const { status, body } = await visit({
      form: {
        form: "scout",
        context: "A confidential fintech role",
        skills: "React",
        query: "",
      },
    });
    expect(status).toBe(503);
    const page = main(body);
    expect(page.querySelector("[data-notice='danger']")?.textContent).toContain(
      "Search could not be completed",
    );
    expect(page.querySelector("textarea[name='context']")?.textContent).toBe(
      "A confidential fintech role",
    );
    expect(body).toMatch(/<title>Error: /);
  });

  it("answers a search with nothing to search by with a 400 and an error under the field", async () => {
    seeded();
    const { status, body } = await visit({
      form: { form: "scout", context: "", skills: "", query: "" },
    });
    expect(status).toBe(400);
    expect(
      main(body)
        .querySelector("textarea[name='context']")
        ?.getAttribute("aria-invalid"),
    ).toBe("true");
  });

  it("opens a person from scouting results with the search in hidden fields, so Back to people runs it again", async () => {
    seeded();
    const { status, body } = await visit({
      form: {
        form: "open",
        profile: MEMBER,
        context: "A confidential fintech role",
        skills: "React",
        query: "",
      },
    });
    expect(status).toBe(200);
    const page = main(body);
    const back = [...page.querySelectorAll("form")].find((form) =>
      form.textContent?.includes("Back to people"),
    )!;
    expect(back.getAttribute("method")).toBe("POST");
    expect(
      back.querySelector("input[name='form']")?.getAttribute("value"),
    ).toBe("scout");
    expect(
      back.querySelector("input[name='context']")?.getAttribute("value"),
    ).toBe("A confidential fintech role");
    expect(
      page
        .querySelector("[data-discover-ask] input[name='context']")
        ?.getAttribute("value"),
    ).toBe("A confidential fintech role");
  });

  it("keeps a question when Tembo can't answer it", async () => {
    seeded();
    const { status, body } = await visit({
      form: {
        form: "ask",
        profile: MEMBER,
        question: "What did they build?",
        context: "",
        skills: "",
        query: "",
      },
    });
    expect(status).toBe(503);
    const ask = main(body).querySelector("[data-discover-ask]")!;
    expect(ask.querySelector("[data-notice='danger']")?.textContent).toContain(
      "We couldn't answer that question",
    );
    expect(ask.querySelector("textarea[name='question']")?.textContent).toBe(
      "What did they build?",
    );
  });

  it("adds a criterion row without assessing", async () => {
    seeded();
    const { status, body } = await visit({
      form: {
        form: "assess",
        profile: MEMBER,
        rows: "1",
        "label-0": "Accessibility",
        "terms-0": "aria",
        intent: "add-criterion",
        context: "",
        skills: "",
        query: "",
      },
    });
    expect(status).toBe(200);
    const assess = main(body).querySelector("[data-discover-assess]")!;
    expect(
      assess.querySelector("input[name='label-0']")?.getAttribute("value"),
    ).toBe("Accessibility");
    expect(assess.querySelector("input[name='label-1']")).not.toBeNull();
    expect(
      assess.querySelector("input[name='rows']")?.getAttribute("value"),
    ).toBe("2");
  });

  it("says institutional access needs approval to someone without it", async () => {
    seeded();
    const { status, body } = await visit({ user: MEMBER });
    // Without the Discover space the middleware answers first; either way nothing of anyone's profile shows.
    expect([403, 404]).toContain(status);
    expect(body).not.toContain("Achieng Otieno");
  });

  it("refuses a post from another origin", async () => {
    seeded();
    const url = new URL(PATH, ORIGIN);
    mocks.getSession.mockResolvedValue({
      user: {
        id: SCOUT,
        name: "Joseph Mutua",
        email: "joseph@example.test",
        image: null,
        emailVerified: true,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      },
      session: {
        id: `${SCOUT}-session`,
        userId: SCOUT,
        userAgent: "Mozilla/5.0",
      },
    });
    const request = () =>
      new Request(url, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: "https://elsewhere.example",
        },
        body: "form=scout&context=x",
      });
    const locals = {} as App.Locals;
    const context = {
      url,
      request: request(),
      locals,
      params: {},
      cookies: { get: () => undefined, set: () => {} },
      redirect: () => new Response(null),
    };
    const response = (await onRequest(context as never, async () =>
      container.renderToResponse(Page, { request: request(), locals }),
    )) as Response;
    expect(response.status).toBe(403);
  });

  it("has no island and no flag-off branch of its own", () => {
    const source = readFileSync(
      new URL("../discover.astro", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(
      /client:|CommunityApp|discovery\.css|BaseLayout/,
    );
  });
});
