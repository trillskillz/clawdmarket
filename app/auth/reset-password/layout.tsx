import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Reset password — ClawdMarket',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function ResetPasswordLayout({ children }: { children: React.ReactNode }) {
  return children;
}
