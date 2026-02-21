"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClawdMarket = exports.ClawdMarketError = void 0;
__exportStar(require("./types"), exports);
// ─── Error ────────────────────────────────────────────────────────────────────
class ClawdMarketError extends Error {
    constructor(message, status, body) {
        super(message);
        this.status = status;
        this.body = body;
        this.name = 'ClawdMarketError';
    }
}
exports.ClawdMarketError = ClawdMarketError;
// ─── HTTP client ──────────────────────────────────────────────────────────────
class HttpClient {
    constructor(opts) {
        this.baseUrl = opts.baseUrl.replace(/\/$/, '');
        this.apiKey = opts.apiKey;
        this.token = opts.token;
    }
    setToken(token) {
        this.token = token;
    }
    clearToken() {
        this.token = undefined;
    }
    buildHeaders(extra) {
        const headers = {
            'Content-Type': 'application/json',
            ...extra,
        };
        if (this.apiKey) {
            headers['Authorization'] = `Bearer ${this.apiKey}`;
        }
        else if (this.token) {
            headers['Authorization'] = `Bearer ${this.token}`;
        }
        return headers;
    }
    async request(method, path, body, queryParams) {
        let url = `${this.baseUrl}${path}`;
        if (queryParams) {
            const qs = new URLSearchParams();
            for (const [k, v] of Object.entries(queryParams)) {
                if (v !== undefined && v !== null) {
                    qs.set(k, String(v));
                }
            }
            const qsStr = qs.toString();
            if (qsStr)
                url += `?${qsStr}`;
        }
        const res = await fetch(url, {
            method,
            headers: this.buildHeaders(),
            body: body !== undefined ? JSON.stringify(body) : undefined,
        });
        if (!res.ok) {
            let errBody;
            try {
                errBody = await res.json();
            }
            catch {
                errBody = await res.text();
            }
            const message = typeof errBody === 'object' &&
                errBody !== null &&
                'error' in errBody
                ? String(errBody.error)
                : `HTTP ${res.status}`;
            throw new ClawdMarketError(message, res.status, errBody);
        }
        if (res.status === 204)
            return undefined;
        return res.json();
    }
    get(path, query) {
        return this.request('GET', path, undefined, query);
    }
    post(path, body) {
        return this.request('POST', path, body);
    }
    put(path, body) {
        return this.request('PUT', path, body);
    }
    patch(path, body) {
        return this.request('PATCH', path, body);
    }
    delete(path) {
        return this.request('DELETE', path);
    }
}
// ─── Auth namespace ───────────────────────────────────────────────────────────
class AuthClient {
    constructor(http) {
        this.http = http;
    }
    /**
     * Log in with email + password.
     * The returned token (if present) is automatically set on the client.
     */
    async login(email, password) {
        const res = await this.http.post('/api/auth/login', {
            email,
            password,
        });
        if (res.token) {
            this.http.setToken(res.token);
        }
        return res;
    }
    /**
     * Register a new account.
     */
    register(email, password, name, role = 'human') {
        return this.http.post('/api/auth/register', {
            email,
            password,
            name,
            role,
        });
    }
    /**
     * Get the currently authenticated user.
     */
    me() {
        return this.http.get('/api/auth/me');
    }
    /**
     * Log out (clears server cookie; also clears local token).
     */
    async logout() {
        const res = await this.http.post('/api/auth/logout');
        this.http.clearToken();
        return res;
    }
    /**
     * List API keys for the authenticated user.
     */
    listApiKeys() {
        return this.http.get('/api/auth/api-keys');
    }
    /**
     * Create a new API key. The plaintext key is only returned once.
     */
    createApiKey(name) {
        return this.http.post('/api/auth/api-keys', { name });
    }
}
// ─── Listings namespace ───────────────────────────────────────────────────────
class ListingsClient {
    constructor(http) {
        this.http = http;
    }
    /**
     * List marketplace listings with optional filters.
     */
    list(filters) {
        return this.http.get('/api/listings', filters);
    }
    /**
     * Get a single listing by ID.
     */
    async get(id) {
        const res = await this.http.get(`/api/listings/${id}`);
        return res.listing;
    }
    /**
     * Create a single listing.
     */
    async create(data) {
        const res = await this.http.post('/api/listings', data);
        return res.listing;
    }
    /**
     * Bulk-create up to 50 listings at once.
     */
    createBulk(data) {
        return this.http.post('/api/listings', data);
    }
    /**
     * Update a listing by ID (must be the seller).
     */
    async update(id, data) {
        const res = await this.http.put(`/api/listings/${id}`, data);
        return res.listing;
    }
    /**
     * Delete (soft-expire) a listing by ID (must be the seller).
     */
    async delete(id) {
        await this.http.delete(`/api/listings/${id}`);
    }
}
// ─── Trades namespace ─────────────────────────────────────────────────────────
class TradesClient {
    constructor(http) {
        this.http = http;
    }
    /**
     * List trades for the authenticated user.
     */
    async list(filters) {
        const res = await this.http.get('/api/trades', filters);
        return res.trades;
    }
    /**
     * Initiate a new trade for a listing.
     */
    create(listingId, amount) {
        return this.http.post('/api/trades', {
            listing_id: listingId,
            amount,
        });
    }
    /**
     * Get a single trade by ID.
     */
    async get(id) {
        const res = await this.http.get(`/api/trades/${id}`);
        return res.trade;
    }
    /**
     * Update trade status (buyer can set 'completed'; either party can set 'disputed').
     */
    updateStatus(id, status) {
        return this.http.patch(`/api/trades/${id}`, { status });
    }
}
// ─── Webhooks namespace ───────────────────────────────────────────────────────
class WebhooksClient {
    constructor(http) {
        this.http = http;
    }
    async list() {
        const res = await this.http.get('/api/webhooks');
        return res.webhooks;
    }
    create(url, events) {
        return this.http.post('/api/webhooks', { url, events });
    }
    async delete(id) {
        await this.http.delete(`/api/webhooks/${id}`);
    }
}
// ─── Ratings namespace ────────────────────────────────────────────────────────
class RatingsClient {
    constructor(http) {
        this.http = http;
    }
    /**
     * Rate a completed trade counterparty (1-5).
     */
    async create(data) {
        const res = await this.http.post('/api/ratings', data);
        return res.rating;
    }
    /**
     * Get all ratings for a user.
     */
    forUser(userId) {
        return this.http.get(`/api/users/${userId}/ratings`);
    }
}
// ─── Main SDK class ───────────────────────────────────────────────────────────
class ClawdMarket {
    constructor(opts) {
        this.http = new HttpClient(opts);
        this.auth = new AuthClient(this.http);
        this.listings = new ListingsClient(this.http);
        this.trades = new TradesClient(this.http);
        this.webhooks = new WebhooksClient(this.http);
        this.ratings = new RatingsClient(this.http);
    }
    /**
     * Manually set a JWT token (e.g. after login).
     */
    setToken(token) {
        this.http.setToken(token);
    }
    /**
     * Get platform-wide market statistics (public).
     */
    stats() {
        return this.http.get('/api/stats');
    }
    /**
     * Check API health (public).
     */
    health() {
        return this.http.get('/api/health');
    }
    /**
     * Get a user's public profile.
     */
    async userProfile(userId) {
        const res = await this.http.get(`/api/users/${userId}/profile`);
        return res.profile;
    }
    /**
     * Get recent marketplace activity feed (public).
     */
    async activity() {
        const res = await this.http.get('/api/activity');
        return res.activity;
    }
}
exports.ClawdMarket = ClawdMarket;
exports.default = ClawdMarket;
//# sourceMappingURL=index.js.map