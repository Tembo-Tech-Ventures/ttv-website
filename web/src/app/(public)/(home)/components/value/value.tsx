"use client";

import { Elephant } from "@/assets/brand/elephant";
import { customColors } from "@/modules/mui/theme/constants";
import { climateCrisis } from "@/modules/mui/theme/fonts";
import { useGSAP } from "@gsap/react";
import { Box, Container, Stack, Typography } from "@mui/material";
import gsap from "gsap";
import { useRef } from "react";

/**
 * "Tembo (n.) — elephant. Swahili." editorial block (PROPOSAL §3).
 *
 * Previously this was a bordered card with a gradient border housing
 * the mission copy. The proposal's direction is to blow the mission
 * statement out of the container and present it as an editorial
 * dictionary entry paired with a pull-quote-sized mission.
 */
export function Value() {
  const ref = useRef<HTMLDivElement | null>(null);

  useGSAP(
    () => {
      if (typeof window === "undefined") return;
      const prefersReducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      if (prefersReducedMotion) return;

      gsap.fromTo(
        "#why-tembo-quote",
        { opacity: 0, y: 40 },
        {
          opacity: 1,
          y: 0,
          duration: 1,
          ease: "power2.out",
          scrollTrigger: {
            trigger: "#why-tembo-quote",
            start: "top 80%",
            toggleActions: "play none none reverse",
          },
        },
      );
    },
    { scope: ref },
  );

  return (
    <Box
      ref={ref}
      component="section"
      id="why-tembo"
      sx={{
        py: { xs: 10, md: 16 },
        borderTop: `1px solid ${customColors.rule}`,
      }}
    >
      <Container maxWidth="xl">
        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={{ xs: 4, md: 8 }}
          alignItems={{ xs: "flex-start", md: "center" }}
        >
          <Stack spacing={1.5} sx={{ flex: "0 0 auto", maxWidth: 360 }}>
            <Typography
              variant="overline"
              sx={{
                color: customColors.orange.main,
                letterSpacing: "0.32em",
                fontSize: { xs: 12, md: 14 },
              }}
            >
              § 00 &nbsp; Why Tembo
            </Typography>
            <Typography
              sx={{
                fontFamily: climateCrisis.style.fontFamily,
                fontSize: { xs: "2.25rem", md: "2.75rem" },
                lineHeight: 1,
                color: customColors.ink.primary,
                letterSpacing: "-0.02em",
              }}
            >
              Tembo
            </Typography>
            <Typography
              variant="body2"
              sx={{
                color: customColors.ink.secondary,
                fontStyle: "italic",
                letterSpacing: "0.04em",
              }}
            >
              (n.) — elephant. Swahili. A memory that carries the herd.
            </Typography>
            <Box sx={{ width: 120, mt: 2, opacity: 0.9 }}>
              <Elephant color={customColors.orange.main} />
            </Box>
          </Stack>

          <Typography
            id="why-tembo-quote"
            component="blockquote"
            sx={{
              flex: "1 1 auto",
              fontFamily: climateCrisis.style.fontFamily,
              fontSize: { xs: "2rem", md: "3.5rem" },
              lineHeight: 1.05,
              color: customColors.ink.primary,
              letterSpacing: "-0.02em",
              borderLeft: { md: `2px solid ${customColors.orange.main}` },
              pl: { md: 4 },
              m: 0,
            }}
          >
            Our mission is to bridge the gap between Africa&apos;s tech ambition
            and the{" "}
            <Box component="span" sx={{ color: customColors.orange.main }}>
              delivery-ready
            </Box>{" "}
            talent the industry still says it can&apos;t find.
          </Typography>
        </Stack>
      </Container>
    </Box>
  );
}
