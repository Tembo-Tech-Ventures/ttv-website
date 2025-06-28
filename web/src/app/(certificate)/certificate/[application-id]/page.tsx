import { prisma } from "@/modules/prisma/lib/prisma-client/prisma-client";
import { Box, Container, Divider, Stack, Typography } from "@mui/material";
import { notFound } from "next/navigation";
import { format } from "date-fns";
import { Elephant } from "@/assets/brand/elephant";
import { customColors } from "@/modules/mui/theme/constants";
import dayjs from "dayjs";
import { ApplicationStatus } from "@prisma/client";
import { Card } from "@/components/card/card";

interface PageProps<P extends Record<string, string>> {
  params: P;
}

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
}: PageProps<{ "application-id": string }>) {
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
    <Container
      sx={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        py: 4,
      }}
    >
      <Card width="100%">
        <Stack
          direction="column"
          alignItems="center"
          justifyContent="center"
          spacing={4}
          p={2}
          width="100%"
        >
          <Stack
            justifyContent="center"
            alignItems="center"
            sx={{
              width: "100%",
              flexDirection: { xs: "column", sm: "row" },
              alignItems: "center",
              columnGap: 4,
            }}
          >
            <Box maxWidth="100px">
              <Elephant color={customColors.orange.main} />
            </Box>
            <Typography
              variant="h1"
              color="primary"
              sx={{
                marginTop: {
                  xs: "inherit",
                  sm: "0px !important",
                },
                fontSize: {
                  xs: "1.5rem",
                  sm: "1.8rem",
                  md: "1.8rem",
                  lg: "2rem",
                },
                textAlign: {
                  xs: "center",
                  sm: "left",
                },
              }}
            >
              Tembo Tech Ventures
              <br />
              Certificate of Completion
            </Typography>
          </Stack>
          <Stack direction="column" spacing={1}>
            <Typography color="white" align="center">
              This is to certify that
            </Typography>
            <Typography
              component="h1"
              color="white"
              align="center"
              sx={{
                fontSize: {
                  xs: "1.5rem",
                  sm: "2rem",
                  md: "2.5rem",
                  lg: "3rem",
                },
                fontWeight: "bold",
              }}
            >
              {application.user.name}
            </Typography>
            <Typography color="white" align="center">
              has successfully completed the{" "}
              <b>{application?.program?.curriculum.title}</b> program
            </Typography>
          </Stack>
          <Divider flexItem />
          <Stack
            spacing={4}
            width="100%"
            sx={{
              flexDirection: { xs: "column", sm: "row" },
              justifyContent: "space-between",
            }}
          >
            <Stack direction="column" spacing={1}>
              <Typography color="white">
                Certificate ID: <b>{application.id}</b>
              </Typography>
              <Typography color="white">
                Issued At:{" "}
                <b>{dayjs(application.completedAt).format("MMMM DD, YYYY")}</b>
              </Typography>
            </Stack>
            <Stack direction="column" spacing={1}>
              {instructorName && (
                <Typography color="white">
                  Instructor: <b>{instructorName}</b>
                </Typography>
              )}
            </Stack>
          </Stack>
        </Stack>
      </Card>
    </Container>
  );
}
