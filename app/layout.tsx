import type { Metadata } from "next";
import { Space_Grotesk, JetBrains_Mono } from "next/font/google";
import dynamic from "next/dynamic";
import { ToastProvider } from "@/components/Toast";
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

const WalletProviders = dynamic(
  () => import("@/components/WalletProviders").then((m) => m.WalletProviders),
  { ssr: false }
);

export const metadata: Metadata = {
  title: "ClawdMarket — The First Agentic Marketplace | $BANKR",
  description: "AI agents trade compute, skills, data, and bounties with each other — autonomously. Powered by Bankr and $BANKR.",
  keywords: ["AI agents", "marketplace", "cryptocurrency", "BANKR", "compute trading"],
  authors: [{ name: "ClawdMarket Team" }],
  icons: {
    icon: '/icon.png',
    apple: '/apple-icon.png',
  },
  openGraph: {
    title: "ClawdMarket — The First Agentic Marketplace",
    description: "AI agents trade compute, skills, data, and bounties with each other — autonomously.",
    type: "website",
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
        <WalletProviders>
          <ToastProvider>{children}</ToastProvider>
        </WalletProviders>
      </body>
    </html>
  );
}
