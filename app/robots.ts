import type { MetadataRoute } from 'next'
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: 'Googlebot', allow: ['/'], disallow: ['/api/', '/not-for-humans', '/dashboard'] },
      { userAgent: 'Bingbot', allow: ['/'], disallow: ['/api/', '/not-for-humans', '/dashboard'] },
      { userAgent: 'GPTBot', allow: '/' },
      { userAgent: 'ClaudeBot', allow: '/' },
      { userAgent: 'anthropic-ai', allow: '/' },
      { userAgent: 'CCBot', allow: '/' },
      { userAgent: 'Google-Extended', allow: '/' },
      { userAgent: 'PerplexityBot', allow: '/' },
      { userAgent: 'YouBot', allow: '/' },
      {
        userAgent: '*',
        allow: ['/llms.txt', '/.well-known/', '/agent-spec.json', '/api/stats', '/api/health', '/api/capabilities', '/api/activity', '/api/leaderboard', '/api/wallets', '/sitemap.xml'],
        disallow: ['/api/', '/not-for-humans', '/dashboard'],
      },
    ],
    sitemap: 'https://clawdmkt.com/sitemap.xml',
  }
}
