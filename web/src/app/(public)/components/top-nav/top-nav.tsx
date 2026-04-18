"use client";

import { Elephant } from "@/assets/brand/elephant";
import { Link } from "@/components/link/link";
import { customColors } from "@/modules/mui/theme/constants";
import {
  Box,
  Button,
  Container,
  Stack,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import NextLink from "next/link";
import { useEffect, useState } from "react";

/**
 * Public-site top navigation.
 *
 * Design notes (PROPOSAL §2, Navigation):
 * - The wordmark slot is a **monogram** (elephant mark) rather than the
 *   Climate Crisis wordmark, because the display face becomes hard to
 *   read below ~28px.
 * - Nav items: Programs · Mentors · Impact · Blog. "Home" is implied by
 *   the wordmark; "Values" collapses into the homepage scroll.
 * - "Sign In" is demoted to a ghost button. The primary CTA is **Apply**
 *   — the site's main conversion goal.
 * - A subtle frosted background appears only after the user scrolls, so
 *   the hero stays unobstructed at the top of the page.
 */

const NAV_ITEMS: Array<{ label: string; href: string }> = [
  { label: "Programs", href: "/dashboard/apply" },
  { label: "Mentors", href: "/#what-we-do" },
  { label: "Impact", href: "/#values" },
  { label: "Blog", href: "/blog" },
];

export function TopNav() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <Box
      component="nav"
      aria-label="Primary"
      sx={{
        position: "sticky",
        top: 0,
        zIndex: 20,
        transition:
          "background-color 240ms ease, backdrop-filter 240ms ease, border-color 240ms ease",
        backgroundColor: scrolled ? "rgba(1, 61, 57, 0.72)" : "transparent",
        backdropFilter: scrolled ? "blur(12px) saturate(140%)" : "none",
        borderBottom: scrolled
          ? `1px solid ${customColors.rule}`
          : "1px solid transparent",
      }}
    >
      <Container maxWidth="lg">
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          sx={{ py: 2 }}
        >
          <NextLink
            href="/"
            aria-label="Tembo Tech Ventures — home"
            style={{ display: "flex" }}
          >
            <Stack direction="row" alignItems="center" spacing={1.25}>
              <Box
                sx={{
                  width: 36,
                  height: 36,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Elephant color={customColors.orange.main} />
              </Box>
              <Box
                aria-hidden
                sx={{
                  fontFamily: theme.typography.fontFamily,
                  fontWeight: 700,
                  letterSpacing: "0.18em",
                  fontSize: 14,
                  color: customColors.ink.primary,
                  display: { xs: "none", sm: "inline-flex" },
                }}
              >
                TTV
              </Box>
            </Stack>
          </NextLink>

          {!isMobile && (
            <Stack
              direction="row"
              spacing={4}
              alignItems="center"
              aria-label="Primary links"
            >
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  muiLinkProps={{
                    underline: "none",
                    sx: {
                      fontSize: 14,
                      fontWeight: 500,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      color: customColors.ink.primary,
                      transition: "color 160ms ease",
                      "&:hover": { color: customColors.orange.main },
                    },
                  }}
                >
                  {item.label}
                </Link>
              ))}
            </Stack>
          )}

          <Stack direction="row" spacing={1.5} alignItems="center">
            <Button
              component={NextLink}
              href="/auth/login"
              variant="text"
              size="small"
              sx={{
                color: customColors.ink.primary,
                fontWeight: 500,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                display: { xs: "none", sm: "inline-flex" },
                "&:hover": {
                  color: customColors.orange.main,
                  background: "transparent",
                },
              }}
            >
              Sign in
            </Button>
            <Button
              component={NextLink}
              href="/dashboard/apply"
              variant="contained"
              size="small"
              sx={{
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: customColors.dark.main,
                px: 2.5,
                py: 1,
                borderRadius: "999px",
                boxShadow: "none",
                "&:hover": { boxShadow: "none", filter: "brightness(1.05)" },
              }}
            >
              Apply
            </Button>
          </Stack>
        </Stack>
      </Container>
    </Box>
  );
}
