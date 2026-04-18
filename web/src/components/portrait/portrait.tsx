import { customColors } from "@/modules/mui/theme/constants";
import { Box, Stack, Typography } from "@mui/material";

/**
 * Duotone portrait slot (PROPOSAL §D).
 *
 * This component intentionally ships a CSS-only placeholder rather
 * than a real portrait, because sourcing photography is outside the
 * engineering scope of this design refresh. When real headshots are
 * commissioned, pass `src` and they will inherit the same orange /
 * teal duotone treatment via CSS `filter` — which means the site
 * stays visually coherent even if photo quality varies.
 *
 * The `grayscale` + `sepia` + `hue-rotate` + tinted overlay stack is
 * the cheapest way to approximate a duotone without per-image
 * pre-processing.
 */
interface PortraitProps {
  name: string;
  role: string;
  src?: string;
  /** Optional initials to show when no src is provided. */
  initials?: string;
}

export function Portrait({ name, role, src, initials }: PortraitProps) {
  const derivedInitials =
    initials ??
    name
      .split(/\s+/)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();

  return (
    <Stack spacing={1.5}>
      <Box
        sx={{
          position: "relative",
          aspectRatio: "3 / 4",
          borderRadius: 2,
          overflow: "hidden",
          backgroundColor: customColors.bgRaised.main,
          border: `1px solid ${customColors.rule}`,
        }}
      >
        {src ? (
          <Box
            component="img"
            src={src}
            alt={`${name}, ${role}`}
            sx={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              filter:
                "grayscale(1) sepia(0.6) saturate(1.4) hue-rotate(-10deg) contrast(1.02)",
            }}
          />
        ) : (
          <Stack
            alignItems="center"
            justifyContent="center"
            sx={{
              position: "absolute",
              inset: 0,
              color: customColors.orange.main,
              fontFamily: "inherit",
              fontSize: 48,
              fontWeight: 700,
              letterSpacing: "-0.02em",
              backgroundImage: `radial-gradient(closest-side, ${customColors.orange.main}22, transparent 75%)`,
            }}
          >
            {derivedInitials}
          </Stack>
        )}
        {/* Orange tint overlay — the second half of the duotone. */}
        <Box
          aria-hidden
          sx={{
            position: "absolute",
            inset: 0,
            background: `linear-gradient(180deg, rgba(242,141,104,0.18), rgba(1,61,57,0.55))`,
            mixBlendMode: "multiply",
            pointerEvents: "none",
          }}
        />
      </Box>
      <Stack spacing={0.25}>
        <Typography
          variant="overline"
          sx={{ color: customColors.orange.main, fontSize: 11 }}
        >
          {role}
        </Typography>
        <Typography
          variant="body2"
          sx={{ color: customColors.ink.primary, fontWeight: 600 }}
        >
          {name}
        </Typography>
      </Stack>
    </Stack>
  );
}
