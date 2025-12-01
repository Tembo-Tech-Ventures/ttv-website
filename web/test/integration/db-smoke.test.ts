import { prisma } from "@/modules/prisma/lib/prisma-client/prisma-client";

const hasDatabase = !!process.env.POSTGRES_PRISMA_URL;

// Skip when no database URL is configured (e.g., local unit runs). Compose test stack sets POSTGRES_PRISMA_URL.
const maybeDescribe = hasDatabase ? describe : describe.skip;

maybeDescribe("database smoke test", () => {
  it("responds to a simple query", async () => {
    const result =
      await prisma.$queryRaw<{ version: string }[]>`SELECT version()`;
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]?.version).toContain("PostgreSQL");
  });
});
