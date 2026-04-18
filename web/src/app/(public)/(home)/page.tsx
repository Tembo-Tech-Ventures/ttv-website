"use client";

import { Stack } from "@mui/material";
import { Header } from "./components/header/header";
import { Value } from "./components/value/value";
import { Features } from "./components/features/features";
import { OurValues } from "./components/our-values/our-values";
import { Marquee } from "./components/marquee/marquee";
import { Humans } from "./components/humans/humans";

/**
 * Public homepage composition.
 *
 * The order is chosen so the page reads as a single editorial
 * document: hero → definition/why → what → marquee break → values →
 * humans. The marquee between sections is the single most
 * recognizable 2026 tech-site gesture (PROPOSAL §C.2).
 */
export default function Home() {
  return (
    <Stack direction="column" component="main">
      <Header />
      <Value />
      <Features />
      <Marquee />
      <OurValues />
      <Humans />
    </Stack>
  );
}
