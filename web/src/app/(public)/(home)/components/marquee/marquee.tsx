"use client";

import { customColors } from "@/modules/mui/theme/constants";
import { climateCrisis } from "@/modules/mui/theme/fonts";
import { keyframes } from "@emotion/react";
import { Box } from "@mui/material";

/**
 * Horizontal marquee band (PROPOSAL §C.2).
 *
 * A single repeating band of the five value words + a separator glyph,
 * scrolled horizontally by a pure-CSS keyframe so that it works without
 * GSAP and costs nothing on reduced-motion screens.
 *
 * The marquee duplicates its content so the loop is seamless, and
 * pauses automatically for users who prefer reduced motion.
 */

const scroll = keyframes`
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
`;

const WORDS = ["EMPOWER", "IMPACT", "EQUITY", "COMMUNITY", "INNOVATION"];

export function Marquee() {
  // Build the sequence and repeat it twice for a seamless loop.
  const oneLoop = WORDS.join(" · ") + " · ";
  const content = oneLoop.repeat(2);

  return (
    <Box
      aria-hidden
      sx={{
        py: { xs: 4, md: 6 },
        borderTop: `1px solid ${customColors.rule}`,
        borderBottom: `1px solid ${customColors.rule}`,
        overflow: "hidden",
        position: "relative",
      }}
    >
      <Box
        sx={{
          display: "flex",
          whiteSpace: "nowrap",
          width: "max-content",
          animation: `${scroll} 40s linear infinite`,
          "@media (prefers-reduced-motion: reduce)": {
            animation: "none",
            transform: "translateX(-10%)",
          },
        }}
      >
        <Box
          sx={{
            fontFamily: climateCrisis.style.fontFamily,
            fontSize: { xs: "3rem", md: "6rem" },
            lineHeight: 1,
            color: "transparent",
            WebkitTextStroke: `1px ${customColors.orange.main}`,
            letterSpacing: "-0.02em",
            px: 2,
          }}
        >
          {content}
        </Box>
      </Box>
    </Box>
  );
}
