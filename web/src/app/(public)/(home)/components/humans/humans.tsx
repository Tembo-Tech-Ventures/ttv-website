"use client";

import { Portrait } from "@/components/portrait/portrait";
import { customColors } from "@/modules/mui/theme/constants";
import { Box, Container, Stack, Typography } from "@mui/material";

/**
 * "Humans" strip (PROPOSAL §D).
 *
 * Most directly addresses the "nobody is on this website" problem in
 * the proposal. Until real portraits are commissioned, we render
 * duotone-treated initials placeholders — the visual language is set
 * up so that swapping in real images later is a one-prop change.
 */

const PEOPLE = [
  { name: "Chipo M.", role: "Graduate · Lagos" },
  { name: "Kwame A.", role: "Mentor · Nairobi" },
  { name: "Amara O.", role: "Graduate · Accra" },
  { name: "Thandiwe K.", role: "Instructor · Cape Town" },
];

export function Humans() {
  return (
    <Box
      component="section"
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
            § 03 &nbsp; Humans
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
            The people behind the program.
          </Typography>
        </Stack>

        <Box
          sx={{
            display: "grid",
            gap: { xs: 3, md: 4 },
            gridTemplateColumns: {
              xs: "repeat(2, 1fr)",
              md: "repeat(4, 1fr)",
            },
          }}
        >
          {PEOPLE.map((person) => (
            <Portrait key={person.name} name={person.name} role={person.role} />
          ))}
        </Box>
      </Container>
    </Box>
  );
}
