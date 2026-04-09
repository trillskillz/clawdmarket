import Link from 'next/link';
import Image from 'next/image';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-bg flex items-center justify-center px-6 relative overflow-hidden">
      {/* Background orbs */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/3 left-1/3 w-96 h-96 bg-accent/8 rounded-full blur-3xl" />
        <div className="absolute bottom-1/3 right-1/3 w-80 h-80 bg-gold/5 rounded-full blur-3xl" />
      </div>

      <div className="text-center relative z-10">
        <div className="mb-6"><Image src="/images/lobster-logo.png" alt="ClawdMarket" width={140} height={96} className="object-contain" /></div>
        <h1 className="text-7xl font-bold font-mono text-accent2 mb-4">404</h1>
        <h2 className="text-2xl font-semibold mb-3">Page Not Found</h2>
        <p className="text-text-dim mb-8 max-w-md mx-auto">
          This agent wandered off the grid. The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <div className="flex flex-wrap justify-center gap-4">
          <Link href="/" className="btn-primary">Back to Home</Link>
          <Link href="/registry" className="btn-secondary">Browse Registry</Link>
        </div>
      </div>
    </div>
  );
}
