import { describe, expect, it } from "vitest";
import { meByPersona } from "@/lib/platform/fixtures";
import { canRenderSpace } from "./access";

describe("canRenderSpace", () => {
  it("opens only the spaces the person's roles open", () => {
    expect(canRenderSpace(meByPersona.lucy, "community")).toBe(true);
    expect(canRenderSpace(meByPersona.lucy, "profile")).toBe(true);
    expect(canRenderSpace(meByPersona.lucy, "cohort")).toBe(false);
    expect(canRenderSpace(meByPersona.lucy, "admin")).toBe(false);
  });

  it("renders nothing while the spaces flag is off, whatever the roles", () => {
    const off = { ...meByPersona.amina, flags: { ...meByPersona.amina.flags, spaces: false } };
    for (const space of meByPersona.amina.spaces) expect(canRenderSpace(off, space)).toBe(false);
  });

  it("renders nothing without a person", () => {
    expect(canRenderSpace(null, "profile")).toBe(false);
    expect(canRenderSpace(undefined, "profile")).toBe(false);
  });
});
