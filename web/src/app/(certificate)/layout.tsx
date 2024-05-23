import { Stack } from "@mui/material";
import { type Metadata } from "next";

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
