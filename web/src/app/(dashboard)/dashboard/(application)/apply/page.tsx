import { getServerSession } from "@/modules/auth/lib/get-server-session/get-server-session";
import Apply from "./components/apply/apply";
import { prisma } from "@/modules/prisma/lib/prisma-client/prisma-client";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ApplyPage() {
  const userId = (await getServerSession())?.user?.id;
  const existingApplication = await prisma.programApplication.findFirst({
    where: {
      userId,
    },
  });
  const partners = await prisma.programPartner.findMany();

  if (existingApplication) {
    return redirect(`/dashboard/application/${existingApplication.id}`);
  }

  return <Apply partners={partners} />;
}
