// is-admin.test.ts
import { isAdmin } from "./is-admin";
import { ROLES } from "@/modules/roles/constants";

jest.mock("@/modules/auth/lib/get-server-session/get-server-session", () => ({
  getServerSession: jest.fn(),
}));

jest.mock("@/modules/prisma/lib/prisma-client/prisma-client", () => ({
  prisma: {
    userRole: {
      findFirst: jest.fn(),
    },
  },
}));

const { getServerSession } = require("@/modules/auth/lib/get-server-session/get-server-session") as {
  getServerSession: jest.Mock;
};
const { prisma } = require("@/modules/prisma/lib/prisma-client/prisma-client") as {
  prisma: { userRole: { findFirst: jest.Mock } };
};

describe("checkAdminPermissions", () => {
  beforeEach(() => {
    getServerSession.mockReset();
    prisma.userRole.findFirst.mockReset();
  });

  it("should return true if the user has admin role", async () => {
    getServerSession.mockResolvedValue({
      user: { id: "user-id-1" },
    });
    prisma.userRole.findFirst.mockResolvedValue({
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
    getServerSession.mockResolvedValue({
      user: { id: "user-id-2" },
    });
    prisma.userRole.findFirst.mockResolvedValue(null);

    const result = await isAdmin();
    expect(result).toBe(false);
  });
});
