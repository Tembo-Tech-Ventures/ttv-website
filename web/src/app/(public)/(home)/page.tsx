"use client";

import { Box, Stack } from "@mui/material";
import { Header } from "./components/header/header";
import { Value } from "./components/value/value";
import { Features } from "./components/features/features";
import { OurValues } from "./components/our-values/our-values";

export default function Home() {
  return (
    <Stack direction="column" alignItems="center" py={4} spacing={4}>
      <Header />
      <Value />
      <Features />
      <OurValues />
    </Stack>
  );
}
