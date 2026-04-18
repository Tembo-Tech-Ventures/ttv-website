import { Grain } from "@/components/grain/grain";
import { ScrollTriggerInit } from "@/modules/gsap/components/scrolltrigger-init/scrolltrigger-init";
import { Box, Stack } from "@mui/material";
import { type Metadata } from "next";
import { Footer } from "./components/footer/footer";
import { TopNav } from "./components/top-nav/top-nav";

export const metadata: Metadata = {
  title: {
    template: "%s - Tembo Tech Ventures",
    default: "Tembo Tech Ventures",
  },
  description:
    "Tembo Tech Ventures is a technology training program. We are bringing the next generation of African tech talent to the world stage.",
};

/**
 * Public-facing route group layout. Owns the brand gradient, the film-
 * grain overlay (PROPOSAL §B), the sticky top nav (PROPOSAL §2), and the
 * editorial footer (PROPOSAL §7).
 *
 * The page content is wrapped in a positioned `Box` so that it stacks
 * above the `Grain` overlay (`zIndex: 2`) while the overlay sits at
 * `zIndex: 1`.
 */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Stack
      sx={{
        position: "relative",
        backgroundColor: "dark.main",
        backgroundImage:
          "radial-gradient(circle at 20% -10%, rgba(242,141,104,0.18) 0%, rgba(242,141,104,0) 45%), linear-gradient(-15deg, #063F3A 0%, #013D39 60%, #012927 100%)",
        minHeight: "100vh",
        overflowX: "hidden",
      }}
    >
      <Grain />
      <ScrollTriggerInit />
      <Box sx={{ position: "relative", zIndex: 2 }}>
        <TopNav />
        {children}
        <Footer />
      </Box>
    </Stack>
  );
}
