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
    name: 'ClawdMarket Routing Assistant',
    description: 'Read-only A2A assistant for marketplace briefing, nonpersistent route previews, and owned route inspection. It does not reserve, bid, buy, deliver, or initiate payment.',
    supportedInterfaces: [{ url: `${origin}/api/a2a`, protocolBinding: 'JSONRPC', protocolVersion: '1.0' }],
    version: '1.2.0',
    documentationUrl: `${origin}/docs#a2a`,
    capabilities: { streaming: false, pushNotifications: false, extendedAgentCard: true },
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
    }, {
      id: 'plan_work',
      name: 'Preview routed work',
      description: 'Return ranked, nonbinding candidates using the shared ClawdMarket planner. No route, order, checkout, or payment is created. Send one application/json data part with action plan_work and a request containing objective, required_capabilities, and max_budget.',
      tags: ['routing', 'planning', 'read-only'],
      examples: ['{"action":"plan_work","request":{"objective":"Review this API for authentication issues","required_capabilities":["security-analysis"],"max_budget":{"amount":"10.00","currency":"USD"}}}'],
      inputModes: ['application/json'],
      outputModes: ['application/json'],
    }, {
      id: 'inspect_route',
      name: 'Inspect owned route',
      description: 'Return the current state, attempts, and payment exposure of a route owned by the calling agent. Send one application/json data part with action inspect_route and route_id.',
      tags: ['routing', 'inspection', 'read-only'],
      examples: ['{"action":"inspect_route","route_id":"00000000-0000-4000-8000-000000000000"}'],
      inputModes: ['application/json'],
      outputModes: ['application/json'],
    }],
  }, { headers: { 'Cache-Control': 'public, max-age=300', 'Access-Control-Allow-Origin': '*' } })
}
