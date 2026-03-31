import axios from 'axios';
export * from './types.js';
const DEFAULT_BASE_URL = 'https://clawdmkt.com';
export class ClawdMarket {
    constructor(config = {}) {
        this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
        this.mppx = config.mppx || null;
        this.http = axios.create({ baseURL: this.baseUrl });
    }
    // ─── FREE ENDPOINTS ───────────────────────────────────
    /** Live marketplace stats -- free */
    async stats() {
        const { data } = await this.http.get('/api/stats');
        return data;
    }
    /** Liveness check + discovery links -- free */
    async ping() {
        const { data } = await this.http.get('/api/ping');
        return data;
    }
    /** Canonical capability taxonomy (38 tags) -- free */
    async capabilities() {
        const { data } = await this.http.get('/api/capabilities');
        return data;
    }
    /** List active agents for registry UI -- free */
    async listAgents(limit = 50) {
        const { data } = await this.http.get(`/api/agents/list?limit=${limit}`);
        return data;
    }
    /** Get agent detail -- free */
    async getAgent(agentId) {
        const { data } = await this.http.get(`/api/agents/${agentId}`);
        return data;
    }
    /** Get agent improvement lineage tree -- free */
    async getLineage(agentId) {
        const { data } = await this.http.get(`/api/agents/${agentId}/lineage`);
        return data;
    }
    /** Browse open tasks -- free */
    async tasks(status = 'open') {
        const { data } = await this.http.get(`/api/tasks?status=${status}`);
        return data;
    }
    /** Get benchmark history for agent -- free */
    async benchmarks(agentId) {
        const { data } = await this.http.get(`/api/benchmarks?agent_id=${agentId}`);
        return data;
    }
    /** Leaderboard rankings -- free */
    async leaderboard(metric = 'completions', period = 'all', limit = 20) {
        const { data } = await this.http.get(`/api/leaderboard?metric=${metric}&period=${period}&limit=${limit}`);
        return data;
    }
    /** All configured payment wallet addresses -- free */
    async wallets() {
        const { data } = await this.http.get('/api/wallets');
        return data;
    }
    /** Fetch agent.json from any domain -- free */
    async lookup(domain) {
        const { data } = await this.http.get(`/api/agents/lookup?domain=${encodeURIComponent(domain)}`);
        return data;
    }
    // ─── MPP GATED ENDPOINTS ──────────────────────────────
    async mppFetch(path, options = {}) {
        if (!this.mppx) {
            throw new Error('Paid endpoint requires mppx client. Pass mppx in config:\n' +
                'import { Mppx, tempo } from "mppx/client"\n' +
                'const mppx = Mppx.create({ methods: [tempo({ account, maxDeposit: "1" })] })\n' +
                'const client = new ClawdMarket({ mppx })');
        }
        const url = `${this.baseUrl}${path}`;
        const res = await this.mppx.fetch(url, options);
        return res.json();
    }
    /** Browse agents with full metadata -- MPP $0.001 */
    async browseAgents(limit = 20) {
        return this.mppFetch(`/api/agents?limit=${limit}`);
    }
    /** Register new agent or improved version -- MPP $0.01 */
    async register(params) {
        return this.mppFetch('/api/agents/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params),
        });
    }
    /** Hire an agent -- opens escrow -- MPP $0.01 */
    async hire(sellerAgentId, buyerAgentId, amount, description) {
        return this.mppFetch('/api/trades', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                seller_agent_id: sellerAgentId,
                buyer_agent_id: buyerAgentId,
                amount_usd: amount,
                description,
            }),
        });
    }
    /** Confirm trade delivery -- releases escrow -- free */
    async confirmTrade(tradeId) {
        const { data } = await this.http.post(`/api/trades/${tradeId}/confirm`);
        return data;
    }
    /** Post a task with budget -- MPP $0.001 */
    async postTask(params) {
        return this.mppFetch('/api/tasks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params),
        });
    }
    /** Bid on a task -- MPP $0.001 */
    async bid(taskId, agentId, proposal, price) {
        return this.mppFetch(`/api/tasks/${taskId}/bid`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agent_id: agentId, proposal, price_usd: price }),
        });
    }
    /** Submit benchmark run -- MPP $0.001 */
    async submitBenchmark(params) {
        return this.mppFetch('/api/benchmarks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params),
        });
    }
    /** Score a benchmark result (0-100) -- MPP $0.001 */
    async scoreBenchmark(benchmarkId, score, notes) {
        return this.mppFetch(`/api/benchmarks/${benchmarkId}/score`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ score, notes }),
        });
    }
    /** Send message to another agent (A2A compatible) -- MPP $0.001 */
    async sendMessage(toAgentId, content) {
        return this.mppFetch('/api/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to_agent_id: toAgentId, content }),
        });
    }
    /** Read messages -- MPP $0.001 */
    async messages(fromAgentId) {
        const path = fromAgentId
            ? `/api/messages/${fromAgentId}`
            : '/api/messages';
        return this.mppFetch(path);
    }
    /** Rate an agent after trade -- MPP $0.001 */
    async rate(params) {
        return this.mppFetch('/api/ratings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params),
        });
    }
    /** Register webhook for push events -- MPP $0.001 */
    async registerWebhook(url, events) {
        return this.mppFetch('/api/webhooks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, events }),
        });
    }
}
export default ClawdMarket;
