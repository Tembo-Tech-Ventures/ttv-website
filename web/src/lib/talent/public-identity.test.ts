import { describe, expect, it } from "vitest";
import { resolvePublicProfileIdentity } from "./public-identity";

describe("resolvePublicProfileIdentity", () => {
  it("uses only the checked snapshot", () => {
    expect(
      resolvePublicProfileIdentity({
        publicName: "Checked Builder",
        publicAvatarUrl: "/api/avatar/avatars/user-1/checked.webp",
      }),
    ).toEqual({
      name: "Checked Builder",
      image: "/api/avatar/avatars/user-1/checked.webp",
    });
  });

  it("does not fall back to mutable account identity", () => {
    expect(
      resolvePublicProfileIdentity({
        publicName: null,
        publicAvatarUrl: null,
      }),
    ).toEqual({ name: "TTV Builder", image: null });
  });
});
