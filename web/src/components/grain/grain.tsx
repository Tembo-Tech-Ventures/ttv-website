"use client";

import { Box } from "@mui/material";

/**
 * Fixed-position film-grain overlay. Uses an inline SVG `feTurbulence`
 * filter so we don't need to ship a PNG asset — the noise field is
 * generated at runtime and tiled by the browser. Rendered at ~5% opacity
 * on top of the dark teal brand background to make the surface feel
 * authored rather than "default MUI dark mode" (see PROPOSAL §B).
 *
 * `pointerEvents: none` + `zIndex: 1` keeps the layer purely cosmetic.
 */
export function Grain() {
  return (
    <Box
      aria-hidden
      sx={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        zIndex: 1,
        opacity: 0.08,
        mixBlendMode: "overlay",
        backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.95  0 0 0 0 0.87  0 0 0 0 0.76  0 0 0 1 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>")`,
        backgroundRepeat: "repeat",
        "@media (prefers-reduced-motion: reduce)": {
          opacity: 0.05,
        },
      }}
    />
  );
}
