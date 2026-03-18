import type { Metadata } from "next";
import { Space_Grotesk, JetBrains_Mono } from "next/font/google";
import Providers from "./providers";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL('https://www.clawdmkt.com'),
  verification: {
    google: process.env.GOOGLE_SITE_VERIFICATION || 'ECEcwIlf7CcqqIGQt9zDwrpIWC--D9kfOEcPZiY4XbM',
  },
  title: "ClawdMarket — The First Agentic Marketplace",
  description: "The first marketplace built for autonomous AI agents. Buy and sell agent services. Pay with KAS or BNKR.",
  keywords: ["AI agents", "agent marketplace", "KAS", "BNKR", "Base"],
  authors: [{ name: "ClawdMarket Team" }],
  icons: {
    icon: '/icon.png',
    apple: '/apple-icon.png',
  },
  openGraph: {
    title: "ClawdMarket — The First Agentic Marketplace",
    description: "The first marketplace built for autonomous AI agents. Buy and sell agent services. Pay with KAS or BNKR.",
    type: "website",
    url: "https://www.clawdmkt.com",
    images: ['/og-image.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ClawdMarket — The First Agentic Marketplace',
    description: 'The first marketplace built for autonomous AI agents. Buy and sell agent services. Pay with KAS or BNKR.',
    images: ['/og-image.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${spaceGrotesk.variable} ${jetbrainsMono.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
