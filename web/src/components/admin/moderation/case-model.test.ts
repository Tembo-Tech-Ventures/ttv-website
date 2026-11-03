import { describe, expect, it } from "vitest";
import { channels, messages, people } from "@/lib/platform/fixtures";
import {
  CHANNEL_KIND_LABEL, DECIDED_NOTICE, DIRECT_CASE_NOTE, caseContext, channelReference, decidedSubject, decisionLabel,
  decisionOptions, firstName, formatModerationTime, messageHref, sourceLabel, visibilityLabel, type ModerationCase,
} from "./case-model";
import { harnessCases } from "./harness";

const [flagged, reported, mentorHidden, reply, decided] = harnessCases();
const direct = { ...channels.davidConversation, kind: "DIRECT" as const, slug: "conversation", name: "Direct conversation" };
const withState = (item: ModerationCase, state: "VISIBLE" | "FLAGGED" | "HIDDEN"): ModerationCase => ({
  ...item, message: { ...item.message, moderation: { state, reasons: item.reasons } },
});

describe("decisionOptions", () => {
  it("offers fine as is or hide for a visible message, flagged or reported", () => {
    expect(decisionOptions(flagged)).toEqual([{ action: "keep", label: "Fine as is" }, { action: "hide", label: "Hide" }]);
    expect(decisionOptions(reported)).toEqual(decisionOptions(flagged));
  });

  it("offers keep hidden or restore for a hidden message, and never keep", () => {
    expect(decisionOptions(mentorHidden)).toEqual([{ action: "hide", label: "Keep hidden" }, { action: "restore", label: "Restore" }]);
  });

  it("offers only the reversal once a case is decided", () => {
    expect(decisionOptions(decided)).toEqual([{ action: "hide", label: "Hide" }]);
    expect(decisionOptions(withState(decided, "HIDDEN"))).toEqual([{ action: "restore", label: "Restore" }]);
  });

  it("offers only closing the case for a deleted message", () => {
    const gone = { ...flagged, message: { ...messages.deleted, moderation: { state: "FLAGGED" as const, reasons: [] } } };
    expect(decisionOptions(gone)).toEqual([{ action: "keep", label: "Close the case" }]);
    expect(decisionOptions({ ...gone, state: "DECIDED" })).toEqual([]);
  });

  it("closes a deleted message's case with keep whatever its state, hidden included (B-2.7)", () => {
    for (const state of ["VISIBLE", "FLAGGED", "HIDDEN"] as const) {
      const gone = { ...flagged, message: { ...messages.deleted, moderation: { state, reasons: [] } } };
      expect(decisionOptions(gone)).toEqual([{ action: "keep", label: "Close the case" }]);
    }
  });

  it("names a keep on a deleted message as closing its case", () => {
    const decision = { action: "keep" as const, reason: "Gone", by: null, decidedAt: 1 };
    expect(decisionLabel({ message: messages.deleted, decision })).toBe("Closed");
    expect(decisionLabel({ message: flagged.message, decision })).toBe("Kept as is");
    expect(decisionLabel({ message: messages.deleted, decision: { ...decision, action: "hide" } })).toBe("Hidden");
  });

  it("never offers restore on a deleted message", () => {
    for (const state of ["VISIBLE", "FLAGGED", "HIDDEN"] as const) {
      const gone = { ...flagged, message: { ...messages.deleted, moderation: { state, reasons: [] } } };
      expect(decisionOptions(gone).map((option) => option.action)).not.toContain("restore");
    }
  });

  it("offers keep only on a message that is not hidden, and restore only on a hidden one", () => {
    for (const state of ["PENDING", "DECIDED"] as const) {
      for (const moderation of ["VISIBLE", "FLAGGED", "HIDDEN"] as const) {
        const actions = decisionOptions({ state, message: { ...flagged.message, moderation: { state: moderation, reasons: [] } } })
          .map((option) => option.action);
        if (moderation === "HIDDEN") expect(actions).not.toContain("keep");
        else expect(actions).not.toContain("restore");
      }
    }
  });

  it("reads a message without moderation as visible", () => {
    expect(decisionOptions({ ...flagged, message: { ...flagged.message, moderation: null } })[0].action).toBe("keep");
  });
});

describe("sourceLabel", () => {
  it("says who raised each case", () => {
    expect(sourceLabel(flagged)).toBe("Flagged by Tembo");
    expect(sourceLabel(withState(flagged, "HIDDEN"))).toBe("Hidden by Tembo");
    expect(sourceLabel(reported)).toBe("Reported by 2 members");
    expect(sourceLabel({ ...reported, reportCount: 1 })).toBe("Reported by 1 member");
    expect(sourceLabel(mentorHidden)).toBe("Hidden by David Kamau");
    expect(sourceLabel({ ...mentorHidden, actor: null })).toBe("Hidden by a mentor");
    expect(sourceLabel({ ...mentorHidden, source: "ADMIN_HIDE", actor: people.amina })).toBe("Hidden by Amina Hassan");
    expect(sourceLabel({ ...mentorHidden, source: "ADMIN_HIDE", actor: null })).toBe("Hidden by an admin");
  });
});

describe("visibilityLabel", () => {
  it("says flagged contact details are hidden from members, never still visible (QA2-08)", () => {
    expect(visibilityLabel(flagged.message)).toBe("contact details hidden from members");
    expect(visibilityLabel(reported.message)).toBe("still visible");
    expect(visibilityLabel({ ...flagged.message, moderation: { state: "FLAGGED", reasons: ["Uses a shortened link"] } })).toBe("still visible");
    expect(visibilityLabel(mentorHidden.message)).toBe("hidden from members");
    expect(visibilityLabel(messages.deleted)).toBe("deleted by its author");
  });
});

describe("messageHref", () => {
  it("opens a channel message in its space, and a reply in its thread", () => {
    expect(messageHref(channels.opportunities, flagged.message)).toBe(`/dashboard/community/c/opportunities?message=${flagged.message.id}`);
    expect(messageHref(reply.channel, reply.message))
      .toBe(`/dashboard/cohort/c/cohort-04?thread=${reply.message.parentId}&message=${reply.message.id}`);
  });

  it("never links to a direct conversation: only its two members can open it (QA4-01)", () => {
    expect(messageHref({ kind: "DIRECT", slug: "dm" }, flagged.message)).toBeNull();
    expect(messageHref(direct, reply.message)).toBeNull();
  });

  it("encodes the slug", () => {
    expect(messageHref({ kind: "COMMUNITY", slug: "a b" }, { id: "m", parentId: null })).toBe("/dashboard/community/c/a%20b?message=m");
  });
});

describe("a direct conversation's case (QA4-01)", () => {
  // The queue's stand-in for a conversation an admin isn't in (caseOnlyChannel): no real slug or name.
  const item: ModerationCase = { ...flagged, channel: direct };

  it("reads as a direct conversation, never as a #channel", () => {
    expect(channelReference(direct)).toBe("a direct conversation");
    expect(caseContext(direct, mentorHidden.message)).toBe("Direct conversation · hidden from members");
    expect(caseContext(direct, flagged.message)).not.toContain("#");
    expect(decidedSubject(item)).toMatch(new RegExp(`^${flagged.message.author.name}'s message in a direct conversation: “.+”$`));
  });

  it("says that only this message is shared with admins", () => {
    expect(DIRECT_CASE_NOTE).toBe("Only this message is shared with admins; the rest of the conversation stays private to its two members.");
  });

  it("names channels as before", () => {
    expect(channelReference(channels.opportunities)).toBe("#opportunities");
    expect(caseContext(channels.opportunities, flagged.message)).toBe("Community · #opportunities · contact details hidden from members");
    expect(caseContext(channels.opportunities, reported.message)).toBe("Community · #opportunities · still visible");
    expect(CHANNEL_KIND_LABEL.COHORT).toBe("Cohort");
  });
});

describe("copy", () => {
  it("never claims more than the decision did", () => {
    expect(DECIDED_NOTICE.hide).toMatch(/^Hidden\./);
    expect(DECIDED_NOTICE.restore).toMatch(/^Restored\./);
    expect(DECIDED_NOTICE.keep).toMatch(/^Kept as is\./);
  });

  it("does not promise a review after an admin hides or keeps hiding a message: that decision is final (QA2-14)", () => {
    expect(DECIDED_NOTICE.hide).not.toMatch(/review/);
    expect(DECIDED_NOTICE.hide).toMatch(/an admin's decision is final\.$/);
  });

  it("addresses the author by first name, gently", () => {
    expect(firstName("Dennis Kiprono")).toBe("Dennis");
    expect(firstName("   ")).toBe("The author");
  });

  it("writes times in Nairobi time, and says so (QA2-13)", () => {
    expect(formatModerationTime(Date.parse("2026-11-01T11:05:00Z"))).toBe("1 Nov 2026, 14:05 EAT");
  });
});
