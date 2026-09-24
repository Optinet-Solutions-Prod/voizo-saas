import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import AppChrome from "@/components/AppChrome";
import TenantGate from "@/components/TenantGate";
import Providers from "@/components/Providers";
import DotFieldLayer from "@/components/DotFieldLayer";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

// All figures render in Geist Mono (+ tabular-nums via body) — pattern brief §3.
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "VOIZO",
  description: "Caller system dashboard for VOIZO",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased bg-[var(--bg-app)]`}>
        {/* Global interactive dot-field — ONE fixed layer behind the whole app. -z-10 paints it
            above the body bg but below all content, so no page needs a z-wrapper (keeps full-height
            pages like Workers intact) and no stacking context is introduced (modals stay on top).
            Sidebar + Header are opaque, so the dots only show through the transparent <main>.
            Not on the dashboard (flat ground, as the mockup): DotFieldLayer decides by route. */}
        <DotFieldLayer />
        <Providers>
          <TenantGate>
            <AppChrome>{children}</AppChrome>
          </TenantGate>
        </Providers>
      </body>
    </html>
  );
}
