/**
 * admin/export/route
 * ------------------
 * Admin-only endpoint that exports all certificate-related data for migration
 * to the new Cloudflare/D1 system. Force-dynamic to avoid build-time DB access.
 */

import { NextResponse } from "next/server";
import { checkAdminPermissions } from "@/modules/roles/lib/check-admin-permissions/check-admin-permissions";
import { prisma } from "@/modules/prisma/lib/prisma-client/prisma-client";

export const dynamic = "force-dynamic";

export async function GET() {
  await checkAdminPermissions();

  const [
    users,
    curricula,
    programs,
    programRoles,
    programPartners,
    programApplications,
    roles,
    userRoles,
  ] = await Promise.all([
    prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        emailVerified: true,
        image: true,
      },
    }),
    prisma.curriculum.findMany({
      select: {
        id: true,
        title: true,
        description: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.program.findMany({
      select: {
        id: true,
        name: true,
        description: true,
        curriculumId: true,
        startDate: true,
        endDate: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.programRole.findMany({
      select: {
        id: true,
        programId: true,
        userId: true,
        name: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.programPartner.findMany({
      select: { id: true, name: true, createdAt: true, updatedAt: true },
    }),
    prisma.programApplication.findMany({
      select: {
        id: true,
        programId: true,
        userId: true,
        partnerId: true,
        status: true,
        application: true,
        completedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.role.findMany({
      select: { id: true, name: true, createdAt: true, updatedAt: true },
    }),
    prisma.userRole.findMany({
      select: {
        id: true,
        userId: true,
        roleId: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
  ]);

  return NextResponse.json({
    exportedAt: new Date().toISOString(),
    version: 1,
    users,
    curricula,
    programs,
    programRoles,
    programPartners,
    programApplications,
    roles,
    userRoles,
  });
}
