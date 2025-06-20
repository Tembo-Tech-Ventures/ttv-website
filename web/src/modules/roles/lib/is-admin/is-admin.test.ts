// is-admin.test.ts
import { isAdmin } from "./is-admin";
import { getServerSession } from "@/modules/auth/lib/get-server-session/get-server-session";
import { prisma } from "@/modules/prisma/lib/prisma-client/prisma-client";
import { ROLES } from "@/modules/roles/constants";

// Mock the dependencies
jest.mock("@/modules/auth/lib/get-server-session/get-server-session");
jest.mock("@/modules/prisma/lib/prisma-client/prisma-client", () => ({
  prisma: { userRole: { findFirst: jest.fn() } },
}));
// Mock auth adapter to avoid importing ESM modules during tests
jest.mock("@auth/prisma-adapter", () => ({ PrismaAdapter: () => ({}) }), {
  virtual: true,
});
jest.mock("next-auth", () => ({ getServerSession: jest.fn() }));
jest.mock("next-auth/providers/email", () => ({
  default: jest.fn(() => ({})),
}));
jest.mock("@/app/api/auth/[...nextauth]/constants", () => ({
  authOptions: {},
}));

describe("checkAdminPermissions", () => {
  it("should return true if the user has admin role", async () => {
    // Mock session and prisma response
    (getServerSession as jest.Mock).mockResolvedValue({
      user: { id: "user-id-1" },
    });
    (
      prisma.userRole.findFirst as jest.Mock<
        ReturnType<typeof prisma.userRole.findFirst>
      >
    ).mockResolvedValue({
      id: "id",
      userId: "userId",
      roleId: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await isAdmin();
    expect(result).toBe(true);
  });

  it("should return false if the user does not have admin role", async () => {
    // Mock session and prisma response
    (getServerSession as jest.Mock).mockResolvedValue({
      user: { id: "user-id-2" },
    });
    (prisma.userRole.findFirst as jest.Mock).mockResolvedValue(null);

    const result = await isAdmin();
    expect(result).toBe(false);
  });
});
