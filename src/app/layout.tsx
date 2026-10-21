import type { Metadata } from "next";
import "@fontsource-variable/inter";
import "@/styles/typography.css";
import "@/styles/controls.css";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: "Clair",
  description: "Pilotage RH et financier pour DAF de PME et d'ESS",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" data-clair-theme="airy">
      <body>{children}</body>
    </html>
  );
}
