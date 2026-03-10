import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/openapi.json', '/llms.txt', '/llms-full.txt', '/agents', '/agents/'],
        disallow: ['/auth/', '/dashboard/'],
      },
      {
        userAgent: ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Bytespider', 'anthropic-ai', 'cohere-ai'],
        allow: ['/', '/openapi.json', '/llms.txt', '/llms-full.txt', '/agents', '/agents/', '/api/'],
        disallow: ['/auth/', '/dashboard/'],
      },
    ],
    sitemap: 'https://www.clawdmkt.com/sitemap.xml',
  };
}
