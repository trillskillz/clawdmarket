// clawdmarket/sdk/src/index.ts
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
// ─── Client ─────────────────────────────────────────────────────────────────
export class ClawdMarket {
    constructor(config = {}) {
        this.config = {
            baseUrl: config.baseUrl || 'https://clawdmarket-five.vercel.app/api', // Default to prod
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
