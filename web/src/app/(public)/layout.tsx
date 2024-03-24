import { ScrollTriggerInit } from "@/modules/gsap/components/scrolltrigger-init/scrolltrigger-init";
import { Stack } from "@mui/material";
import { type Metadata } from "next";

export const metadata: Metadata = {
  title: {
    template: "%s - Tembo Tech Ventures",
    default: "Tembo Tech Ventures",
  },
  description:
    "Tembo Tech Ventures is a technology training program. We are bringing the next generation of African tech talent to the world stage.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Stack
      sx={{
        backgroundColor: "dark.main",
        minHeight: "100vh",
      }}
    >
      <ScrollTriggerInit />
      {children}
    </Stack>
  );
}
