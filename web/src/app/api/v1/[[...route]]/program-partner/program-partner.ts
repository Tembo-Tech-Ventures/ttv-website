import { prisma } from "@/modules/prisma/lib/prisma-client/prisma-client";
import { Hono } from "hono";

const handler = new Hono().get("/", async (c) => {
  const partners = await prisma.programPartner.findMany();

  return c.json(partners, 201);
});

export const programPartnerHandler = handler;
