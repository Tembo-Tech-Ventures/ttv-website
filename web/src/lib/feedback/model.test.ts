import { describe, expect, it } from "vitest";
import {
  FeedbackValidationError,
  feedbackAttachmentObjectKey,
  feedbackPagePath,
  normalizeFeedbackMessage,
  normalizeFeedbackPageTitle,
  normalizeFeedbackPageUrl,
  normalizeOptionalText,
  normalizeResolutionUrl,
  parseFeedbackAttachmentSource,
  parseFeedbackKind,
  parseFeedbackStatusFilter,
  sanitizeFeedbackContext,
  sniffFeedbackImageType,
} from "./model";

const REQUEST_URL = "https://tembotechventures.com/api/feedback";

// Built at runtime so the linter's script-URL rule does not trip on test data.
const SCRIPT_URL = ["javascript", "alert(1)"].join(":");

describe("parseFeedbackKind", () => {
  it("defaults an unpicked kind to OTHER so a kind is never required", () => {
    expect(parseFeedbackKind(null)).toBe("OTHER");
    expect(parseFeedbackKind("")).toBe("OTHER");
    expect(parseFeedbackKind("BUG")).toBe("BUG");
  });

  it("rejects values outside the list", () => {
    expect(() => parseFeedbackKind("bug")).toThrow(FeedbackValidationError);
  });
});

describe("parseFeedbackStatusFilter", () => {
  it("treats a missing filter and 'open' as the open queue", () => {
    expect(parseFeedbackStatusFilter(null)).toEqual(["NEW", "IN_PROGRESS"]);
    expect(parseFeedbackStatusFilter("open")).toEqual(["NEW", "IN_PROGRESS"]);
  });

  it("accepts 'all' and case-insensitive comma lists without duplicates", () => {
    expect(parseFeedbackStatusFilter("all")).toEqual([
      "NEW",
      "IN_PROGRESS",
      "RESOLVED",
      "DECLINED",
    ]);
    expect(parseFeedbackStatusFilter("resolved, new,NEW")).toEqual(["RESOLVED", "NEW"]);
  });

  it("rejects a filter with no known status", () => {
    expect(() => parseFeedbackStatusFilter("done")).toThrow(/Unknown status filter/);
  });
});

describe("normalizeFeedbackMessage", () => {
  it("trims and normalises line endings", () => {
    expect(normalizeFeedbackMessage("  line one\r\nline two  ")).toBe("line one\nline two");
    expect(normalizeFeedbackMessage(null)).toBe("");
  });

  it("enforces the length limit", () => {
    expect(() => normalizeFeedbackMessage("x".repeat(5_001))).toThrow(/under 5,000/);
    expect(normalizeFeedbackMessage("x".repeat(5_000))).toHaveLength(5_000);
  });
});

describe("normalizeFeedbackPageUrl", () => {
  it("keeps same-origin pages, resolving relative paths and dropping the hash", () => {
    expect(
      normalizeFeedbackPageUrl(
        "https://tembotechventures.com/dashboard/apply?step=2#top",
        REQUEST_URL
      )
    ).toBe("https://tembotechventures.com/dashboard/apply?step=2");
    expect(normalizeFeedbackPageUrl("/dashboard", REQUEST_URL)).toBe(
      "https://tembotechventures.com/dashboard"
    );
    expect(normalizeFeedbackPageUrl(undefined, REQUEST_URL)).toBe(
      "https://tembotechventures.com/"
    );
  });

  it("refuses pages on another origin", () => {
    expect(() =>
      normalizeFeedbackPageUrl("https://evil.example/phish", REQUEST_URL)
    ).toThrow(/page on this site/);
    expect(() => normalizeFeedbackPageUrl(SCRIPT_URL, REQUEST_URL)).toThrow(
      FeedbackValidationError
    );
  });

  it("falls back to the bare path when the query string is enormous", () => {
    const url = normalizeFeedbackPageUrl(`/dashboard?q=${"a".repeat(3_000)}`, REQUEST_URL);
    expect(url).toBe("https://tembotechventures.com/dashboard");
  });
});

describe("feedbackPagePath", () => {
  it("shows the path and query of a stored URL", () => {
    expect(feedbackPagePath("https://tembotechventures.com/dashboard/apply?x=1")).toBe(
      "/dashboard/apply?x=1"
    );
    expect(feedbackPagePath("not a url")).toBe("not a url");
  });
});

describe("normalizeFeedbackPageTitle", () => {
  it("collapses whitespace, bounds length, and treats blank as missing", () => {
    expect(normalizeFeedbackPageTitle("  Apply \n | TTV ")).toBe("Apply | TTV");
    expect(normalizeFeedbackPageTitle("x".repeat(300))).toHaveLength(200);
    expect(normalizeFeedbackPageTitle("   ")).toBeNull();
    expect(normalizeFeedbackPageTitle(42)).toBeNull();
  });
});

describe("sanitizeFeedbackContext", () => {
  it("keeps documented fields and drops everything else", () => {
    const context = sanitizeFeedbackContext(
      JSON.stringify({
        viewport: { width: 390, height: 844 },
        screen: { width: 390, height: 844 },
        devicePixelRatio: 3,
        userAgent: "Mozilla/5.0",
        language: "en-KE",
        timezone: "Africa/Nairobi",
        colorScheme: "dark",
        online: true,
        touch: true,
        errors: [{ message: "boom", source: "app.js:1", at: "2026-10-20T10:00:00Z" }],
        cookies: "session=secret",
      })
    );
    expect(context).toEqual({
      viewport: { width: 390, height: 844 },
      screen: { width: 390, height: 844 },
      devicePixelRatio: 3,
      userAgent: "Mozilla/5.0",
      language: "en-KE",
      timezone: "Africa/Nairobi",
      colorScheme: "dark",
      online: true,
      touch: true,
      errors: [{ message: "boom", source: "app.js:1", at: "2026-10-20T10:00:00Z" }],
    });
    expect(JSON.stringify(context)).not.toContain("secret");
  });

  it("drops malformed values instead of rejecting the note", () => {
    expect(
      sanitizeFeedbackContext({
        viewport: { width: "wide" },
        devicePixelRatio: 99,
        colorScheme: "sepia",
        userAgent: 7,
        errors: "nope",
      })
    ).toEqual({ errors: [] });
    expect(sanitizeFeedbackContext("{not json")).toEqual({ errors: [] });
    expect(sanitizeFeedbackContext([1, 2])).toEqual({ errors: [] });
  });

  it("bounds strings and keeps only the latest ten well-formed errors", () => {
    const errors = [
      { nope: true },
      ...Array.from({ length: 12 }, (_, index) => ({ message: `error ${index}` })),
      { message: "x".repeat(900) },
    ];
    const context = sanitizeFeedbackContext({ userAgent: "u".repeat(1_000), errors });
    expect(context.userAgent).toHaveLength(400);
    expect(context.errors).toHaveLength(10);
    expect(context.errors.at(0)?.message).toBe("error 3");
    expect(context.errors.at(-1)?.message).toHaveLength(500);
  });
});

describe("sniffFeedbackImageType", () => {
  const bytes = (...values: number[]) => new Uint8Array(values);

  it("recognises the four accepted formats by their signatures", () => {
    expect(sniffFeedbackImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe(
      "image/png"
    );
    expect(sniffFeedbackImageType(bytes(0xff, 0xd8, 0xff, 0xdb))).toBe("image/jpeg");
    expect(sniffFeedbackImageType(new TextEncoder().encode("GIF89a"))).toBe("image/gif");
    expect(sniffFeedbackImageType(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe(
      "image/webp"
    );
  });

  it("rejects HTML, SVG and other RIFF files whatever their claimed type", () => {
    expect(sniffFeedbackImageType(new TextEncoder().encode("<html><script>"))).toBeNull();
    expect(sniffFeedbackImageType(new TextEncoder().encode("<svg xmlns="))).toBeNull();
    expect(sniffFeedbackImageType(new TextEncoder().encode("RIFF\0\0\0\0WAVEfmt "))).toBeNull();
    expect(sniffFeedbackImageType(bytes())).toBeNull();
  });
});

describe("attachments", () => {
  it("builds namespaced object keys from the sniffed type", () => {
    expect(feedbackAttachmentObjectKey("fb1", "att1", "image/jpeg")).toBe(
      "feedback/fb1/att1.jpg"
    );
  });

  it("treats an unknown source as an upload", () => {
    expect(parseFeedbackAttachmentSource("CAPTURE")).toBe("CAPTURE");
    expect(parseFeedbackAttachmentSource("SCREEN")).toBe("UPLOAD");
  });
});

describe("normalizeResolutionUrl", () => {
  it("accepts http(s) links and clears on blank", () => {
    expect(normalizeResolutionUrl("https://github.com/o/r/pull/1")).toBe(
      "https://github.com/o/r/pull/1"
    );
    expect(normalizeResolutionUrl("  ")).toBeNull();
    expect(normalizeResolutionUrl(null)).toBeNull();
  });

  it("rejects script and relative links", () => {
    expect(() => normalizeResolutionUrl(SCRIPT_URL)).toThrow(/http\(s\)/);
    expect(() => normalizeResolutionUrl("/admin")).toThrow(/http\(s\)/);
  });
});

describe("normalizeOptionalText", () => {
  it("rejects non-text and over-long values", () => {
    expect(() => normalizeOptionalText(5, 10, "The reply")).toThrow("The reply must be text.");
    expect(() => normalizeOptionalText("x".repeat(11), 10, "The reply")).toThrow(
      "The reply must be 10 characters or fewer."
    );
    expect(normalizeOptionalText(" ok ", 10, "The reply")).toBe("ok");
  });
});
