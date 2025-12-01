/** @jest-environment node */

const hasDatabase = !!process.env.DATABASE_URL;

// Skip when no database URL is configured (e.g., local unit runs). Compose test stack sets DATABASE_URL.
const maybeDescribe = hasDatabase ? describe : describe.skip;

maybeDescribe("database smoke test", () => {
  let prisma: Awaited<ReturnType<typeof import("@/modules/prisma/lib/prisma-client/prisma-client")>>["prisma"];

  beforeAll(async () => {
    const clientModule = await import(
      "@/modules/prisma/lib/prisma-client/prisma-client"
    );
    prisma = clientModule.prisma;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("responds to a simple query", async () => {
    const result =
      await prisma.$queryRaw<{ version: string }[]>`SELECT version()`;
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]?.version).toContain("PostgreSQL");
  });
});
