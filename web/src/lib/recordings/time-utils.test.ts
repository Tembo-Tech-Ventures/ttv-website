import { describe, expect, it } from "vitest";
import { formatDuration, formatTimestamp } from "./time-utils";

describe("recording times", () => {
  it("writes the very start of a recording as 0:00, a real moment", () => {
    expect(formatTimestamp(0)).toBe("0:00");
    expect(formatTimestamp(-2)).toBe("0:00");
    expect(formatTimestamp(92.7)).toBe("1:32");
    expect(formatTimestamp(3725)).toBe("1:02:05");
  });

  it("still marks an unknown length as --", () => {
    expect(formatDuration(null)).toBe("--");
    expect(formatDuration(0)).toBe("--");
    expect(formatDuration(-1)).toBe("--");
    expect(formatDuration(5400)).toBe("1:30:00");
  });
});
