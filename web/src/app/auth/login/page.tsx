import { authOptions } from "@/app/api/auth/[...nextauth]/constants";
import { Elephant } from "@/assets/brand/elephant";
import { Link } from "@/components/link/link";
import { EmailLoginForm } from "@/modules/auth/components/email-login-form/email-login-form";
import { customColors } from "@/modules/mui/theme/constants";
import { climateCrisis } from "@/modules/mui/theme/fonts";
import { Box, Container, Stack, Typography } from "@mui/material";
import { type Metadata } from "next";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Sign In",
};

/**
 * Login — split-screen layout (PROPOSAL §6).
 *
 * Left column (desktop): brand voice copy + sign-in form.
 * Right column (desktop): editorial panel with a testimonial-style
 * pull quote set against a duotone wash. On mobile the panel collapses
 * to a compact header above the form so the page never feels empty.
 */
export default async function Login() {
  const session = await getServerSession(authOptions);

  if (session?.user) {
    redirect("/dashboard");
  }

  return (
    <Container maxWidth="lg" sx={{ minHeight: "100vh", py: { xs: 4, md: 8 } }}>
      <Box
        sx={{
          display: "grid",
          gap: { xs: 4, md: 6 },
          gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
          alignItems: "center",
          minHeight: { md: "85vh" },
        }}
      >
        <Stack spacing={4} sx={{ maxWidth: 480 }}>
          <Stack direction="row" spacing={2} alignItems="center">
            <Box sx={{ width: 56 }}>
              <Elephant color={customColors.orange.main} />
            </Box>
            <Typography
              variant="overline"
              sx={{
                color: customColors.orange.main,
                letterSpacing: "0.32em",
              }}
            >
              Tembo · Welcome back
            </Typography>
          </Stack>

          <Typography
            sx={{
              fontFamily: climateCrisis.style.fontFamily,
              fontSize: { xs: "2.5rem", md: "3.5rem" },
              color: customColors.ink.primary,
              lineHeight: 1,
              letterSpacing: "-0.02em",
            }}
          >
            Pick up where
            <br />
            you left off.
          </Typography>

          <Typography
            variant="body1"
            sx={{ color: customColors.ink.secondary }}
          >
            We&apos;ll email you a magic link. No passwords, no fuss.
          </Typography>

          <EmailLoginForm />

          <Typography
            variant="body2"
            sx={{ color: customColors.ink.secondary }}
          >
            New here? <Link href="/auth/register">Apply to join a cohort</Link>.
          </Typography>
        </Stack>

        <Box
          sx={{
            display: { xs: "none", md: "block" },
            position: "relative",
            borderRadius: 3,
            overflow: "hidden",
            border: `1px solid ${customColors.rule}`,
            bgcolor: customColors.bgRaised.main,
            aspectRatio: "4 / 5",
          }}
        >
          {/* Duotone wash behind the editorial quote. */}
          <Box
            aria-hidden
            sx={{
              position: "absolute",
              inset: 0,
              background: `radial-gradient(closest-side at 30% 20%, rgba(242,141,104,0.28), transparent 70%), linear-gradient(160deg, rgba(242,141,104,0.08), rgba(1,61,57,0.6))`,
            }}
          />
          <Box
            aria-hidden
            sx={{
              position: "absolute",
              bottom: -40,
              right: -40,
              width: "70%",
              opacity: 0.4,
            }}
          >
            <Elephant color={customColors.orange.main} />
          </Box>
          <Stack
            spacing={3}
            sx={{
              position: "absolute",
              inset: 0,
              p: 6,
              justifyContent: "space-between",
            }}
          >
            <Typography
              variant="overline"
              sx={{ color: customColors.orange.main, letterSpacing: "0.32em" }}
            >
              From the cohort
            </Typography>
            <Typography
              component="blockquote"
              sx={{
                fontFamily: climateCrisis.style.fontFamily,
                fontSize: "2rem",
                color: customColors.ink.primary,
                lineHeight: 1.1,
                letterSpacing: "-0.01em",
                m: 0,
              }}
            >
              &ldquo;Tembo is the first program that treated my portfolio like
              proof, not potential.&rdquo;
            </Typography>
            <Typography
              variant="body2"
              sx={{ color: customColors.ink.secondary }}
            >
              — Cohort graduate, now shipping at a Lagos fintech
            </Typography>
          </Stack>
        </Box>
      </Box>
    </Container>
  );
}
