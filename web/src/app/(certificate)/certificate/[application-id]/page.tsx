import { prisma } from "@/modules/prisma/lib/prisma-client/prisma-client";
import { Box, Stack, Typography } from "@mui/material";
import { notFound } from "next/navigation";
import { format } from "date-fns";
import { Elephant } from "@/assets/brand/elephant";
import { customColors } from "@/modules/mui/theme/constants";
import dayjs from "dayjs";
import { ApplicationStatus } from "@prisma/client";

/**
 * The certificate page needs to display:
 *  - The student name
 *  - The curriculum name
 *  - The certificate number
 *  - The date of issue
 *  - The program duration (start / end dates)
 */
export default async function CertificatePage({
  params,
}: {
  params: { "application-id": string };
}) {
  const applicationId = params["application-id"];
  console.log(applicationId);
  const application = await prisma.programApplication.findUnique({
    where: {
      id: applicationId,
      status: ApplicationStatus.COMPLETED,
      completedAt: {
        not: null,
      },
    },
    include: {
      user: true,
      program: {
        include: {
          curriculum: true,
          programRoles: {
            where: {
              name: "INSTRUCTOR",
            },
            include: {
              user: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!application) {
    return notFound();
  }

  const instructorName = application.program?.programRoles?.[0]?.user?.name;

  return (
    <Stack
      direction="column"
      alignItems="center"
      justifyContent="center"
      spacing={4}
      p={2}
      minHeight="100vh"
    >
      <Box maxWidth="150px">
        <Elephant color={customColors.orange.main} />
      </Box>
      <Typography
        variant="h1"
        color="primary"
        sx={{ fontSize: 35 }}
        align="center"
      >
        TTV Program Completion Certificate
      </Typography>
      <Stack direction="column" spacing={1}>
        <Typography color="white" align="center">
          Issued To: <b>{application.user.name}</b>
        </Typography>
        <Typography color="white" align="center">
          Program: <b>{application?.program?.curriculum.title}</b>
        </Typography>
        <Typography color="white" align="center">
          Certificate ID: <b>{application.id}</b>
        </Typography>
        <Typography color="white" align="center">
          Issued At:{" "}
          <b>{dayjs(application.completedAt).format("MMMM DD, YYYY")}</b>
        </Typography>
        {instructorName && (
          <Typography color="white" align="center">
            Instructor: <b>{instructorName}</b>
          </Typography>
        )}
      </Stack>
    </Stack>
  );
}
