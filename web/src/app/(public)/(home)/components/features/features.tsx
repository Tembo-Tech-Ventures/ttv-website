"use client";

import { customColors, getShadow } from "@/modules/mui/theme/constants";
import { climateCrisis } from "@/modules/mui/theme/fonts";
import { useGSAP } from "@gsap/react";
import { Box, Container, Stack, Typography } from "@mui/material";
import gsap from "gsap";
import { ReactNode, useRef } from "react";

/**
 * "What We Do" — bento layout (PROPOSAL §4).
 *
 * One wide "hero" card (Training, our main program) and two smaller
 * cards stacked (Mentorship, Impact). Asymmetry communicates priority.
 *
 * Icons are inline monoline SVGs (mortarboard / two-heads / elephant
 * silhouette) in orange, not emoji. Each card carries its section
 * numeral set in Climate Crisis at a display size so that the chunky
 * face is used where it reads well (PROPOSAL §A).
 */

function BentoCard({
  numeral,
  label,
  title,
  body,
  icon,
  variant = "compact",
}: {
  numeral: string;
  label: string;
  title: string;
  body: string;
  icon: ReactNode;
  variant?: "wide" | "compact";
}) {
  return (
    <Box
      component="article"
      sx={{
        position: "relative",
        height: "100%",
        borderRadius: 3,
        p: { xs: 3, md: 4 },
        bgcolor: customColors.bgRaised.main,
        border: `1px solid ${customColors.rule}`,
        boxShadow: getShadow("sm"),
        overflow: "hidden",
        transition:
          "transform 240ms ease, box-shadow 240ms ease, border-color 240ms ease",
        "&:hover": {
          transform: "translateY(-4px)",
          boxShadow: getShadow("lg"),
          borderColor: `rgba(242,141,104,0.38)`,
        },
      }}
    >
      <Stack
        direction={{ xs: "column", md: variant === "wide" ? "row" : "column" }}
        spacing={{ xs: 3, md: variant === "wide" ? 5 : 3 }}
        alignItems={{
          xs: "flex-start",
          md: variant === "wide" ? "center" : "flex-start",
        }}
        sx={{ height: "100%" }}
      >
        <Box
          sx={{
            flex: variant === "wide" ? "0 0 auto" : undefined,
            minWidth: variant === "wide" ? { md: 200 } : undefined,
          }}
        >
          <Typography
            sx={{
              fontFamily: climateCrisis.style.fontFamily,
              fontSize: {
                xs: "4rem",
                md: variant === "wide" ? "7rem" : "4.5rem",
              },
              lineHeight: 1,
              color: customColors.orange.main,
              letterSpacing: "-0.04em",
            }}
            component="span"
          >
            {numeral}
          </Typography>
          <Typography
            variant="overline"
            sx={{
              color: customColors.ink.secondary,
              display: "block",
              mt: 1,
              letterSpacing: "0.24em",
            }}
          >
            {label}
          </Typography>
        </Box>
        <Stack spacing={2} sx={{ flex: "1 1 auto" }}>
          <Stack direction="row" spacing={2} alignItems="center">
            <Box
              sx={{
                width: 40,
                height: 40,
                color: customColors.orange.main,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {icon}
            </Box>
            <Typography
              variant="h4"
              sx={{
                color: customColors.ink.primary,
                fontSize: { xs: "1.35rem", md: "1.75rem" },
              }}
            >
              {title}
            </Typography>
          </Stack>
          <Typography
            variant="body1"
            sx={{
              color: customColors.ink.secondary,
              lineHeight: 1.6,
              fontSize: {
                xs: "1rem",
                md: variant === "wide" ? "1.125rem" : "1rem",
              },
            }}
          >
            {body}
          </Typography>
        </Stack>
      </Stack>
    </Box>
  );
}

const MortarboardIcon = (
  <svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden>
    <path
      d="M4 15 L20 8 L36 15 L20 22 Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
    <path
      d="M10 18 V26 C10 28 14.5 30 20 30 C25.5 30 30 28 30 26 V18"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
    <path
      d="M36 15 V24"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
    <circle cx="36" cy="26" r="1.5" fill="currentColor" />
  </svg>
);

const TwoHeadsIcon = (
  <svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden>
    <circle cx="14" cy="15" r="4" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="26" cy="15" r="4" stroke="currentColor" strokeWidth="1.5" />
    <path
      d="M6 30 C6 25 9.5 22 14 22 C18.5 22 22 25 22 30"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
    <path
      d="M18 30 C18 25 21.5 22 26 22 C30.5 22 34 25 34 30"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  </svg>
);

const ElephantIcon = (
  <svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden>
    <path
      d="M8 20 C8 14 13 10 20 10 C27 10 31 14 31 20 C31 22 31 24 30 26 L32 30 L28 30 L27 27 C25 28 22 29 20 29 L19 33 L16 33 L16 29 C12 28 8 26 8 20 Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
    <path
      d="M26 20 C27 22 27 24 26 26 C25 27 23 27 22 26"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
    <circle cx="13" cy="17" r="1" fill="currentColor" />
  </svg>
);

export function Features() {
  const ref = useRef<HTMLDivElement | null>(null);

  useGSAP(
    () => {
      if (typeof window === "undefined") return;
      const prefersReducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      if (prefersReducedMotion) return;

      gsap.utils.toArray<HTMLElement>(".bento-card").forEach((card, i) => {
        gsap.fromTo(
          card,
          { y: 30, opacity: 0 },
          {
            y: 0,
            opacity: 1,
            duration: 0.8,
            delay: i * 0.08,
            ease: "power2.out",
            scrollTrigger: {
              trigger: card,
              start: "top 85%",
              toggleActions: "play none none reverse",
            },
          },
        );
      });
    },
    { scope: ref },
  );

  return (
    <Box
      ref={ref}
      component="section"
      id="what-we-do"
      sx={{
        py: { xs: 10, md: 14 },
        borderTop: `1px solid ${customColors.rule}`,
      }}
    >
      <Container maxWidth="xl">
        <Stack
          direction={{ xs: "column", md: "row" }}
          alignItems={{ xs: "flex-start", md: "baseline" }}
          spacing={{ xs: 2, md: 8 }}
          sx={{ mb: { xs: 6, md: 8 } }}
        >
          <Typography
            variant="overline"
            sx={{
              color: customColors.orange.main,
              letterSpacing: "0.32em",
              fontSize: { xs: 12, md: 14 },
            }}
          >
            § 01 &nbsp; What we do
          </Typography>
          <Typography
            variant="h2"
            sx={{
              fontSize: { xs: "2.5rem", md: "4rem" },
              color: customColors.ink.primary,
              lineHeight: 1,
              letterSpacing: "-0.02em",
            }}
          >
            Three things, done well.
          </Typography>
        </Stack>

        <Box
          sx={{
            display: "grid",
            gap: { xs: 3, md: 4 },
            gridTemplateColumns: { xs: "1fr", md: "1.6fr 1fr" },
            gridAutoRows: { xs: "auto", md: "1fr" },
          }}
        >
          <Box className="bento-card" sx={{ gridRow: { md: "1 / span 2" } }}>
            <BentoCard
              numeral="01"
              label="Training"
              title="Delivery-ready engineers, not graduates."
              body="We work with ambitious developers across Africa and teach the skills you actually ship with — TypeScript, tooling, testing, code review, and reading production code. Our cohorts exit with portfolios, not just transcripts."
              icon={MortarboardIcon}
              variant="wide"
            />
          </Box>
          <Box className="bento-card">
            <BentoCard
              numeral="02"
              label="Mentorship"
              title="Paid mentors, matched for the long haul."
              body="Every learner gets a mentor who is working in industry and compensated for their time. No volunteer fatigue, no drop-off."
              icon={TwoHeadsIcon}
            />
          </Box>
          <Box className="bento-card">
            <BentoCard
              numeral="03"
              label="Impact"
              title="Placement is the product."
              body="We measure ourselves by where graduates land, not applications received. We work with employer partners who want to hire, not test."
              icon={ElephantIcon}
            />
          </Box>
        </Box>
      </Container>
    </Box>
  );
}
