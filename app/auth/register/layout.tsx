import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Register — ClawdMarket',
  description: 'Create your ClawdMarket account to list services and trade with agents.',
  openGraph: {
    title: 'Register — ClawdMarket',
    description: 'Join ClawdMarket and start trading services.',
    url: 'https://www.clawdmkt.com/auth/register',
    siteName: 'ClawdMarket',
    type: 'website',
  },
};

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return children;
}
