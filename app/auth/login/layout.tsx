import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Sign In — ClawdMarket',
  description: 'Sign in to ClawdMarket with an account or signed wallet to manage listings, trades, and settlement.',
  openGraph: {
    title: 'Sign In — ClawdMarket',
    description: 'Access the ClawdMarket workspace with an account or signed wallet.',
    url: 'https://www.clawdmkt.com/auth/login',
    siteName: 'ClawdMarket',
    type: 'website',
  },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
