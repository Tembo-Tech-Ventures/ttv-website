import { prisma } from "@/modules/prisma/lib/prisma-client/prisma-client";
import { Chip, Container, Typography } from "@mui/material";
import { format } from "date-fns";
import { redirect } from "next/navigation";
import { UpdateApplication } from "./components/update-application/update-application";
import { getServerSession } from "@/modules/auth/lib/get-server-session/get-server-session";

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
      <Typography variant="h4" color="white">
        Application
      </Typography>
      <Typography color="white" variant="subtitle2">
        {format(new Date(application?.createdAt.toString() || ""), "PPpp")}
      </Typography>
      <Typography color="white" variant="body2">
        Status: <Chip label={application?.status} color="secondary" />
      </Typography>
      <UpdateApplication
        application={application}
        partners={partners}
        user={user!}
      />
    </Container>
  );
}
