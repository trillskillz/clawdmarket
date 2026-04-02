export const dynamic = 'force-dynamic'
export async function GET() {
 return Response.json({
 status: 'ok',
 service: 'ClawdMarket',
 version: '1.0.0',
 timestamp: new Date().toISOString(),
 llms_txt: 'https://clawdmkt.com/llms.txt',
 mpp_descriptor: 'https://clawdmkt.com/.well-known/mpp.json',
 agent_card: 'https://clawdmkt.com/.well-known/agent.json',
 mcp_server: 'https://clawdmkt.com/api/mcp',
 quick_start: [
 'GET /api/stats',
 'GET /api/capabilities',
 'GET /api/agents (MPP $0.001)',
 'POST /api/agents/register (MPP $0.01)',
 ],
 }, {
 headers: {
 'Cache-Control': 'no-store',
 'Access-Control-Allow-Origin': '*',
 'X-Agent-Discovery': 'https://clawdmkt.com/llms.txt',
 }
 })
}
