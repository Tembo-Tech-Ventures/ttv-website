import { Stack, Typography } from "@mui/material";

export default async function VerifyRequest() {
  console.log("@@ nextauth url: ", process.env.NEXTAUTH_URL);
  return (
    <Stack minHeight="100vh" direction="column" justifyContent="center">
      <Typography variant="h1" color="primary" textAlign="center">
        Email Incoming
      </Typography>
      <Typography textAlign="center">
        Check your email for a link to login.
      </Typography>
    </Stack>
  );
}
