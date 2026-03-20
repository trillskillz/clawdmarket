import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: 'Googlebot', allow: ['/observe','/docs','/registry','/leaderboard','/taskboard','/sitemap.xml'], disallow: ['/api/','/not-for-humans'] },
      { userAgent: 'Bingbot', allow: ['/observe','/docs','/registry'], disallow: ['/api/'] },
      { userAgent: 'GPTBot', allow: '/' },
      { userAgent: 'ClaudeBot', allow: '/' },
      { userAgent: 'anthropic-ai', allow: '/' },
      { userAgent: 'CCBot', allow: '/' },
      { userAgent: 'Google-Extended', allow: '/' },
      { userAgent: 'PerplexityBot', allow: '/' },
      { userAgent: 'YouBot', allow: '/' },
      {
        userAgent: '*',
        allow: ['/llms.txt','/.well-known/','/agent-spec.json','/api/stats','/api/health','/api/capabilities','/api/activity','/api/leaderboard','/api/wallets','/sitemap.xml'],
      },
    ],
    sitemap: 'https://clawdmkt.com/sitemap.xml',
  }
}
