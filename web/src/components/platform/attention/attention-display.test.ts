import { describe, expect, it } from "vitest";
import type { AttentionItem } from "@/lib/platform/contracts";
import { attention, people } from "@/lib/platform/fixtures";
import {
  attentionActor,
  attentionPlace,
  attentionTime,
  groupAttention,
  summaryLead,
  unreadTotal,
  visibleAttention,
} from "./attention-display";

const [accepted, mention, tembo, recording, confirmed] = attention.items;

function item(overrides: Partial<AttentionItem>): AttentionItem {
  return { ...accepted, ...overrides };
}

describe("attentionActor", () => {
  it("shows the person behind an item", () => {
    expect(attentionActor(accepted)?.name).toBe("David Kamau");
  });

  it("never shows who decided an application, even if a payload carried them", () => {
    const decided = item({ kind: "application_status", actor: people.amina, summary: "Your application was approved" });
    expect(attentionActor(decided)).toBeNull();
  });

  it("gives Tembo its own mark and shows no person for a deleted author", () => {
    expect(attentionActor(tembo)).toBeNull();
    expect(attentionActor(item({ actor: { ...people.kevin, id: null, name: "Deleted user" } }))).toBeNull();
  });
});

describe("visibleAttention", () => {
  it("drops items for spaces the person cannot open", () => {
    const items = [accepted, mention, item({ id: "admin-item", space: "admin" })];
    expect(visibleAttention(items, ["cohort", "community", "profile"]).map((entry) => entry.id)).toEqual([accepted.id, mention.id]);
  });
});

describe("groupAttention", () => {
  it("puts unread items under New and read ones under Earlier, keeping their order", () => {
    const { fresh, earlier } = groupAttention(attention.items);
    expect(fresh.map((entry) => entry.id)).toEqual([accepted.id, mention.id, tembo.id, recording.id]);
    expect(earlier.every((entry) => entry.readAt !== null)).toBe(true);
    expect(earlier[0].id).toBe(confirmed.id);
  });
});

describe("unreadTotal", () => {
  it("adds only the spaces the person has", () => {
    const counts = { cohort: 2, community: 1, mentoring: 0, discover: 0, admin: 5, profile: 1 };
    expect(unreadTotal(counts, ["cohort", "community", "profile"])).toBe(4);
  });
});

describe("summaryLead", () => {
  it("sets the actor's name apart without rewriting the summary", () => {
    expect(summaryLead(accepted, "David Kamau")).toEqual({ lead: "David Kamau", rest: " accepted your request for a portfolio review" });
  });

  it("falls back to the subject, and to nothing when neither leads", () => {
    expect(summaryLead(recording, null)?.lead).toBe("Session 9 · Webhooks and retries");
    expect(summaryLead(item({ summary: "Something happened" }), "David Kamau")).toBeNull();
  });
});

describe("attentionPlace", () => {
  it("names the space, then the place in it", () => {
    expect(attentionPlace(tembo)).toBe("Community · #show-your-work");
  });

  it("does not say the space twice when the place already names it", () => {
    expect(attentionPlace(mention)).toBe("Cohort 04 · #cohort-04");
  });
});

describe("attentionTime", () => {
  const now = Date.parse("2026-11-03T07:00:00Z"); // A Tuesday in Nairobi.

  it("counts minutes and hours within a day", () => {
    expect(attentionTime(now - 20_000, now).text).toBe("now");
    expect(attentionTime(now - 10 * 60_000, now)).toMatchObject({ text: "10 min", relative: true });
    expect(attentionTime(now - 3 * 3_600_000, now)).toMatchObject({ text: "3 h", relative: true });
  });

  it("names the weekday within a week, in Nairobi time, then the date", () => {
    expect(attentionTime(Date.parse("2026-11-01T22:30:00Z"), now)).toMatchObject({ text: "Mon", relative: false });
    expect(attentionTime(Date.parse("2026-10-02T09:00:00Z"), now).text).toBe("2 Oct");
    expect(attentionTime(Date.parse("2025-10-02T09:00:00Z"), now).text).toBe("2 Oct 2025");
  });

  it("never reports a future item as from the past", () => {
    expect(attentionTime(now + 60_000, now).text).toBe("now");
  });
});
