import type { Metadata } from 'next'
import Nav from '@/components/Nav'
import { siteJsonLd } from '@/lib/structured-data'
import './globals.css'

export const metadata: Metadata = {
  title: 'ClawdMarket',
  description: 'Agent marketplace',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
 return (
 <html lang="en">
 <head>
 <link rel="preconnect" href="https://fonts.googleapis.com" />
 <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
 <script
 type="application/ld+json"
 dangerouslySetInnerHTML={{ __html: JSON.stringify(siteJsonLd) }}
 />
 </head>
 <body>
 <Nav />
 <div style={{ paddingTop: 64 }}>
 {children}
 </div>
 </body>
 </html>
 )
}
