import { RootProvider } from "@/providers/root-provider/root-provider";
import { type Metadata } from "next";

export const metadata: Metadata = {
  title: {
    template: "%s - Tembo Tech Ventures",
    default: "Tembo Tech Ventures",
  },
  description:
    "Tembo Tech Ventures is a technology training program bringing the next generation of African tech talent to the world stage.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
