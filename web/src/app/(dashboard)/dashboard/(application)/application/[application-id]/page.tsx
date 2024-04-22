import { prisma } from "@/modules/prisma/lib/prisma-client/prisma-client";
import { Container, Typography } from "@mui/material";
import { UpdateApplication } from "./components/update-application/update-application";
import { redirect } from "next/navigation";

export default async function Applications({
  params,
}: {
  params: { "application-id": string };
}) {
  const applicationId = params["application-id"];
  const application = await prisma.programApplication.findUnique({
    where: { id: applicationId },
  });

  if (!application) {
    redirect("/dashboard/apply");
  }

  return (
    <Container>
      <Typography variant="h4" color="white">
        Application
      </Typography>
      <Typography color="white">{application?.createdAt.toString()}</Typography>
      <Typography color="white">{application?.status}</Typography>
      <UpdateApplication application={application} />
    </Container>
  );
}
