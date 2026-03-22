import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

declare const global: {
  prisma?: PrismaClient;
  [key: string]: unknown;
};

function createPrismaClient(): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: process.env.POSTGRES_PRISMA_URL!,
  });
  return new PrismaClient({ adapter });
}

let internalPrisma: PrismaClient;

if (process.env.NODE_ENV === "production") {
  internalPrisma = createPrismaClient();
} else {
  if (!global.prisma) {
    global.prisma = createPrismaClient();
  }
  internalPrisma = global.prisma;
}

export const prisma = internalPrisma;
