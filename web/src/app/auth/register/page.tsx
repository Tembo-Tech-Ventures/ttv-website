import { authOptions } from "@/app/api/auth/[...nextauth]/constants";
import { Elephant } from "@/assets/brand/elephant";
import { Card } from "@/components/card/card";
import { Link } from "@/components/link/link";
import { EmailLoginForm } from "@/modules/auth/components/email-login-form/email-login-form";
import { customColors } from "@/modules/mui/theme/constants";
import { Container, Grid, Stack, Typography } from "@mui/material";
import { type Metadata } from "next";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Register",
};

export default async function Register() {
  const session = await getServerSession(authOptions);

  if (session?.user) {
    redirect("/dashboard");
  }

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Grid container spacing={4}>
        <Grid
          item
          xs={12}
          md={4}
          sx={{
            display: {
              xs: "none",
              md: "block",
            },
          }}
        >
          <Elephant color={customColors.orange.main} />
        </Grid>
        <Grid item xs={12} md={8}>
          <Card>
            <Stack spacing={2}>
              <Typography variant="h2" color="primary">
                Register
              </Typography>
              <Typography>
                Already have an account? <Link href="/auth/login">Login</Link>{" "}
                here.
              </Typography>
              <EmailLoginForm />
            </Stack>
          </Card>
        </Grid>
      </Grid>
    </Container>
  );
}
