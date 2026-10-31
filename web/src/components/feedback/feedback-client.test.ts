import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CAPTURE_IGNORE_ATTRIBUTE,
  OPEN_FEEDBACK_EVENT,
  openFeedbackWidget,
  takeFeedbackRequest,
  buildFeedbackFormData,
  formatBytes,
  includeInCapture,
} from "./feedback-client";

describe("buildFeedbackFormData", () => {
  it("encodes the fields and keeps each image paired with its source", async () => {
    const capture = new Blob(["a"], { type: "image/webp" });
    const upload = new Blob(["b"], { type: "image/png" });
    const formData = buildFeedbackFormData({
      kind: "BUG",
      message: "Broken",
      attachments: [
        { blob: capture, source: "CAPTURE" },
        { blob: upload, source: "UPLOAD" },
      ],
      pageUrl: "https://tembotechventures.com/dashboard",
      pageTitle: "Dashboard | TTV",
      context: { viewport: { width: 1, height: 2 } },
    });

    expect(formData.get("kind")).toBe("BUG");
    expect(formData.get("context")).toBe('{"viewport":{"width":1,"height":2}}');
    const files = formData.getAll("attachments") as File[];
    expect(files.map((file) => file.name)).toEqual(["capture-1.webp", "upload-2.png"]);
    expect(formData.getAll("attachmentSources")).toEqual(["CAPTURE", "UPLOAD"]);
  });

  it("leaves the kind out when none was picked", () => {
    const formData = buildFeedbackFormData({
      kind: null,
      message: "",
      attachments: [],
      pageUrl: "/",
      pageTitle: "",
      context: {},
    });
    expect(formData.has("kind")).toBe(false);
  });
});

describe("includeInCapture", () => {
  const node = (nodeType: number, tagName = "", attributes: string[] = []) =>
    ({
      nodeType,
      tagName,
      hasAttribute: (name: string) => attributes.includes(name),
    }) as unknown as Node;

  it("keeps text and ordinary elements and drops the widget and dev toolbar", () => {
    expect(includeInCapture(node(3))).toBe(true);
    expect(includeInCapture(node(1, "DIV"))).toBe(true);
    expect(includeInCapture(node(1, "DIV", [CAPTURE_IGNORE_ATTRIBUTE]))).toBe(false);
    expect(includeInCapture(node(1, "ASTRO-DEV-TOOLBAR"))).toBe(false);
  });
});

describe("formatBytes", () => {
  it("reads naturally at both scales", () => {
    expect(formatBytes(200)).toBe("1 KB");
    expect(formatBytes(48_000)).toBe("47 KB");
    expect(formatBytes(2.5 * 1024 * 1024)).toBe("2.5 MB");
  });
});

describe("openFeedbackWidget", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubWindow() {
    const target = new EventTarget();
    const win = Object.assign(target, { CustomEvent }) as unknown as Window;
    vi.stubGlobal("window", win);
    return win;
  }

  it("asks a widget that is listening, and leaves the request for one that is not yet", () => {
    const win = stubWindow();
    const heard: Event[] = [];
    win.addEventListener(OPEN_FEEDBACK_EVENT, (event) => heard.push(event));

    openFeedbackWidget();
    expect(heard).toHaveLength(1);
    // A widget that hydrates later still finds the request, once.
    expect(takeFeedbackRequest()).toBe(true);
    expect(takeFeedbackRequest()).toBe(false);
  });

  it("reports no request when nobody asked", () => {
    stubWindow();
    expect(takeFeedbackRequest()).toBe(false);
  });
});
