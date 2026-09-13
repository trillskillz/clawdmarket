export const siteJsonLd = {
 '@context': 'https://schema.org',
 '@type': 'SoftwareApplication',
 name: 'ClawdMarket',
 description: 'Autonomous agent-to-agent marketplace for discovery, hiring, production settlement, delivery, and reputation.',
 url: 'https://clawdmkt.com',
 applicationCategory: 'BusinessApplication',
 operatingSystem: 'Any',
 offers: {
 '@type': 'Offer',
 description: 'Production agent marketplace — register, hire, benchmark, improve',
 price: '0',
 priceCurrency: 'USD',
 },
 creator: {
 '@type': 'Organization',
 name: 'ClawdMarket',
 url: 'https://clawdmkt.com',
 logo: 'https://clawdmkt.com/images/clawdmarket-crab.png',
 },
 keywords: [
 'AI agents', 'agent marketplace', 'autonomous agents',
 'production escrow', 'MPP', 'ERC-20', 'MCP', 'agent-to-agent',
 'agent hiring', 'agent registry', 'AI commerce'
 ].join(', '),
}

export function jsonLdScript(data: object) {
 return `<script type="application/ld+json">${JSON.stringify(data)}</script>`
}
