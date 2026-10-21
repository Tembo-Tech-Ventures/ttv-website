import { describe, expect, it, vi } from "vitest";
import {
  FeedbackCliError,
  buildFeedbackRequest,
  formatThemeList,
  formatFeedbackList,
  parseFeedbackCliArgs,
  resolveConfig,
  runFeedbackCli,
} from "./feedback.mjs";

const TOKEN = `ttv_pat_${"a".repeat(64)}`;
const ITEM = {
  id: "fb1",
  kind: "BUG",
  status: "NEW",
  message: "Apply button does nothing\nsecond line",
  page: { url: "https://tembotechventures.com/dashboard/apply", title: "Apply" },
  attachments: [
    {
      id: "a1",
      url: "https://tembotechventures.com/api/feedback/attachments/a1",
      contentType: "image/webp",
    },
  ],
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

describe("parseFeedbackCliArgs", () => {
  it("parses commands, ids and options", () => {
    expect(parseFeedbackCliArgs(["list", "--status=all", "--json"])).toEqual({
      command: "list",
      options: { status: "all", json: true },
    });
    expect(parseFeedbackCliArgs(["resolve", "fb1", "--response=Fixed = done", "--url=https://x/1"])).toEqual({
      command: "resolve",
      id: "fb1",
      options: { response: "Fixed = done", url: "https://x/1" },
    });
  });

  it("rejects unknown commands, stray options, missing ids and silent closes", () => {
    expect(() => parseFeedbackCliArgs(["delete", "fb1"])).toThrow(FeedbackCliError);
    expect(() => parseFeedbackCliArgs(["claim", "fb1", "--response=x"])).toThrow(/Unknown option/);
    expect(() => parseFeedbackCliArgs(["show"])).toThrow("show needs exactly one id.");
    expect(() => parseFeedbackCliArgs(["list", "fb1"])).toThrow(/no id/);
    expect(() => parseFeedbackCliArgs(["decline", "fb1"])).toThrow(/needs --response/);
  });
});

describe("resolveConfig", () => {
  it("requires a well-formed PAT and HTTPS outside localhost", () => {
    expect(() => resolveConfig({})).toThrow(
      "Set TTV_FEEDBACK_TOKEN or TTV_PERSONAL_ACCESS_TOKEN to an admin personal access token"
    );
    expect(() => resolveConfig({ TTV_FEEDBACK_TOKEN: "ttv_pat_short" })).toThrow(
      /TTV_FEEDBACK_TOKEN is not an admin personal access token/
    );
    expect(() =>
      resolveConfig({ TTV_FEEDBACK_TOKEN: TOKEN, TTV_BASE_URL: "http://staging.example" })
    ).toThrow(/HTTPS/);
    expect(resolveConfig({ TTV_FEEDBACK_TOKEN: TOKEN })).toEqual({
      token: TOKEN,
      baseUrl: "https://tembotechventures.com",
    });
    expect(
      resolveConfig({ TTV_FEEDBACK_TOKEN: TOKEN, TTV_BASE_URL: "http://127.0.0.1:4321/x" }).baseUrl
    ).toBe("http://127.0.0.1:4321");
  });
});

describe("token selection", () => {
  const OTHER = `ttv_pat_${"b".repeat(64)}`;

  it("prefers the dedicated feedback token and falls back to the project PAT", () => {
    expect(resolveConfig({ TTV_FEEDBACK_TOKEN: TOKEN, TTV_PERSONAL_ACCESS_TOKEN: OTHER }).token).toBe(TOKEN);
    expect(resolveConfig({ TTV_FEEDBACK_TOKEN: " ", TTV_PERSONAL_ACCESS_TOKEN: OTHER }).token).toBe(OTHER);
  });

  it("explains SAM's secret placeholders instead of sending them", () => {
    expect(() =>
      resolveConfig({ TTV_PERSONAL_ACCESS_TOKEN: "__SAM_SECRET_PLACEHOLDER__" })
    ).toThrow(/TTV_PERSONAL_ACCESS_TOKEN is not .* exec_with_secrets/);
  });
});

describe("buildFeedbackRequest", () => {
  it("maps each command onto the admin API", () => {
    expect(buildFeedbackRequest({ command: "list", options: { status: "NEW", kind: "BUG" } })).toEqual({
      method: "GET",
      path: "/api/admin/feedback?status=NEW&kind=BUG",
    });
    expect(buildFeedbackRequest({ command: "list", options: {} }).path).toBe("/api/admin/feedback");
    expect(buildFeedbackRequest({ command: "claim", id: "fb/1", options: { note: "run 7" } })).toEqual({
      method: "PATCH",
      path: "/api/admin/feedback/fb%2F1",
      body: { status: "IN_PROGRESS", expectedStatus: "NEW", adminNote: "run 7" },
    });
    expect(
      buildFeedbackRequest({ command: "resolve", id: "fb1", options: { response: "Fixed", url: "https://x/1" } })
        .body
    ).toEqual({ status: "RESOLVED", response: "Fixed", resolutionUrl: "https://x/1" });
    expect(buildFeedbackRequest({ command: "decline", id: "fb1", options: { response: "Not now" } }).body).toEqual({
      status: "DECLINED",
      response: "Not now",
    });
  });
});

describe("theme commands", () => {
  it("parse two ids for attach and require a public-safe title and kind to create", () => {
    expect(parseFeedbackCliArgs(["attach", "n1", "t1"])).toEqual({
      command: "attach",
      id: "n1",
      themeId: "t1",
      options: {},
    });
    expect(() => parseFeedbackCliArgs(["attach", "n1"])).toThrow("attach needs id and themeId.");
    expect(() => parseFeedbackCliArgs(["theme-create", "--kind=IDEA"])).toThrow(
      /needs --title=… : titles may be published/
    );
    expect(() => parseFeedbackCliArgs(["themes", "t1"])).toThrow("themes takes no id.");
    expect(() => parseFeedbackCliArgs(["constructor"])).toThrow(/Usage/);
  });

  it("map onto the theme API", () => {
    const build = (argv) => buildFeedbackRequest(parseFeedbackCliArgs(argv));
    expect(build(["list", "--untriaged", "--theme=t1"]).path).toBe(
      "/api/admin/feedback?untriaged=1&themeId=t1"
    );
    expect(build(["sensitive", "n1", "--note=Wellbeing; raised with owner"]).body).toEqual({
      sensitive: true,
      adminNote: "Wellbeing; raised with owner",
    });
    expect(build(["attach", "n1", "t1"])).toEqual({
      method: "PATCH",
      path: "/api/admin/feedback/n1",
      body: { themeId: "t1" },
    });
    expect(build(["detach", "n1"]).body).toEqual({ themeId: null });
    expect(build(["themes", "--status=all"]).path).toBe("/api/admin/feedback/themes?status=all");
    expect(build(["theme", "t1"])).toEqual({ method: "GET", path: "/api/admin/feedback/themes/t1" });
    expect(build(["theme-create", "--title=Dark mode", "--kind=IDEA", "--change=ADD"])).toEqual({
      method: "POST",
      path: "/api/admin/feedback/themes",
      body: { title: "Dark mode", kind: "IDEA", change: "ADD" },
    });
    expect(
      build([
        "theme-update",
        "t1",
        "--status=SHIPPED",
        "--pr=https://x/pull/2",
        "--message=It's live",
        "--note=Digest 2026-10-26",
      ])
    ).toEqual({
      method: "PATCH",
      path: "/api/admin/feedback/themes/t1",
      body: {
        status: "SHIPPED",
        prUrl: "https://x/pull/2",
        studentMessage: "It's live",
        decisionNote: "Digest 2026-10-26",
      },
    });
    expect(() => build(["theme-update", "t1"])).toThrow(/at least one option/);
  });

  it("prints themes with their readiness", () => {
    const output = formatThemeList({
      items: [
        {
          id: "t1",
          status: "COLLECTING",
          kind: "IDEA",
          title: "Dark mode",
          stats: { students: 3, recentStudents: 3 },
          assessment: { readyToPropose: true, reason: "3 students raised this in the last 60 days." },
        },
      ],
    });
    expect(output).toBe(
      "t1  COLLECTING  IDEA      3 students (3 recent)  READY\n    Dark mode\n    3 students raised this in the last 60 days."
    );
    expect(formatThemeList({ items: [] })).toBe("(no themes match)");
  });
});

describe("formatFeedbackList", () => {
  it("prints one scannable entry per item", () => {
    const output = formatFeedbackList({ counts: { NEW: 1, IN_PROGRESS: 0 }, items: [ITEM] });
    expect(output).toBe(
      "NEW 1 · IN_PROGRESS 0\nfb1  NEW         BUG       /dashboard/apply [1 img]\n    Apply button does nothing"
    );
    expect(formatFeedbackList({ counts: { NEW: 0 }, items: [] })).toContain("no feedback matches");
  });
});

describe("runFeedbackCli", () => {
  it("sends the token, never prints it, and downloads screenshots", async () => {
    const fetchImpl = vi.fn(async (url) =>
      String(url).includes("/attachments/")
        ? new Response(new Uint8Array([1, 2, 3]))
        : jsonResponse(ITEM)
    );
    const write = vi.fn(async () => undefined);
    const log = vi.fn();

    await runFeedbackCli(["show", "fb1", "--download=/tmp/ttv-feedback-test"], {
      env: { TTV_FEEDBACK_TOKEN: TOKEN },
      fetchImpl,
      log,
      write,
    });

    expect(fetchImpl.mock.calls[0][0].toString()).toBe(
      "https://tembotechventures.com/api/admin/feedback/fb1"
    );
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(fetchImpl.mock.calls[1][0]).toBe(ITEM.attachments[0].url);
    expect(write).toHaveBeenCalledWith("/tmp/ttv-feedback-test/fb1-1.webp", new Uint8Array([1, 2, 3]));
    expect(JSON.stringify(log.mock.calls)).not.toContain(TOKEN);
  });

  it("refuses to send the token to another origin", async () => {
    const foreign = {
      ...ITEM,
      attachments: [{ ...ITEM.attachments[0], url: "https://evil.example/a1" }],
    };
    const fetchImpl = vi.fn(async () => jsonResponse(foreign));
    await expect(
      runFeedbackCli(["show", "fb1", "--download=/tmp/ttv-feedback-test"], {
        env: { TTV_FEEDBACK_TOKEN: TOKEN },
        fetchImpl,
        log: vi.fn(),
        write: vi.fn(),
      })
    ).rejects.toThrow("Refusing to send the token to https://evil.example/a1.");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("surfaces API errors, including a lost claim race", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: "Feedback is IN_PROGRESS, not NEW." }, 409)
    );
    await expect(
      runFeedbackCli(["claim", "fb1"], { env: { TTV_FEEDBACK_TOKEN: TOKEN }, fetchImpl, log: vi.fn() })
    ).rejects.toThrow("PATCH /api/admin/feedback/fb1 failed (409): Feedback is IN_PROGRESS, not NEW.");
  });

  it("prints the summary list by default and raw JSON on request", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ counts: { NEW: 1 }, items: [ITEM] }));
    const log = vi.fn();
    await runFeedbackCli(["list"], { env: { TTV_FEEDBACK_TOKEN: TOKEN }, fetchImpl, log });
    expect(log.mock.calls[0][0]).toMatch(/^NEW 1/);

    await runFeedbackCli(["list", "--json"], { env: { TTV_FEEDBACK_TOKEN: TOKEN }, fetchImpl, log });
    expect(JSON.parse(log.mock.calls[1][0]).items[0].id).toBe("fb1");
  });
});
