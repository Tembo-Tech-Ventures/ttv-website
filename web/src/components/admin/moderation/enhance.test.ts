// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { NETWORK_FAILURE, SIGNED_OUT, UNEXPECTED, enhanceModerationQueue, readOutcome } from "./enhance";

const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");

const queue = (inner: string) => `<div data-moderation-root>${inner}</div>`;
const card = (error = "") => `
  <form method="POST" action="/admin/moderation" data-moderation-form>
    <input type="hidden" name="messageId" value="m1">
    <textarea name="reason">Off topic</textarea>
    <p data-moderation-error tabindex="-1" class="${error ? "" : "hidden"}">${error}</p>
    <button type="submit" name="action" value="keep">Fine as is</button>
    <button type="submit" name="action" value="hide">Hide</button>
  </form>`;

describe("readOutcome", () => {
  it("shows the queue the server rendered, refusal or not", () => {
    expect(readOutcome({ url: "http://x/admin/moderation", status: 200 }, queue("done"), parse).kind).toBe("queue");
    expect(readOutcome({ url: "http://x/admin/moderation", status: 409 }, queue(card("Nothing changed.")), parse).kind).toBe("queue");
  });

  it("never treats a sign-in page as a decision", () => {
    expect(readOutcome({ url: "http://x/auth/login", status: 200 }, queue("x"), parse)).toEqual({ kind: "failed", message: SIGNED_OUT });
  });

  it("never treats an error page as a decision", () => {
    expect(readOutcome({ url: "http://x/admin/moderation", status: 500 }, queue("x"), parse)).toEqual({ kind: "failed", message: UNEXPECTED });
    expect(readOutcome({ url: "http://x/admin/moderation", status: 403 }, "Forbidden", parse)).toEqual({ kind: "failed", message: UNEXPECTED });
  });
});

describe("enhanceModerationQueue", () => {
  let stop = () => {};
  afterEach(() => {
    stop();
    document.body.innerHTML = "";
  });

  function setUp(fetcher: typeof fetch) {
    document.body.innerHTML = queue(card());
    stop = enhanceModerationQueue(document, fetcher);
    const form = document.querySelector("form")!;
    const hide = form.querySelector<HTMLButtonElement>("button[value=hide]")!;
    return { form, hide };
  }

  function press(form: HTMLFormElement, button: HTMLButtonElement) {
    form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true, submitter: button }));
  }

  it("posts the decision the admin pressed, then swaps in the server's queue and focuses its banner", async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body as FormData;
      expect(body.get("action")).toBe("hide");
      expect(body.get("reason")).toBe("Off topic");
      return new Response(queue('<p data-moderation-notice tabindex="-1" autofocus>Hidden.</p>'), { status: 200 });
    });
    const { form, hide } = setUp(fetcher as unknown as typeof fetch);
    press(form, hide);
    await vi.waitFor(() => expect(document.querySelector("[data-moderation-notice]")).not.toBeNull());
    expect(document.activeElement).toBe(document.querySelector("[data-moderation-notice]"));
    expect(document.querySelectorAll("[data-moderation-root]")).toHaveLength(1);
  });

  it("says nothing changed when TTV cannot be reached, keeping the reason", async () => {
    const { form, hide } = setUp((async () => { throw new TypeError("offline"); }) as unknown as typeof fetch);
    press(form, hide);
    const error = form.querySelector<HTMLElement>("[data-moderation-error]")!;
    await vi.waitFor(() => expect(error.textContent).toBe(NETWORK_FAILURE));
    expect(error.classList.contains("hidden")).toBe(false);
    expect(document.activeElement).toBe(error);
    expect(form.querySelector("textarea")!.value).toBe("Off topic");
    expect(form.hasAttribute("aria-busy")).toBe(false);
    expect(document.querySelector("[data-moderation-notice]")).toBeNull();
  });

  it("ignores a second press while the first is in flight", async () => {
    let settle!: (response: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>((resolve) => { settle = resolve; }));
    const { form, hide } = setUp(fetcher as unknown as typeof fetch);
    press(form, hide);
    press(form, hide);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(hide.getAttribute("aria-disabled")).toBe("true");
    settle(new Response("Server error", { status: 500 }));
    await vi.waitFor(() => expect(form.querySelector("[data-moderation-error]")!.textContent).toBe(UNEXPECTED));
    expect(hide.hasAttribute("aria-disabled")).toBe(false);
  });
});
