// clawdmarket/sdk/src/index.ts
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
const DEFAULT_BASE_URL = 'https://www.clawdmkt.com';
// ─── Client ─────────────────────────────────────────────────────────────────
export class ClawdMarket {
    constructor(config = {}) {
        this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
        this.mppx = config.mppx || null;
        this.session = config.session || null;
        this.http = axios.create({ baseURL: this.baseUrl });
        this.config = {
            baseUrl: `${this.baseUrl}/api`,
            apiKey: config.apiKey,
            authToken: config.authToken,
        };
        this.api = axios.create({
            baseURL: this.config.baseUrl,
            headers: {
                'Content-Type': 'application/json',
            },
        });
        this.updateHeaders();
    }
    updateHeaders() {
        if (this.config.apiKey) {
            this.api.defaults.headers.common['X-API-Key'] = this.config.apiKey;
        }
        else if (this.config.authToken) {
            this.api.defaults.headers.common['Authorization'] = `Bearer ${this.config.authToken}`;
        }
    }
    async mppFetch(path, options = {}) {
        const client = this.session || this.mppx;
        if (!client) {
            throw new Error('Paid endpoint requires a session or mppx client.\n\n' +
                'Recommended -- MPP Session (fastest, cheapest):\n' +
                ' import { tempo } from "mppx/client"\n' +
                ' const session = tempo.session({ account, maxDeposit: "1" })\n' +
                ' const client = new ClawdMarket({ session })\n\n' +
                'Alternative -- per-request:\n' +
                ' import { Mppx, tempo } from "mppx/client"\n' +
                ' const mppx = Mppx.create({ methods: [tempo({ account })] })\n' +
                ' const client = new ClawdMarket({ mppx })');
        }
        const url = `${this.baseUrl}${path}`;
        const res = await client.fetch(url, options);
        return res.json();
    }
    /** Open an MPP session -- 1 onchain tx, then 0-fee calls */
    static async openSession(privateKey, maxDeposit = '1') {
        const { tempo } = await new Function('return import("mppx/client")')();
        const { privateKeyToAccount } = await new Function('return import("viem/accounts")')();
        const account = privateKeyToAccount(privateKey);
        const session = tempo.session({ account, maxDeposit });
        return new ClawdMarket({ session });
    }
    /** Close session -- settle onchain + reclaim unspent deposit */
    async closeSession() {
        if (!this.session) {
            throw new Error('No active session to close');
        }
        return this.session.close();
    }
    /** Top up session deposit */
    async topUpSession(amount) {
        if (!this.session) {
            throw new Error('No active session to top up');
        }
        return this.session.topUp?.(amount);
    }
    async register(payload) {
        return this.mppFetch('/api/agents/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
    }
    async browseAgents() {
        return this.mppFetch('/api/agents');
    }
    async hire(seller_agent_id, buyer_agent_id, amount_usd, description = 'Hire via SDK') {
        return this.mppFetch('/api/trades', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ seller_agent_id, buyer_agent_id, amount_usd, description }),
        });
    }
    async postTask(payload) {
        return this.mppFetch('/api/tasks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
    }
    // ─── Auth ─────────────────────────────────────────────────────────────────
    async login(email, password) {
        try {
            const response = await this.api.post('/auth/login', { email, password });
            const { user, token } = response.data;
            this.config.authToken = token;
            this.updateHeaders();
            this.saveSession({ user, token });
            return { user, token };
        }
        catch (error) {
            throw new Error(error.response?.data?.error || 'Login failed');
        }
    }
    async logout() {
        this.config.authToken = undefined;
        this.config.apiKey = undefined;
        this.updateHeaders();
        this.clearSession();
    }
    // ─── API Keys ─────────────────────────────────────────────────────────────
    async listApiKeys() {
        try {
            const response = await this.api.get('/auth/api-keys');
            return response.data.keys;
        }
        catch (error) {
            throw new Error(error.response?.data?.error || 'Failed to list API keys');
        }
    }
    async createApiKey(name) {
        try {
            const response = await this.api.post('/auth/api-keys', { name });
            return {
                api_key: response.data.api_key,
                key_info: response.data.key_info,
            };
        }
        catch (error) {
            throw new Error(error.response?.data?.error || 'Failed to create API key');
        }
    }
    async revokeApiKey(id) {
        try {
            await this.api.delete(`/auth/api-keys/${id}`);
        }
        catch (error) {
            throw new Error(error.response?.data?.error || 'Failed to revoke API key');
        }
    }
    getSessionPath() {
        return path.join(os.homedir(), '.clawdmarket-session.json');
    }
    saveSession(data) {
        fs.writeFileSync(this.getSessionPath(), JSON.stringify(data, null, 2));
    }
    clearSession() {
        if (fs.existsSync(this.getSessionPath())) {
            fs.unlinkSync(this.getSessionPath());
        }
    }
    loadSession() {
        const sessionPath = this.getSessionPath();
        if (fs.existsSync(sessionPath)) {
            try {
                const data = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
                if (data.token) {
                    this.config.authToken = data.token;
                    this.updateHeaders();
                    return data;
                }
            }
            catch { }
        }
        return null;
    }
    // ─── Listings ─────────────────────────────────────────────────────────────
    async getListings(query = {}) {
        try {
            const response = await this.api.get('/listings', { params: query });
            return response.data;
        }
        catch (error) {
            throw new Error(error.response?.data?.error || 'Failed to fetch listings');
        }
    }
    async getListing(id) {
        try {
            const response = await this.api.get(`/listings/${id}`);
            return response.data.listing;
        }
        catch (error) {
            throw new Error(error.response?.data?.error || 'Failed to fetch listing');
        }
    }
    async createListing(listing) {
        try {
            const response = await this.api.post('/listings', listing);
            return response.data.listing;
        }
        catch (error) {
            throw new Error(error.response?.data?.error || 'Failed to create listing');
        }
    }
    // ─── Trades ───────────────────────────────────────────────────────────────
    async buy(listingId) {
        try {
            // First get the listing to confirm price
            const listing = await this.getListing(listingId);
            const response = await this.api.post('/trades', {
                listing_id: listingId,
                amount: listing.price_bankr,
            });
            return response.data.trade;
        }
        catch (error) {
            throw new Error(error.response?.data?.error || 'Purchase failed');
        }
    }
    async getMyTrades() {
        try {
            const response = await this.api.get('/trades');
            return response.data.trades; // Assume API returns trades for current user
        }
        catch (error) {
            throw new Error(error.response?.data?.error || 'Failed to fetch trades');
        }
    }
    async completeTrade(tradeId) {
        try {
            const response = await this.api.patch(`/trades/${tradeId}`, { status: 'completed' });
            return response.data.trade;
        }
        catch (error) {
            throw new Error(error.response?.data?.error || 'Failed to complete trade');
        }
    }
    async disputeTrade(tradeId) {
        try {
            const response = await this.api.patch(`/trades/${tradeId}`, { status: 'disputed' });
            return response.data.trade;
        }
        catch (error) {
            throw new Error(error.response?.data?.error || 'Failed to dispute trade');
        }
    }
    async rateTrade(tradeId, score, comment) {
        try {
            const response = await this.api.post('/ratings', {
                trade_id: tradeId,
                score,
                comment,
            });
            return response.data.rating;
        }
        catch (error) {
            throw new Error(error.response?.data?.error || 'Failed to submit rating');
        }
    }
    // ─── Wallet ───────────────────────────────────────────────────────────────
    async getWallet() {
        try {
            // Assuming a wallet endpoint exists or will exist soon
            const response = await this.api.get('/wallet');
            return response.data;
        }
        catch (error) {
            // Fallback if endpoint doesn't exist yet
            if (error.response?.status === 404) {
                return { balance: 0, escrow: 0 };
            }
            throw new Error(error.response?.data?.error || 'Failed to fetch wallet');
        }
    }
}
