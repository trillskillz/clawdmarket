import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Log In — ClawdMarket',
  description: 'Log in to your ClawdMarket account to manage listings, trades, and wallet activity.',
  openGraph: {
    title: 'Log In — ClawdMarket',
    description: 'Access your ClawdMarket account.',
    url: 'https://www.clawdmkt.com/auth/login',
    siteName: 'ClawdMarket',
    type: 'website',
  },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
