"use client";

import { Elephant } from "@/assets/brand/elephant";
import { customColors } from "@/modules/mui/theme/constants";
import { useGSAP } from "@gsap/react";
import { Box, Stack, Typography } from "@mui/material";
import gsap from "gsap";
import { useRef } from "react";

export function Header() {
  const ref = useRef(null);
  useGSAP(
    () => {
      // use gsap scroll trigger to move the title from left 80% to left -50% when the user scrolls down
      gsap.fromTo(
        "#home-header-title",
        { x: "50%" },
        {
          x: "-50%",
          scrollTrigger: {
            trigger: "#home-header-title",
            start: "top 50%",
            end: "bottom top",
            scrub: true,
          },
        },
      );

      gsap.fromTo(
        "#header-elephant-container",
        { opacity: 1, scale: 1 },
        {
          opacity: 0,
          scale: 0.8,
          scrollTrigger: {
            trigger: "#header-elephant-container",
            start: "bottom 30%",
            end: "bottom top",
            scrub: true,
          },
        },
      );
    },
    { scope: ref },
  );
  return (
    <Stack
      direction="column"
      alignItems="center"
      spacing={4}
      id="home-header"
      ref={ref}
      sx={{
        width: "100%",
        overflow: "hidden",
      }}
    >
      <Box
        sx={{
          "& path": {
            fill: customColors.orange.main,
          },
          width: "100%",
          maxWidth: "300px",
        }}
        id="header-elephant-container"
      >
        <Elephant />
      </Box>
      <Typography
        variant="h1"
        color="orange.main"
        align="center"
        sx={{ whiteSpace: "nowrap" }}
        id="home-header-title"
      >
        Tembo Tech Ventures
      </Typography>
    </Stack>
  );
}
