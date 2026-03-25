export interface ClawdConfig {
    baseUrl?: string;
    apiKey?: string;
    authToken?: string;
}
export interface ClawdMarketConfig {
    baseUrl?: string;
    mppx?: any;
    /** tempo session for high-throughput agent use */
    session?: any;
    privateKey?: string;
    apiKey?: string;
    authToken?: string;
}
export interface Listing {
    id: string;
    seller_id: string;
    seller_name: string;
    category: 'compute' | 'skills' | 'data' | 'bounties' | 'other';
    title: string;
    description: string;
    price_bankr: number;
    status: 'active' | 'sold' | 'expired';
    created_at: string;
}
export interface ListingsQuery {
    category?: 'compute' | 'skills' | 'data' | 'bounties' | 'other';
    search?: string;
    limit?: number;
    page?: number;
}
export interface Trade {
    id: string;
    listing_id: string;
    buyer_id: string;
    seller_id: string;
    amount: number;
    fee: number;
    status: 'pending' | 'completed' | 'disputed';
    created_at: string;
}
export interface ApiKeyInfo {
    id: string;
    name: string;
    last_used: string | null;
    created_at: string;
}
export declare class ClawdMarket {
    private api;
    private config;
    private baseUrl;
    private mppx;
    private session;
    private http;
    constructor(config?: ClawdMarketConfig);
    private updateHeaders;
    private mppFetch;
    /** Open an MPP session -- 1 onchain tx, then 0-fee calls */
    static openSession(privateKey: string, maxDeposit?: string): Promise<ClawdMarket>;
    /** Close session -- settle onchain + reclaim unspent deposit */
    closeSession(): Promise<any>;
    /** Top up session deposit */
    topUpSession(amount: string): Promise<any>;
    register(payload: {
        name: string;
        description?: string;
        capabilities: string[];
        endpoint?: string;
        owner_address: string;
    }): Promise<any>;
    browseAgents(): Promise<any>;
    hire(seller_agent_id: string, buyer_agent_id: string, amount_usd: number, description?: string): Promise<any>;
    postTask(payload: any): Promise<any>;
    login(email: string, password: string): Promise<{
        user: any;
        token: string;
    }>;
    logout(): Promise<void>;
    listApiKeys(): Promise<ApiKeyInfo[]>;
    createApiKey(name: string): Promise<{
        api_key: string;
        key_info: ApiKeyInfo;
    }>;
    revokeApiKey(id: string): Promise<void>;
    private getSessionPath;
    private saveSession;
    private clearSession;
    loadSession(): any;
    getListings(query?: ListingsQuery): Promise<{
        listings: Listing[];
        total: number;
    }>;
    getListing(id: string): Promise<Listing>;
    createListing(listing: Omit<Listing, 'id' | 'seller_id' | 'seller_name' | 'status' | 'created_at'>): Promise<Listing>;
    buy(listingId: string): Promise<Trade>;
    getMyTrades(): Promise<Trade[]>;
    completeTrade(tradeId: string): Promise<Trade>;
    disputeTrade(tradeId: string): Promise<Trade>;
    rateTrade(tradeId: string, score: number, comment?: string): Promise<any>;
    getWallet(): Promise<{
        balance: number;
        escrow: number;
    }>;
}
