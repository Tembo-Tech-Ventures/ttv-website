import { getServerSession } from "@/modules/auth/lib/get-server-session/get-server-session";
import { prisma } from "@/modules/prisma/lib/prisma-client/prisma-client";
import { Container, Typography } from "@mui/material";
import { redirect } from "next/navigation";

export default async function Dashboard() {
  const userId = (await getServerSession())?.user?.id;
  if (!userId) {
    return redirect("/login");
  }

  const applications = await prisma.programApplication.findMany({
    where: { userId },
  });

  if (applications.length === 0) {
    return redirect("/dashboard/apply");
  }

  return (
    <Container>
      <Typography variant="h4" color="white">
        Dashboard
      </Typography>
    </Container>
  );
}
