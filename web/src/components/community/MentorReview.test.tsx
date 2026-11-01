// @vitest-environment happy-dom
/* oxlint-disable no-script-url -- Deliberately unsafe URL fixtures verify link filtering. */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { CommunityEmbedded } from "../discovery/DiscoveryShell";
import MentorReview, {
  evidenceDestination,
  safeMentorEvidenceUrl,
  validateMentorNote,
  validateMentorMethod,
  type MentorReviewRequest,
} from "./MentorReview";

const request: MentorReviewRequest = {
  id: "claim-1",
  version: 3,
  memberName: "Demo member",
  claimTitle: "Built a scheduling API",
  claimDescription: "Implemented documented API routes with tests.",
  status: "pending",
  evidence: [
    {
      id: "source-1",
      title: "Project repository",
      url: "https://example.com/project",
    },
  ],
};
const render = (requests = [request], demo = false) =>
  renderToStaticMarkup(
    <MentorReview
      requests={requests}
      onReview={vi.fn(async () => {})}
      demo={demo}
    />,
  );

describe("MentorReview", () => {
  it("identifies the exact claim, scope, evidence and labelled review fields", () => {
    const html = render();
    expect(html).toContain("Built a scheduling API");
    expect(html).toContain("not the whole person");
    expect(html).toContain("An assistant response does not confirm a claim");
    expect(html).toContain('href="https://example.com/project"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("What did you personally check?");
    expect(html).toContain("Choose a decision");
    expect(html).toMatch(/<textarea[^>]+required=""/);
    expect(html).toContain("aria-labelledby=");
  });
  it("shows existing review history without presenting it as a new request", () => {
    const html = render([
      {
        ...request,
        confirmations: [
          {
            id: "review",
            mentorName: "Reviewer",
            mentorRole: "ADMIN",
            note: "Checked the API tests",
            method: "Code review",
            date: "2026-10-24",
            journeyVersion: 3,
          },
        ],
      },
    ]);
    expect(html).toContain("Confirmation history");
    expect(html).toContain("Administrator");
    expect(html).toContain(
      "this list is not a queue of review requests",
    );
    expect(html).not.toContain("Awaiting your review");
  });
  it("marks demonstration actions clearly", () => {
    expect(render([request], true)).toContain("not real mentor confirmations");
    expect(render([request], true)).toContain("Save demo review");
    expect(render()).not.toContain("Save demo review");
  });
  it.each(["confirmed", "declined"] as const)(
    "does not offer repeat review for %s claims",
    (status) => {
      const html = render([{ ...request, status }]);
      expect(html).not.toContain("<form");
      expect(html).toContain(
        status === "confirmed"
          ? "Claim confirmed: Built a scheduling API"
          : "Confirmation declined for this claim: Built a scheduling API",
      );
    },
  );
  it("provides empty states without implying a negative judgment", () => {
    expect(render([])).toContain(
      "No published contributions are available to review",
    );
    expect(render([{ ...request, evidence: [] }])).toContain(
      "Missing evidence is not evidence against the member",
    );
  });
  it("renders unsafe evidence as text without a navigable link", () => {
    const html = render([
      {
        ...request,
        evidence: [{ id: "bad", title: "Source", url: "javascript:alert(1)" }],
      },
    ]);
    expect(html).toContain("Source — link unavailable");
    expect(html).not.toContain("href=");
    expect(html).not.toContain("javascript:");
  });
});

describe("mentor review validation", () => {
  it.each(["", "   ", "Looks good", "a".repeat(30), " ".repeat(30) + "yes"])(
    "rejects insufficient note %j",
    (note) => {
      expect(validateMentorNote(note)).not.toBeNull();
    },
  );
  it("accepts a personal review and rejects oversized notes", () => {
    expect(
      validateMentorNote(
        "I ran the repository tests and inspected the API routes.",
      ),
    ).toBeNull();
    expect(
      validateMentorNote("Checked the source " + "a".repeat(2000)),
    ).toContain("2,000");
  });
  it.each([
    "javascript:alert(1)",
    "data:text/html,test",
    "//example.com",
    "/private",
    "https://user:password@example.com",
    "not a url",
  ])("blocks unsupported URL %j", (url) => {
    expect(safeMentorEvidenceUrl(url)).toBeNull();
  });
  it.each(["http://example.com/", "https://example.com/source"])(
    "allows web evidence %j",
    (url) => {
      expect(safeMentorEvidenceUrl(url)).toBe(url);
    },
  );
});

describe("evidence links", () => {
  it("name where each goes, so links titled alike can be told apart", () => {
    const html = render([
      {
        ...request,
        evidence: [
          { id: "a", title: "Supporting work", url: "https://github.com/achieng/ledger" },
          { id: "b", title: "Supporting work", url: "https://www.example.org/notes/sql-joins/" },
        ],
      },
    ]);
    const names = Array.from(html.matchAll(/<a [^>]*>(.*?)<\/a>/g), ([, inner]) => inner!.replace(/<[^>]+>/g, ""));
    expect(names).toEqual([
      "Supporting work github.com/achieng/ledger ↗ (opens in a new tab)",
      "Supporting work example.org/notes/sql-joins ↗ (opens in a new tab)",
    ]);
    expect(html).toContain('class="mentor-evidence"');
    expect(html).toContain('<span aria-hidden="true"> ↗</span>');
    expect(html).toContain('<span class="sr-only"> (opens in a new tab)</span>');
  });

  it("shortens a long address without losing where it goes", () => {
    expect(evidenceDestination("https://github.com/achieng")).toBe("github.com/achieng");
    expect(evidenceDestination("https://example.com/")).toBe("example.com");
    const long = evidenceDestination(`https://example.com/${"a".repeat(80)}`);
    expect(long).toHaveLength(48);
    expect(long.startsWith("example.com/aaa")).toBe(true);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("mentor revision and method contract", () => {
  it("shows the reviewed revision and requires a method", () => {
    const html = render();
    expect(html).toContain("Claim revision 3");
    expect(html).toContain("How did you check it?");
    expect(html).toMatch(
      /<input[^>]+required=""[^>]+minLength="3"[^>]+maxLength="500"/,
    );
    expect(render([{ ...request, version: 4 }])).toContain("Claim revision 4");
  });
  it("does not offer decline unless explicitly enabled", () => {
    expect(render()).not.toContain('value="declined"');
    const html = renderToStaticMarkup(
      <MentorReview
        requests={[request]}
        onReview={vi.fn(async () => {})}
        demo
        allowDecline
      />,
    );
    expect(html).toContain('value="declined"');
  });
  it.each(["", "  ", "ab", "a".repeat(501)])(
    "rejects an invalid method",
    (method) => {
      expect(validateMentorMethod(method)).not.toBeNull();
    },
  );
  it.each([
    "  ran  ",
    "a".repeat(500),
    "Ran the project's tests and reviewed the source",
  ])("accepts a method within the limits", (method) => {
    expect(validateMentorMethod(method)).toBeNull();
  });
  describe("in the spaces shell", () => {
    const confirmed = { ...request, id: "claim-2", claimTitle: "Wrote the docs", status: "confirmed" as const };
    const embedded = (requests: MentorReviewRequest[]) =>
      renderToStaticMarkup(
        <CommunityEmbedded.Provider value>
          <MentorReview requests={requests} onReview={vi.fn(async () => {})} />
        </CommunityEmbedded.Provider>,
      );

    it("says plainly how much waits for confirmation, without implying review requests", () => {
      const html = embedded([request, { ...request, id: "claim-3" }, confirmed]);
      expect(html).toContain('data-awaiting-confirmation="2"');
      expect(html).toContain("2 shared contributions are waiting for your confirmation.");
      expect(html).toContain("Nobody has sent you a review request");
      expect(html).toContain("Waiting for your confirmation of this revision.");
      expect(html).not.toContain("not a queue of review requests");
    });

    it("says when nothing waits, says nothing about an empty list, and keeps missing evidence neutral", () => {
      expect(embedded([confirmed])).toContain("Nothing here is waiting for your confirmation.");
      const empty = embedded([]);
      expect(empty).not.toContain("data-awaiting-confirmation");
      expect(empty).toContain("No published contributions are available to review");
      expect(embedded([{ ...request, evidence: [] }])).toContain(
        "Missing evidence is not evidence against the member",
      );
    });

    it("counts a confirmation saved on the page as no longer waiting", async () => {
      (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
      const host = document.createElement("div");
      document.body.appendChild(host);
      const root = createRoot(host);
      const onReview = vi.fn(async () => {});
      await act(async () =>
        root.render(
          <CommunityEmbedded.Provider value>
            <MentorReview requests={[request, { ...request, id: "claim-3" }]} onReview={onReview} />
          </CommunityEmbedded.Provider>,
        ),
      );
      const count = () => host.querySelector("[data-awaiting-confirmation]")?.getAttribute("data-awaiting-confirmation");
      expect(count()).toBe("2");
      const form = host.querySelector("form")!;
      const set = (selector: string, value: string) => {
        const field: HTMLElement = form.querySelector<HTMLElement>(selector)!;
        // React tracks the value setter, so set it the way a browser does.
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field) as object, "value")!.set!.call(field, value);
        field.dispatchEvent(new Event(field.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
      };
      await act(async () => {
        set("select", "confirmed");
        set("input", "Read the repository");
        set("textarea", "I read the API routes and ran their tests locally.");
      });
      await act(async () => {
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      });
      expect(onReview).toHaveBeenCalledWith("claim-1", expect.objectContaining({ decision: "confirmed", expectedRevision: 3 }));
      expect(count()).toBe("1");
      expect(host.textContent).toContain("1 shared contribution is waiting for your confirmation.");
      await act(async () => root.unmount());
      host.remove();
    });

    it("leaves the existing dashboard's wording unchanged", () => {
      const html = render([request]);
      expect(html).toContain("this list is not a queue of review requests");
      expect(html).toContain("You can add a confirmation after reviewing this revision.");
      expect(html).not.toContain("data-awaiting-confirmation");
    });
  });
});
