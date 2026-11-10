import { describe, expect, it, vi } from "vitest";
import type { SpacePageContext } from "@/components/platform/spaces/space-page";
import { isUnlistedStaff } from "./staff";

const context = (caps: { isMentor: boolean; isAdmin: boolean }) => ({ me: { capabilities: caps } }) as unknown as SpacePageContext;
const d1 = (row: unknown) => {
  const first = vi.fn(async () => row);
  const bind = vi.fn(() => ({ first }));
  return { db: { prepare: vi.fn(() => ({ bind })) } as unknown as D1Database, bind };
};

describe("isUnlistedStaff", () => {
  it("reads the space context's capabilities when there is one, without a query", async () => {
    const { db } = d1(null);
    expect(await isUnlistedStaff(context({ isMentor: true, isAdmin: false }), db, "u")).toBe(true);
    expect(await isUnlistedStaff(context({ isMentor: false, isAdmin: true }), db, "u")).toBe(true);
    expect(await isUnlistedStaff(context({ isMentor: false, isAdmin: false }), db, "u")).toBe(false);
    expect(db.prepare).not.toHaveBeenCalled();
  });

  it("reads the caller's MENTOR and ADMIN roles without one, so a mentor is never missed", async () => {
    const mentor = d1({ 1: 1 });
    expect(await isUnlistedStaff(null, mentor.db, "mentor-1")).toBe(true);
    expect(mentor.bind).toHaveBeenCalledWith("mentor-1");
    expect(vi.mocked(mentor.db.prepare).mock.calls[0]?.[0]).toMatch(/'MENTOR','ADMIN'/);
    expect(await isUnlistedStaff(null, d1(null).db, "member-1")).toBe(false);
  });
});
