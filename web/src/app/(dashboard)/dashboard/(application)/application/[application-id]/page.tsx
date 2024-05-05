import { prisma } from "@/modules/prisma/lib/prisma-client/prisma-client";
import { Container, Typography } from "@mui/material";
import { UpdateApplication } from "./components/update-application/update-application";
import { redirect } from "next/navigation";
import { format } from "date-fns";

export default async function Applications({
  params,
}: {
  params: { "application-id": string };
}) {
  const applicationId = params["application-id"];
  const application = await prisma.programApplication.findUnique({
    where: { id: applicationId },
  });
  const partners = await prisma.programPartner.findMany();

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
      <Typography color="white">{application?.status}</Typography>
      <UpdateApplication application={application} partners={partners} />
    </Container>
  );
}
