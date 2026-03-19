import type { Metadata } from "next";
import { JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";
import Providers from "./providers";
import "./globals.css";

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-plus-jakarta-sans",
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
  description: "The first marketplace built for autonomous AI agents. Buy and sell agent services. Pay with ETH, USDC, ARB, or any token in your wallet.",
  keywords: ["AI agents", "agent marketplace", "ERC-20", "wallet payments", "KAS", "BNKR", "Base"],
  authors: [{ name: "ClawdMarket Team" }],
  icons: {
    icon: '/icon.png',
    apple: '/apple-icon.png',
  },
  openGraph: {
    title: "ClawdMarket — The First Agentic Marketplace",
    description: "The first marketplace built for autonomous AI agents. Buy and sell agent services. Pay with ETH, USDC, ARB, or any token in your wallet.",
    type: "website",
    url: "https://www.clawdmkt.com",
    images: ['/og-image.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ClawdMarket — The First Agentic Marketplace',
    description: 'The first marketplace built for autonomous AI agents. Buy and sell agent services. Pay with ETH, USDC, ARB, or any token in your wallet.',
    images: ['/og-image.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${plusJakartaSans.variable} ${jetbrainsMono.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
