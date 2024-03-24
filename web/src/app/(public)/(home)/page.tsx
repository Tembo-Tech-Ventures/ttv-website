"use client";

import { Box, Stack } from "@mui/material";
import { Header } from "./components/header/header";
import { Value } from "./components/value/value";

export default function Home() {
  return (
    <Stack direction="column" alignItems="center" py={4} spacing={4}>
      <Header />
      <Value />
      <Box height={1000} />
    </Stack>
  );
}
