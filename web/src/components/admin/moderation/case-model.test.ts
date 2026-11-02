import { describe, expect, it } from "vitest";
import { channels, messages, people } from "@/lib/platform/fixtures";
import {
  DECIDED_NOTICE, decisionOptions, firstName, formatModerationTime, messageHref, sourceLabel,
  undecidableNote, visibilityLabel, type ModerationCase,
} from "./case-model";
import { harnessCases } from "./harness";

const [flagged, reported, mentorHidden, reply, decided] = harnessCases();
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

  it("offers nothing on a deleted hidden message, which B-2.5 refuses every decision on, and says why", () => {
    const gone = { ...flagged, message: { ...messages.deleted, moderation: { state: "HIDDEN" as const, reasons: [] } } };
    expect(decisionOptions(gone)).toEqual([]);
    expect(undecidableNote(gone)).toMatch(/^Its author deleted this message while it was hidden/);
    expect(undecidableNote({ ...gone, state: "DECIDED" })).toBeNull();
    expect(undecidableNote(flagged)).toBeNull();
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
  it("says contact details flagged by Tembo are still visible", () => {
    expect(visibilityLabel(flagged.message)).toBe("still visible");
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

  it("has no page for a direct conversation yet", () => {
    expect(messageHref({ kind: "DIRECT", slug: "dm" }, flagged.message)).toBeNull();
  });

  it("encodes the slug", () => {
    expect(messageHref({ kind: "COMMUNITY", slug: "a b" }, { id: "m", parentId: null })).toBe("/dashboard/community/c/a%20b?message=m");
  });
});

describe("copy", () => {
  it("never claims more than the decision did", () => {
    expect(DECIDED_NOTICE.hide).toMatch(/^Hidden\./);
    expect(DECIDED_NOTICE.restore).toMatch(/^Restored\./);
    expect(DECIDED_NOTICE.keep).toMatch(/^Kept as is\./);
  });

  it("addresses the author by first name, gently", () => {
    expect(firstName("Dennis Kiprono")).toBe("Dennis");
    expect(firstName("   ")).toBe("The author");
  });

  it("writes times in Nairobi time", () => {
    expect(formatModerationTime(Date.parse("2026-11-01T11:05:00Z"))).toBe("1 Nov 2026, 14:05");
  });
});
