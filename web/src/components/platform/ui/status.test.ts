import { describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import { STATUSES, statusTone, type StatusDomain } from "./status";
import { CHIP_TONES } from "./tones";
import { studentFeedbackState } from "@/lib/feedback/themes";

/** The stored values each domain names, read from the schema itself. */
const COLUMNS: Record<Exclude<StatusDomain, "token" | "studentFeedback">, readonly string[]> = {
  application: schema.programApplication.status.enumValues,
  access: schema.accessRequest.status.enumValues,
  feedback: schema.feedback.status.enumValues,
  theme: schema.feedbackTheme.status.enumValues,
  profile: schema.studentProfile.status.enumValues,
  project: schema.clientProject.status.enumValues,
  recording: schema.recording.processingStatus.enumValues,
};

describe("statusTone", () => {
  it.each(Object.entries(COLUMNS))("names every stored %s status, and only those", (domain, values) => {
    expect(Object.keys(STATUSES[domain as StatusDomain]).toSorted()).toEqual([...values].toSorted());
  });

  it("names every state a student's note can be in, from every note and theme status", () => {
    const states = new Set(schema.feedback.status.enumValues.flatMap((note) =>
      [null, ...schema.feedbackTheme.status.enumValues].map((theme) => studentFeedbackState(note, theme))));
    expect(Object.keys(STATUSES.studentFeedback).toSorted()).toEqual([...states].toSorted());
  });

  it("names a blog post's statuses as a profile's, since they share the column's values", () => {
    expect(Object.keys(STATUSES.profile).toSorted()).toEqual([...schema.blogPost.status.enumValues].toSorted());
  });

  it("reads APPROVED as “Accepted” in every domain that has it", () => {
    for (const statuses of Object.values(STATUSES)) {
      if ("APPROVED" in statuses) expect(statuses.APPROVED.label).toBe("Accepted");
    }
    expect(statusTone("application", "APPROVED")).toEqual({ label: "Accepted", tone: "success" });
  });

  it("gives each status one name, in sentence case, and a chip tone that exists", () => {
    for (const [domain, statuses] of Object.entries(STATUSES)) {
      const looks = Object.values(statuses) as Array<{ label: string; tone: keyof typeof CHIP_TONES }>;
      expect.soft(new Set(looks.map((look) => look.label)).size, `${domain}: one name per status`).toBe(looks.length);
      for (const { label, tone } of looks) {
        expect.soft(label, `${domain}: sentence case`).toMatch(/^[A-Z][a-z]*( [a-z]+)*$/);
        expect.soft(Object.keys(CHIP_TONES), `${domain}: a chip tone`).toContain(tone);
      }
    }
  });

  it("keeps the ring for mentors: no status wears it", () => {
    const tones = Object.values(STATUSES).flatMap((statuses) => Object.values(statuses).map((look) => look.tone));
    expect(tones).not.toContain("ring");
  });

  it("reads a value it does not know as itself, neutral, rather than breaking the page", () => {
    expect(statusTone("recording", "re_encoding" as never)).toEqual({ label: "Re encoding", tone: "neutral" });
  });
});
