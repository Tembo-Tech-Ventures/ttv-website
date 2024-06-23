import { prisma } from "@/modules/prisma/lib/prisma-client/prisma-client";
import { Box, Button, Chip, Container, Stack, Typography } from "@mui/material";
import { format } from "date-fns";
import { redirect } from "next/navigation";
import { UpdateApplication } from "./components/update-application/update-application";
import { getServerSession } from "@/modules/auth/lib/get-server-session/get-server-session";
import { Card } from "@/components/card/card";
import { ApplicationStatus } from "@prisma/client";

export default async function Applications({
  params,
}: {
  params: { "application-id": string };
}) {
  const session = await getServerSession();
  const userId = session?.user?.id;

  if (!userId) {
    redirect("/login");
  }

  const applicationId = params["application-id"];
  const application = await prisma.programApplication.findUnique({
    where: {
      id: applicationId,
      userId,
    },
  });
  const partners = await prisma.programPartner.findMany();
  const user = await prisma.user.findUnique({
    where: { id: application?.userId },
  });

  if (!application) {
    redirect("/dashboard/apply");
  }

  return (
    <Container>
      <Stack spacing={2}>
        <Typography variant="h4" color="white">
          Application
        </Typography>
        <Typography color="white" variant="subtitle2">
          Originally submitted:{" "}
          {format(new Date(application?.createdAt.toString() || ""), "PPpp")}
        </Typography>
        <Typography color="white" variant="body2">
          Your application status:
          <Chip label={application?.status} color="secondary" />
        </Typography>
        {application?.status === ApplicationStatus.COMPLETED &&
          application?.completedAt && (
            <Box>
              <Button
                href={`/certificate/${applicationId}`}
                target="_blank"
                variant="contained"
              >
                View Certificate
              </Button>
            </Box>
          )}
        {application?.status === ApplicationStatus.PENDING && (
          <>
            <Card>
              <Typography color="white" variant="body2">
                Feel free to update your application below while it is pending.
              </Typography>
            </Card>
            <UpdateApplication
              application={application}
              partners={partners}
              user={user!}
            />
          </>
        )}
      </Stack>
    </Container>
  );
}
