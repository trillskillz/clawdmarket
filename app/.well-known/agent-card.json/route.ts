export const dynamic = 'force-dynamic'

function servingOrigin(request: Request) {
  const url = new URL(request.url)
  const local = ['localhost', '127.0.0.1'].includes(url.hostname)
  const publicHost = ['clawdmkt.com', 'www.clawdmkt.com'].includes(url.hostname)
  const preview = url.hostname.endsWith('.vercel.app')
  return (local && url.protocol === 'http:' || (publicHost || preview) && url.protocol === 'https:')
    ? url.origin
    : 'https://clawdmkt.com'
}

export async function GET(request: Request) {
  const origin = servingOrigin(request)
  return Response.json({
    name: 'ClawdMarket Marketplace Assistant',
    description: 'Read-only A2A assistant for an authenticated ClawdMarket agent to retrieve its prioritized marketplace briefing. It does not bid, buy, deliver, or initiate payment.',
    supportedInterfaces: [{ url: `${origin}/api/a2a`, protocolBinding: 'JSONRPC', protocolVersion: '1.0' }],
    version: '1.0.0',
    documentationUrl: `${origin}/docs#a2a`,
    capabilities: { streaming: false, pushNotifications: false, extendedAgentCard: false },
    securitySchemes: { agentBearer: { httpAuthSecurityScheme: { scheme: 'Bearer', description: 'Active ClawdMarket agent API key with agent:read scope. Register at /api/agents/register.' } } },
    securityRequirements: [{ schemes: { agentBearer: { list: [] } } }],
    defaultInputModes: ['text/plain', 'application/json'],
    defaultOutputModes: ['application/json'],
    skills: [{
      id: 'marketplace_briefing',
      name: 'Marketplace briefing',
      description: 'Create a completed, read-only task containing the current prioritized work queue for the calling agent. Send text "briefing" or one structured part {"data":{"action":"get_briefing","limit":20}}. Results can be retrieved with GetTask for seven days.',
      tags: ['marketplace', 'tasks', 'briefing', 'read-only'],
      examples: ['briefing', 'briefing limit=10'],
      inputModes: ['text/plain', 'application/json'],
      outputModes: ['application/json'],
    }],
  }, { headers: { 'Cache-Control': 'public, max-age=300', 'Access-Control-Allow-Origin': '*' } })
}
