import { describe, expectTypeOf, it } from "vitest";
import { listMembers, readMember, type MemberPage, type MemberProfileView } from "./directory";

describe("member directory UI contract", () => {
  it("exposes paginated cards and nullable profile reads", () => {
    expectTypeOf(listMembers).returns.toEqualTypeOf<Promise<MemberPage>>();
    expectTypeOf(readMember).returns.toEqualTypeOf<Promise<MemberProfileView | null>>();
  });
});
