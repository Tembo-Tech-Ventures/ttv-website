import { describe, expect, it } from "vitest";
import { MASKED_CONTACT as CONTRACT_MASKED_CONTACT, ReactionKind } from "@/lib/platform/contracts";
import { MASKED_CONTACT } from "./masked-contact";
import { REACTION_KINDS } from "./MessageMenu";

/*
 * The islands keep their own copies of two contract constants, so they need not carry the contract's
 * zod schemas for a string and a list. These hold the copies to the contract.
 */
describe("the contract's constants, as the channel islands read them", () => {
  it("masks contact details with the server's own marker", () => {
    expect(MASKED_CONTACT).toBe(CONTRACT_MASKED_CONTACT);
  });

  it("offers the contract's reactions, in its order", () => {
    expect(REACTION_KINDS).toEqual(ReactionKind.options);
  });
});
