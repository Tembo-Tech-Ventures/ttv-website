import { describe, expect, it, vi } from "vitest";
import {
  FeedbackCliError,
  buildFeedbackRequest,
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
    expect(() => parseFeedbackCliArgs(["show"])).toThrow(/exactly one feedback id/);
    expect(() => parseFeedbackCliArgs(["list", "fb1"])).toThrow(/no id/);
    expect(() => parseFeedbackCliArgs(["decline", "fb1"])).toThrow(/needs --response/);
  });
});

describe("resolveConfig", () => {
  it("requires a well-formed PAT and HTTPS outside localhost", () => {
    expect(() => resolveConfig({})).toThrow(/TTV_FEEDBACK_TOKEN/);
    expect(() => resolveConfig({ TTV_FEEDBACK_TOKEN: "ttv_pat_short" })).toThrow(/TTV_FEEDBACK_TOKEN/);
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
