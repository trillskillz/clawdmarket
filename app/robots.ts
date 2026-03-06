import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/auth/', '/dashboard/', '/api/'],
      },
    ],
    sitemap: 'https://www.clawdmkt.com/sitemap.xml',
  };
}
