import { authOptions } from "@/app/api/auth/[...nextauth]/constants";
import { Elephant } from "@/assets/brand/elephant";
import { Card } from "@/components/card/card";
import { Link } from "@/components/link/link";
import { EmailLoginForm } from "@/modules/auth/components/email-login-form/email-login-form";
import { customColors } from "@/modules/mui/theme/constants";
import { Container, Stack, Typography } from "@mui/material";
import Grid from "@mui/material/Grid";
import { type Metadata } from "next";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Sign In",
};

export default async function Login() {
  const session = await getServerSession(authOptions);

  if (session?.user) {
    redirect("/dashboard");
  }

  return (
    <Stack direction="column" minHeight="100vh" justifyContent="center">
      <Container maxWidth="md" sx={{ py: 4 }}>
        <Grid container spacing={4}>
          <Grid
            size={{ xs: 12, md: 4 }}
            sx={{
              display: {
                xs: "none",
                md: "block",
              },
            }}
          >
            <Elephant color={customColors.orange.main} />
          </Grid>
          <Grid size={{ xs: 12, md: 8 }}>
            <Card>
              <Stack spacing={2}>
                <Typography variant="h2" color="primary">
                  Login
                </Typography>
                <Typography>
                  Don’t have an account?{" "}
                  <Link href="/auth/register">Register</Link> for a free trial.
                </Typography>
                <EmailLoginForm />
              </Stack>
            </Card>
          </Grid>
        </Grid>
      </Container>
    </Stack>
  );
}
