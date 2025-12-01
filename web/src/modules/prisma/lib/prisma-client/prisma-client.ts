import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

declare const global: {
  prisma?: import("@prisma/client").PrismaClient;
  [key: string]: unknown;
};

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required to initialize Prisma");
}

const adapter = new PrismaPg({ connectionString });

let internalPrisma: PrismaClient;

if (process.env.NODE_ENV === "production") {
  internalPrisma = new PrismaClient({ adapter });
} else {
  if (!global.prisma) {
    global.prisma = new PrismaClient({ adapter });
  }
  internalPrisma = global.prisma as PrismaClient;
}

export const prisma = internalPrisma;
