"use client";

import { customColors } from "@/modules/mui/theme/constants";
import { useGSAP } from "@gsap/react";
import { Box, Container, Stack, Typography } from "@mui/material";
import gsap from "gsap";
import { useRef } from "react";

/**
 * "Our Values" — kinetic stacked-word poster (PROPOSAL §5).
 *
 * Instead of five same-sized numbered rows, each value is a
 * screen-wide word set in Climate Crisis at ~clamp(4rem, 14vw, 12rem),
 * paired with a **named commitment** (short, declarative, specific)
 * rather than an abstract noun. Each word rises in from below on
 * scroll, respecting `prefers-reduced-motion`.
 */

const VALUES: Array<{ word: string; commitment: string }> = [
  {
    word: "EMPOWERMENT",
    commitment: "We pay mentors. Their time is not volunteer fuel.",
  },
  {
    word: "IMPACT",
    commitment: "We measure placement, not applications received.",
  },
  {
    word: "EQUITY",
    commitment: "We accept people without degrees, with proof of work.",
  },
  {
    word: "COMMUNITY",
    commitment: "We don't lock learners behind income-share agreements.",
  },
  {
    word: "INNOVATION",
    commitment: "We ship the curriculum we'd want as a first job.",
  },
];

export function OurValues() {
  const ref = useRef<HTMLDivElement | null>(null);

  useGSAP(
    () => {
      if (typeof window === "undefined") return;
      const prefersReducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      if (prefersReducedMotion) return;

      gsap.utils.toArray<HTMLElement>(".value-row").forEach((row) => {
        const word = row.querySelector(".value-word");
        const commitment = row.querySelector(".value-commitment");
        if (!word || !commitment) return;

        gsap.fromTo(
          word,
          { yPercent: 40, opacity: 0 },
          {
            yPercent: 0,
            opacity: 1,
            ease: "power3.out",
            duration: 0.9,
            scrollTrigger: {
              trigger: row,
              start: "top 80%",
              end: "top 30%",
              toggleActions: "play none none reverse",
            },
          },
        );
        gsap.fromTo(
          commitment,
          { y: 20, opacity: 0 },
          {
            y: 0,
            opacity: 1,
            ease: "power2.out",
            duration: 0.8,
            delay: 0.1,
            scrollTrigger: {
              trigger: row,
              start: "top 80%",
              end: "top 30%",
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
      id="values"
      sx={{
        position: "relative",
        width: "100%",
        py: { xs: 10, md: 16 },
        borderTop: `1px solid ${customColors.rule}`,
      }}
    >
      <Container maxWidth="xl">
        <Stack
          direction={{ xs: "column", md: "row" }}
          alignItems={{ xs: "flex-start", md: "baseline" }}
          spacing={{ xs: 2, md: 8 }}
          sx={{ mb: { xs: 6, md: 10 } }}
        >
          <Typography
            variant="overline"
            sx={{
              color: customColors.orange.main,
              letterSpacing: "0.32em",
              fontSize: { xs: 12, md: 14 },
            }}
          >
            § 02 &nbsp; Our values
          </Typography>
          <Typography
            variant="h4"
            component="p"
            sx={{
              color: customColors.ink.secondary,
              fontWeight: 500,
              maxWidth: 540,
            }}
          >
            Five commitments — not abstract nouns. Read them as promises to the
            people we train, mentor, and ship alongside.
          </Typography>
        </Stack>

        <Stack spacing={{ xs: 4, md: 2 }}>
          {VALUES.map((value) => (
            <Box
              key={value.word}
              className="value-row"
              sx={{
                py: { xs: 2, md: 3 },
                borderBottom: `1px solid ${customColors.rule}`,
                overflow: "hidden",
              }}
            >
              <Stack
                direction={{ xs: "column", md: "row" }}
                alignItems={{ xs: "flex-start", md: "baseline" }}
                spacing={{ xs: 2, md: 6 }}
              >
                <Typography
                  className="value-word"
                  variant="h1"
                  sx={{
                    flex: "1 1 auto",
                    fontSize: "clamp(3.5rem, 14vw, 12rem)",
                    lineHeight: 0.92,
                    color: customColors.ink.primary,
                    letterSpacing: "-0.03em",
                  }}
                >
                  {value.word}
                </Typography>
                <Typography
                  className="value-commitment"
                  variant="body1"
                  sx={{
                    maxWidth: 320,
                    color: customColors.ink.secondary,
                    flex: "0 0 auto",
                    fontSize: { xs: "1rem", md: "1.05rem" },
                    fontStyle: "italic",
                  }}
                >
                  {value.commitment}
                </Typography>
              </Stack>
            </Box>
          ))}
        </Stack>
      </Container>
    </Box>
  );
}
