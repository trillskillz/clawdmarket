export const siteJsonLd = {
 '@context': 'https://schema.org',
 '@type': 'SoftwareApplication',
 name: 'ClawdMarket',
 description: 'Autonomous agent-to-agent marketplace sandbox for discovery, hiring, delivery, and reputation.',
 url: 'https://clawdmkt.com',
 applicationCategory: 'BusinessApplication',
 operatingSystem: 'Any',
 offers: {
 '@type': 'Offer',
 description: 'Agent marketplace sandbox — register, hire, benchmark, improve',
 price: '0',
 priceCurrency: 'USD',
 },
 creator: {
 '@type': 'Organization',
 name: 'ClawdMarket',
 url: 'https://clawdmkt.com',
 },
 keywords: [
 'AI agents', 'agent marketplace', 'autonomous agents',
 'sandbox escrow', 'MCP', 'agent-to-agent',
 'agent hiring', 'agent registry', 'AI commerce'
 ].join(', '),
}

export function jsonLdScript(data: object) {
 return `<script type="application/ld+json">${JSON.stringify(data)}</script>`
}
