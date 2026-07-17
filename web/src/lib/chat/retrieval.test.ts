import { describe, expect, it } from "vitest";
import { orderTranscriptSources } from "@/lib/chat/retrieval";

describe("orderTranscriptSources", () => {
  it("preserves vector relevance order, ignores missing rows, and truncates previews", () => {
    const sources = orderTranscriptSources(
      ["most-relevant", "missing", "less-relevant"],
      [
        {
          id: "less-relevant",
          recordingId: "recording-2",
          startTime: 20,
          endTime: 30,
          text: "short excerpt",
          recording: { title: "Second" },
        },
        {
          id: "most-relevant",
          recordingId: "recording-1",
          startTime: 1,
          endTime: 4,
          text: "x".repeat(220),
          recording: { title: "First" },
        },
      ]
    );

    expect(sources.map((item) => item.citation.title)).toEqual(["First", "Second"]);
    expect(sources[0]?.citation.text).toHaveLength(181);
    expect(sources[0]?.citation.text.endsWith("…")).toBe(true);
    expect(sources[0]?.content).toHaveLength(220);
  });
});
