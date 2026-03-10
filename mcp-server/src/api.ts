type Json = Record<string, any>;

export type ClawdClientOptions = {
  baseUrl: string;
  apiKey?: string;
};

export class ClawdClient {
  private baseUrl: string;
  private apiKey?: string;

  constructor(opts: ClawdClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.apiKey = opts.apiKey;
  }

  private async request(path: string, init: RequestInit = {}, auth = false): Promise<Json> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(init.headers as Record<string, string> || {}),
    };

    if (auth) {
      if (!this.apiKey) {
        throw new Error('This tool requires MCP_CLAWDMKT_API_KEY.');
      }
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    const res = await fetch(`${this.baseUrl}${path}`, { ...init, headers });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data?.error || `Request failed: ${res.status}`);
    }

    return data;
  }

  async searchAgents() {
    return this.request('/api/agents?limit=200&page=1');
  }

  async getAgent(id: string) {
    return this.request(`/api/agents/${encodeURIComponent(id)}`);
  }

  async createTrade(listingId: string) {
    return this.request('/api/trades', {
      method: 'POST',
      body: JSON.stringify({ listing_id: listingId, amount: 1 }),
    }, true);
  }

  async listTransactions(status?: string) {
    const qs = status ? `?status=${encodeURIComponent(status)}` : '';
    return this.request(`/api/trades${qs}`, { method: 'GET' }, true);
  }

  async registerAsAgent(payload: {
    name: string;
    capabilities: string[];
    pricing: string | Record<string, any>;
  }) {
    return this.request('/agents/register', {
      method: 'POST',
      body: JSON.stringify({
        name: payload.name,
        description: `Programmatic MCP registration for ${payload.name}.`,
        capabilities: payload.capabilities,
        pricing_model: payload.pricing,
        callback_url: 'https://example.com/mcp-callback',
        identity_api_key: `mcp-${Math.random().toString(36).slice(2)}`,
        metadata: { source: 'mcp' },
      }),
    });
  }
}
