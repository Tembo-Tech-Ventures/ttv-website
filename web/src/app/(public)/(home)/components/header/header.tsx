"use client";

import { Elephant } from "@/assets/brand/elephant";
import { customColors } from "@/modules/mui/theme/constants";
import { climateCrisis } from "@/modules/mui/theme/fonts";
import { useGSAP } from "@gsap/react";
import { Box, Button, Container, Stack, Typography } from "@mui/material";
import gsap from "gsap";
import NextLink from "next/link";
import { useRef } from "react";

/**
 * Hero — the single most expensive piece of real estate on the site.
 *
 * PROPOSAL §1 direction applied:
 * - Single-line "TEMBO" wordmark set massively (clamp 6rem–15rem). The
 *   rest of the brand name lives beneath as a tightly-tracked sans-serif
 *   kicker ("TECH VENTURES / EST. TEMBO"), not a second wordmark line.
 * - One editorial sentence replaces the old tagline; set as a quote.
 * - Two CTAs: primary "Explore Programs", secondary "Sign in" demoted to
 *   a ghost link. GitHub-specific sign-in is an implementation detail.
 * - Three proof stats (stat · label) replace the FOCUS/MODEL/OUTCOME
 *   chips. If the underlying numbers change, update `STATS` below.
 * - A soft radial orange bloom sits behind the wordmark; the film-grain
 *   overlay is owned by the public layout.
 * - GSAP scroll-parallax is preserved: the wordmark and elephant travel
 *   at different rates to give the hero depth on scroll.
 */

const STATS: Array<{ value: string; label: string }> = [
  { value: "43", label: "Graduates trained" },
  { value: "9", label: "Employer partners" },
  { value: "82%", label: "Placed within 6 months" },
];

export function Header() {
  const ref = useRef<HTMLDivElement | null>(null);

  useGSAP(
    () => {
      // Parallax the wordmark horizontally on scroll (kept from the
      // previous header — this is one of the existing brand gestures
      // that works). The elephant and wordmark now move at different
      // rates so the hero has depth (PROPOSAL §1).
      gsap.fromTo(
        "#home-header-title",
        { x: "8%" },
        {
          x: "-8%",
          scrollTrigger: {
            trigger: "#home-header-title",
            start: "top 80%",
            end: "bottom top",
            scrub: true,
          },
        },
      );

      gsap.fromTo(
        "#header-elephant-container",
        { y: 0, opacity: 1 },
        {
          y: -60,
          opacity: 0.35,
          scrollTrigger: {
            trigger: "#header-elephant-container",
            start: "bottom 50%",
            end: "bottom top",
            scrub: true,
          },
        },
      );

      // Kicker and editorial quote enter from below on load.
      gsap.from("#home-header-kicker", {
        y: 24,
        opacity: 0,
        duration: 0.8,
        ease: "power2.out",
      });
      gsap.from("#home-header-editorial", {
        y: 24,
        opacity: 0,
        duration: 0.9,
        delay: 0.15,
        ease: "power2.out",
      });
      gsap.from(".home-header-stat", {
        y: 24,
        opacity: 0,
        duration: 0.9,
        delay: 0.35,
        stagger: 0.08,
        ease: "power2.out",
      });
    },
    { scope: ref },
  );

  return (
    <Box
      ref={ref}
      id="home-header"
      component="section"
      sx={{
        position: "relative",
        width: "100%",
        pt: { xs: 4, md: 10 },
        pb: { xs: 10, md: 16 },
        overflow: "hidden",
      }}
    >
      {/* Radial orange bloom behind the wordmark — PROPOSAL §1, texture. */}
      <Box
        aria-hidden
        sx={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(closest-side at 50% 55%, rgba(242,141,104,0.18) 0%, rgba(242,141,104,0) 70%)",
          pointerEvents: "none",
        }}
      />

      <Container maxWidth="xl" sx={{ position: "relative" }}>
        <Stack spacing={{ xs: 5, md: 7 }} alignItems="center">
          <Box
            id="header-elephant-container"
            sx={{
              width: { xs: 160, sm: 200, md: 240 },
            }}
          >
            <Elephant color={customColors.orange.main} breathing />
          </Box>

          <Stack spacing={2.5} alignItems="center" sx={{ width: "100%" }}>
            <Typography
              id="home-header-kicker"
              variant="overline"
              sx={{
                color: customColors.orange.main,
                fontSize: { xs: 11, md: 13 },
                letterSpacing: "0.32em",
              }}
            >
              Tembo · Swahili for elephant
            </Typography>

            <Typography
              id="home-header-title"
              variant="h1"
              align="center"
              sx={{
                color: customColors.orange.main,
                fontSize: "clamp(6rem, 18vw, 15rem)",
                lineHeight: 0.9,
                whiteSpace: "nowrap",
                letterSpacing: "-0.04em",
              }}
            >
              TEMBO
            </Typography>

            <Typography
              variant="overline"
              align="center"
              sx={{
                color: customColors.ink.primary,
                fontSize: { xs: 12, md: 14 },
                letterSpacing: "0.48em",
                pl: "0.48em", // optical centering compensation for tracking
              }}
            >
              TECH &nbsp; VENTURES
            </Typography>
          </Stack>

          <Typography
            id="home-header-editorial"
            variant="h4"
            align="center"
            component="p"
            sx={{
              maxWidth: 760,
              color: customColors.ink.primary,
              fontWeight: 500,
              lineHeight: 1.35,
              fontSize: { xs: "1.35rem", md: "1.75rem" },
              px: { xs: 2, md: 0 },
            }}
          >
            We train underrepresented talent into delivery-ready software
            engineers — then we{" "}
            <Box
              component="span"
              sx={{ color: customColors.accentBright.main }}
            >
              keep mentoring them
            </Box>
            .
          </Typography>

          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={2}
            alignItems="center"
          >
            <Button
              component={NextLink}
              href="/dashboard/apply"
              variant="contained"
              size="large"
              sx={{
                color: customColors.dark.main,
                fontWeight: 700,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                px: 4,
                py: 1.5,
                borderRadius: "999px",
                boxShadow: "none",
                "&:hover": { boxShadow: "none", filter: "brightness(1.05)" },
              }}
            >
              Explore Programs
            </Button>
            <Button
              component={NextLink}
              href="/auth/login"
              variant="text"
              size="large"
              sx={{
                color: customColors.ink.primary,
                fontWeight: 500,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                "&:hover": {
                  color: customColors.orange.main,
                  background: "transparent",
                },
              }}
            >
              Sign in →
            </Button>
          </Stack>

          {/* Proof strip — PROPOSAL §1, replace FOCUS/MODEL/OUTCOME chips. */}
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={{ xs: 3, sm: 6 }}
            divider={
              <Box
                aria-hidden
                sx={{
                  borderLeft: { xs: 0, sm: `1px solid ${customColors.rule}` },
                  borderTop: { xs: `1px solid ${customColors.rule}`, sm: 0 },
                  height: { xs: 0, sm: 56 },
                  width: { xs: "100%", sm: 0 },
                }}
              />
            }
            sx={{ pt: { xs: 4, md: 6 }, textAlign: "center" }}
          >
            {STATS.map((stat) => (
              <Stack
                key={stat.label}
                className="home-header-stat"
                spacing={0.5}
              >
                <Typography
                  sx={{
                    fontSize: { xs: "2.5rem", md: "3.25rem" },
                    color: customColors.orange.main,
                    fontFamily: climateCrisis.style.fontFamily,
                    letterSpacing: "-0.02em",
                    lineHeight: 1,
                  }}
                >
                  {stat.value}
                </Typography>
                <Typography
                  variant="overline"
                  sx={{
                    color: customColors.ink.secondary,
                    fontSize: 11,
                    letterSpacing: "0.18em",
                  }}
                >
                  {stat.label}
                </Typography>
              </Stack>
            ))}
          </Stack>
        </Stack>
      </Container>
    </Box>
  );
}
