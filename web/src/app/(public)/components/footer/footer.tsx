"use client";

import { Link } from "@/components/link/link";
import { customColors } from "@/modules/mui/theme/constants";
import { climateCrisis } from "@/modules/mui/theme/fonts";
import { Box, Container, Stack, Typography } from "@mui/material";

/**
 * Public site footer — richer treatment (PROPOSAL §7).
 *
 * The footer is real estate. This iteration adds a one-line mission
 * statement, four link columns (Programs / Company / Read / Connect),
 * and an oversized Climate Crisis wordmark that bleeds off the bottom
 * of the viewport to act as the site's closing signature.
 */

interface LinkGroup {
  heading: string;
  links: Array<{ label: string; href: string }>;
}

const LINK_GROUPS: LinkGroup[] = [
  {
    heading: "Programs",
    links: [
      { label: "Apply", href: "/dashboard/apply" },
      { label: "Curriculum", href: "/dashboard/curriculum" },
      { label: "Mentorship", href: "/#what-we-do" },
    ],
  },
  {
    heading: "Company",
    links: [
      { label: "Why Tembo", href: "/#why-tembo" },
      { label: "Values", href: "/#values" },
      {
        label: "Careers",
        href: "mailto:hello@tembotechventures.com?subject=Careers",
      },
    ],
  },
  {
    heading: "Read",
    links: [
      { label: "Blog", href: "/blog" },
      { label: "RSS", href: "/blog/rss.xml" },
    ],
  },
  {
    heading: "Connect",
    links: [
      { label: "Email", href: "mailto:hello@tembotechventures.com" },
      {
        label: "LinkedIn",
        href: "https://www.linkedin.com/company/tembo-tech-ventures/",
      },
      { label: "Sign in", href: "/auth/login" },
    ],
  },
];

export function Footer() {
  return (
    <Box
      component="footer"
      sx={{
        position: "relative",
        mt: { xs: 10, md: 16 },
        pt: { xs: 10, md: 14 },
        borderTop: `1px solid ${customColors.rule}`,
        overflow: "hidden",
      }}
    >
      <Container maxWidth="xl">
        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={{ xs: 6, md: 10 }}
          alignItems={{ xs: "flex-start", md: "flex-start" }}
          justifyContent="space-between"
        >
          <Stack spacing={3} sx={{ maxWidth: 380 }}>
            <Typography
              variant="overline"
              sx={{ color: customColors.orange.main, letterSpacing: "0.32em" }}
            >
              Tembo Tech Ventures
            </Typography>
            <Typography
              variant="h4"
              component="p"
              sx={{
                color: customColors.ink.primary,
                fontWeight: 500,
                lineHeight: 1.3,
                fontSize: { xs: "1.2rem", md: "1.35rem" },
              }}
            >
              Bridging Africa&apos;s tech ambition and the delivery-ready talent
              the industry still says it can&apos;t find.
            </Typography>
          </Stack>

          <Box
            sx={{
              display: "grid",
              gap: { xs: 4, sm: 6 },
              gridTemplateColumns: {
                xs: "repeat(2, 1fr)",
                sm: "repeat(4, auto)",
              },
            }}
          >
            {LINK_GROUPS.map((group) => (
              <Stack key={group.heading} spacing={2} sx={{ minWidth: 120 }}>
                <Typography
                  variant="overline"
                  sx={{
                    color: customColors.ink.secondary,
                    letterSpacing: "0.24em",
                  }}
                >
                  {group.heading}
                </Typography>
                <Stack spacing={1.25}>
                  {group.links.map((link) => (
                    <Link
                      key={link.href + link.label}
                      href={link.href}
                      muiLinkProps={{
                        underline: "none",
                        sx: {
                          color: customColors.ink.primary,
                          fontSize: 15,
                          transition: "color 160ms ease",
                          "&:hover": { color: customColors.orange.main },
                        },
                      }}
                    >
                      {link.label}
                    </Link>
                  ))}
                </Stack>
              </Stack>
            ))}
          </Box>
        </Stack>

        <Stack
          direction={{ xs: "column", sm: "row" }}
          alignItems={{ sm: "center" }}
          justifyContent="space-between"
          spacing={2}
          sx={{
            mt: { xs: 8, md: 12 },
            pt: 4,
            borderTop: `1px solid ${customColors.rule}`,
          }}
        >
          <Typography
            variant="body2"
            sx={{ color: customColors.ink.secondary }}
          >
            © {new Date().getFullYear()} Tembo Tech Ventures. All rights
            reserved.
          </Typography>
          <Typography variant="body2" sx={{ color: customColors.ink.muted }}>
            Designed and built in-house.
          </Typography>
        </Stack>
      </Container>

      {/* Signature wordmark — bleeds off the page. PROPOSAL §7. */}
      <Box
        aria-hidden
        sx={{
          mt: { xs: 6, md: 10 },
          textAlign: "center",
          lineHeight: 0.85,
          overflow: "hidden",
          userSelect: "none",
        }}
      >
        <Box
          sx={{
            fontFamily: climateCrisis.style.fontFamily,
            color: "transparent",
            WebkitTextStroke: `1px ${customColors.orange.main}`,
            fontSize: "clamp(7rem, 28vw, 24rem)",
            letterSpacing: "-0.04em",
            whiteSpace: "nowrap",
            transform: "translateY(18%)",
          }}
        >
          TEMBO
        </Box>
      </Box>
    </Box>
  );
}
