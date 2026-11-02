import { describe, expect, it } from "vitest";
import { Citation } from "@/lib/platform/contracts";
import { TEMBO_CONFIG } from "./config";
import { groundAnswer, NO_ANSWER, refusal } from "./grounding";
import { SourceBook } from "./sources";

function book(count = 3) {
  const sources = new SourceBook();
  for (let i = 1; i <= count; i += 1) {
    sources.add({ type: "message", messageId: `m${i}`, channelId: "c", title: `Message ${i}`, href: `/dashboard/community/c/help?message=m${i}` }, `text ${i}`);
  }
  return sources;
}

describe("groundAnswer: citations are validated on the server", () => {
  it("keeps tagged sentences, renumbers tags by first use and stores the matching citations", () => {
    const result = groundAnswer("Budgets are due Friday [S2]. Mentors review them on Monday [S1, S2].", book(), "COMMUNITY");
    expect(result.body).toBe("Budgets are due Friday [1]. Mentors review them on Monday [2][1].");
    expect(result.citations.map((c) => c.type === "message" && c.messageId)).toEqual(["m2", "m1"]);
    expect(result.citations.every((c) => Citation.safeParse(c).success)).toBe(true);
    expect(result).toMatchObject({ grounded: true, dropped: 0 });
  });

  it("drops tags naming no source it was given, and sentences left without a valid tag", () => {
    const result = groundAnswer("Fact one [S1]. Invented [S9]. Unsupported claim. Fact two [S7, S3].", book(), "COHORT");
    expect(result.body).toBe("Fact one [1]. Fact two [2].");
    expect(result.citations).toHaveLength(2);
    expect(result.dropped).toBe(2);
  });

  it("keeps tags written after the full stop with their sentence, and drops markers the model numbered itself", () => {
    const result = groundAnswer("First point. [S1] Second point [1]. [S2]\n- A list item [S3]\n\nUntagged closing line.", book(), "COMMUNITY");
    expect(result.body).toBe("First point [1]. Second point [2].\n- A list item [3]");
    expect(result.dropped).toBe(1);
  });

  it.each([
    ["the model says it cannot answer", NO_ANSWER],
    ["NO_ANSWER inside text", `I looked. ${NO_ANSWER}`],
    ["nothing is tagged", "Our next session is on Tuesday. Bring your laptop."],
    ["every tag is invented", "Sessions start at nine [S42]."],
    ["the answer is empty", "   "],
    ["only reasoning", "<think>The sources say nothing.</think>"],
  ])("says it doesn't know when %s", (_, raw) => {
    const result = groundAnswer(raw, book(), "COHORT");
    expect(result).toMatchObject({ body: refusal("COHORT"), citations: [], grounded: false });
  });

  it("words the refusal by what Tembo can see in each kind of channel", () => {
    expect(refusal("COHORT")).toBe("I don't know. I couldn't find this in this cohort's recorded sessions and this channel's messages. Someone here may know.");
    expect(refusal("COMMUNITY")).toContain("public builder profiles");
    expect(refusal("DIRECT")).toBe("I don't know. I couldn't find this in this conversation.");
  });

  it("cuts a long answer at whole sentences within the limit", () => {
    const sentence = `${"word ".repeat(60).trim()} [S1].`;
    const result = groundAnswer(Array.from({ length: 20 }, () => sentence).join(" "), book(), "COMMUNITY");
    expect(result.body.length).toBeLessThanOrEqual(TEMBO_CONFIG.answerChars);
    expect(result.body.endsWith("[1].")).toBe(true);
    expect(result.dropped).toBeGreaterThan(0);
  });

  it("a source given twice keeps one tag, and the book stops at its limit", () => {
    const sources = new SourceBook();
    const citation = { type: "profile", userId: "u", title: "Achieng · builder profile", href: "/talent/achieng" } as const;
    expect(sources.add(citation, "a")).toBe("S1");
    expect(sources.add({ ...citation }, "a")).toBe("S1");
    for (let i = 0; i < TEMBO_CONFIG.maxSources + 5; i += 1) sources.add({ ...citation, userId: `u${i}` }, "x");
    expect(sources.size).toBe(TEMBO_CONFIG.maxSources);
  });
});
