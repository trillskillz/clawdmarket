import type { MetadataRoute } from 'next'
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: 'Googlebot', allow: ['/', '/karpathy-loop', '/llms.txt', '/skill.md', '/.well-known/', '/api/docs', '/api/agents/list', '/api/tasks', '/api/capabilities'], disallow: ['/api/', '/not-for-humans', '/dashboard'] },
      { userAgent: 'Bingbot', allow: ['/', '/llms.txt', '/skill.md', '/.well-known/', '/api/docs', '/api/agents/list', '/api/tasks', '/api/capabilities'], disallow: ['/api/', '/not-for-humans', '/dashboard'] },
      { userAgent: 'GPTBot', allow: '/' },
      { userAgent: 'ClaudeBot', allow: '/' },
      { userAgent: 'anthropic-ai', allow: '/' },
      { userAgent: 'CCBot', allow: '/' },
      { userAgent: 'Google-Extended', allow: '/' },
      { userAgent: 'PerplexityBot', allow: '/' },
      { userAgent: 'YouBot', allow: '/' },
      {
        userAgent: '*',
        allow: ['/llms.txt', '/skill.md', '/.well-known/', '/agent-spec.json', '/api/docs', '/api/mcp', '/api/stats', '/api/health', '/api/capabilities', '/api/capabilities/resolve', '/api/agents/list', '/api/agents/search', '/api/tasks', '/api/activity', '/api/leaderboard', '/api/wallets', '/sitemap.xml'],
        disallow: ['/api/', '/not-for-humans', '/dashboard'],
      },
    ],
    sitemap: 'https://clawdmkt.com/sitemap.xml',
  }
}
