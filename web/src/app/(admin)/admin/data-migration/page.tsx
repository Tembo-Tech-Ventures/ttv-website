import { Stack, Typography } from "@mui/material";
import { checkAdminPermissions } from "@/modules/roles/lib/check-admin-permissions/check-admin-permissions";
import { prisma } from "@/modules/prisma/lib/prisma-client/prisma-client";
import DataMigration from "./components/data-migration/data-migration";

export default async function DataMigrationPage() {
  await checkAdminPermissions();

  const [
    userCount,
    curriculumCount,
    programCount,
    programRoleCount,
    programPartnerCount,
    applicationCount,
    roleCount,
    userRoleCount,
    blogPostCount,
    fileCount,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.curriculum.count(),
    prisma.program.count(),
    prisma.programRole.count(),
    prisma.programPartner.count(),
    prisma.programApplication.count(),
    prisma.role.count(),
    prisma.userRole.count(),
    prisma.blogPost.count(),
    prisma.file.count(),
  ]);

  const counts = {
    users: userCount,
    curricula: curriculumCount,
    programs: programCount,
    programRoles: programRoleCount,
    programPartners: programPartnerCount,
    programApplications: applicationCount,
    roles: roleCount,
    userRoles: userRoleCount,
    blogPosts: blogPostCount,
    files: fileCount,
  };

  return (
    <Stack spacing={2}>
      <Typography variant="h4" color="white">
        Data Migration
      </Typography>
      <DataMigration counts={counts} />
    </Stack>
  );
}
