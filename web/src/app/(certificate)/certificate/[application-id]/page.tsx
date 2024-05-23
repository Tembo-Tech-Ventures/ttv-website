import { prisma } from "@/modules/prisma/lib/prisma-client/prisma-client";
import { Typography } from "@mui/material";
import { notFound } from "next/navigation";
import { format } from "date-fns";

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
    },
    include: {
      user: true,
      program: {
        include: {
          curriculum: true,
        },
      },
    },
  });

  if (!application) {
    return notFound();
  }

  return (
    <Typography color="white" component="div">
      <h1>TTV Program Completion Certificate</h1>
      <p>Issued To: {application.user.name}</p>
      <p>Program: {application?.program?.curriculum.title}</p>
      <p>Certificate ID: {application.id}</p>
      {/* <p>{application.completedAt?.toISOString()}</p> */}
      {application.completedAt && (
        <p>
          Certificate Issued At:{" "}
          {format(application.completedAt, "MMMM dd, yyyy")}
        </p>
      )}
      {application?.program?.startDate && application?.program?.endDate && (
        <p>
          Program Duration:
          {format(application?.program?.startDate, "MMMM dd, yyyy")} -{" "}
          {format(application?.program?.endDate, "MMMM dd, yyyy")}
        </p>
      )}
    </Typography>
  );
}
