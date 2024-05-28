import { checkAdminPermissions } from "@/modules/roles/lib/check-admin-permissions/check-admin-permissions";
import { Box, Container, Grid, Stack, Typography } from "@mui/material";
import { getApplicationPageData } from "./lib/get-application-page-data/get-application-page-data";
import React from "react";
import { Status } from "./components/status/status";

type Application = {
  version: string;
  submission: {
    name: string;
    type: string;
    label: string;
    value: string;
  }[];
};

export default async function Applications({
  params,
}: {
  params: { "application-id": string };
}) {
  await checkAdminPermissions();
  const applicationId = params["application-id"];
  const applicationPageData = await getApplicationPageData(applicationId);
  const application = applicationPageData?.application;
  const applicationDetails = applicationPageData?.application
    ?.application as Application;
  const submission = applicationDetails.submission;
  return (
    <Container>
      <Stack spacing={2}>
        <Typography variant="h4" color="white">
          Application
        </Typography>
        <Status value={application?.status} />
        <Grid spacing={4} container>
          {submission.map((field) => (
            <React.Fragment key={field.name}>
              <Grid xs={6} mb={2}>
                <Typography
                  variant="body2"
                  color="#999"
                  sx={{ wordBreak: "break-word" }}
                >
                  {field.label}
                </Typography>
              </Grid>
              <Grid xs={6} mb={2}>
                <Typography variant="body2" color="white" sx={{ pl: 2 }}>
                  {`${field.value}`}
                </Typography>
              </Grid>
            </React.Fragment>
          ))}
        </Grid>
      </Stack>
    </Container>
  );
}
