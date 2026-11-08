import { describe, expect, it } from "vitest";
import { MentorArea, MentorRequestFormat, WORTH_ANOTHER_LOOK_LIMIT as CONTRACT_LOOK_LIMIT } from "../contracts";
import { isMentorArea, isMentorRequestFormat, MENTOR_REQUEST_FORMATS, WORTH_ANOTHER_LOOK_LIMIT } from "./mentor-constants";

describe("the mentor contract's values without zod", () => {
  it("lists the formats the contract does, in its order", () => {
    expect(MENTOR_REQUEST_FORMATS).toEqual(MentorRequestFormat.options);
    for (const value of [...MentorRequestFormat.options, "LUNCH", "", null, 3]) {
      expect(isMentorRequestFormat(value), `${String(value)}`).toBe(MentorRequestFormat.safeParse(value).success);
    }
  });

  it("accepts an area exactly when the contract does", () => {
    for (const value of ["Code review", " Mobile ", "x".repeat(40), "x".repeat(41), "", "   ", null, 7]) {
      expect(isMentorArea(value), `${String(value)}`).toBe(MentorArea.safeParse(value).success);
    }
  });

  it("caps \"Worth another look\" where the contract does", () => {
    expect(WORTH_ANOTHER_LOOK_LIMIT).toBe(CONTRACT_LOOK_LIMIT);
  });
});
