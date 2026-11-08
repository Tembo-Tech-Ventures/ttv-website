import { describe, expect, it } from "vitest";
import { Me, SPACE_ORDER as CONTRACT_ORDER, SpaceId } from "./contracts";
import { meByPersona } from "./fixtures";
import { inSpaceOrder, isSpaceId, SPACE_ORDER } from "./space-order";

describe("space-order", () => {
  it("is the contract's own list, so SpaceId and the guard can never disagree", () => {
    expect(CONTRACT_ORDER).toBe(SPACE_ORDER);
    expect(SpaceId.options).toEqual([...SPACE_ORDER]);
  });

  it.each([...SPACE_ORDER, "Cohort", "cohort ", "", "admin; Path=/", 1, null, undefined, {}, ["cohort"]])(
    "agrees with the SpaceId schema about %j", (value) => {
      expect(isSpaceId(value)).toBe(SpaceId.safeParse(value).success);
    });

  it.each([
    [[], true], [["cohort"], true], [["cohort", "community", "profile"], true], [[...SPACE_ORDER], true],
    [["community", "cohort"], false], [["cohort", "cohort"], false], [["cohort", "injected"], false], [[1], false],
  ] as const)("takes %j as in order: %s, as Me does", (spaces, expected) => {
    expect(inSpaceOrder(spaces)).toBe(expected);
    const me = { ...meByPersona.lucy, mentoring: undefined, spaces };
    expect(Me.safeParse(me).success).toBe(expected);
  });
});
