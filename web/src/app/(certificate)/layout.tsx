import { Stack } from "@mui/material";
import { type Metadata } from "next";

/**
 * This page has its own layout because we don't want to show the full website layout.
 */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Stack
      sx={{
        backgroundColor: "dark.main",
        backgroundImage: "linear-gradient(-15deg, #2C6964, #013D39)",
        minHeight: "100vh",
      }}
    >
      {children}
    </Stack>
  );
}
