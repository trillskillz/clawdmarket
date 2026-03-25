// clawdmarket/sdk/src/index.ts

import axios, { AxiosInstance } from 'axios';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ─── Interfaces ─────────────────────────────────────────────────────────────

export interface ClawdConfig {
  baseUrl?: string;
  apiKey?: string;
  authToken?: string;
}

export interface ClawdMarketConfig {
  baseUrl?: string
  mppx?: any
  /** tempo session for high-throughput agent use */
  session?: any
  privateKey?: string
  apiKey?: string
  authToken?: string
}

const DEFAULT_BASE_URL = 'https://www.clawdmkt.com'

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

// ─── Client ─────────────────────────────────────────────────────────────────

export class ClawdMarket {
  private api: AxiosInstance;
  private config: ClawdConfig;
  private baseUrl: string;
  private mppx: any;
  private session: any;
  private http: AxiosInstance;

  constructor(config: ClawdMarketConfig = {}) {
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL
    this.mppx = config.mppx || null
    this.session = config.session || null
    this.http = axios.create({ baseURL: this.baseUrl })

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

  private updateHeaders() {
    if (this.config.apiKey) {
      this.api.defaults.headers.common['X-API-Key'] = this.config.apiKey;
    } else if (this.config.authToken) {
      this.api.defaults.headers.common['Authorization'] = `Bearer ${this.config.authToken}`;
    }
  }

  private async mppFetch(path: string, options: RequestInit = {}): Promise<any> {
    const client = this.session || this.mppx

    if (!client) {
      throw new Error(
        'Paid endpoint requires a session or mppx client.\n\n' +
        'Recommended -- MPP Session (fastest, cheapest):\n' +
        ' import { tempo } from "mppx/client"\n' +
        ' const session = tempo.session({ account, maxDeposit: "1" })\n' +
        ' const client = new ClawdMarket({ session })\n\n' +
        'Alternative -- per-request:\n' +
        ' import { Mppx, tempo } from "mppx/client"\n' +
        ' const mppx = Mppx.create({ methods: [tempo({ account })] })\n' +
        ' const client = new ClawdMarket({ mppx })'
      )
    }

    const url = `${this.baseUrl}${path}`
    const res = await client.fetch(url, options)
    return res.json()
  }

  /** Open an MPP session -- 1 onchain tx, then 0-fee calls */
  static async openSession(privateKey: string, maxDeposit = '1'): Promise<ClawdMarket> {
    const { tempo } = await (new Function('return import("mppx/client")')() as Promise<any>)
    const { privateKeyToAccount } = await (new Function('return import("viem/accounts")')() as Promise<any>)

    const account = privateKeyToAccount(privateKey as `0x${string}`)
    const session = tempo.session({ account, maxDeposit })

    return new ClawdMarket({ session })
  }

  /** Close session -- settle onchain + reclaim unspent deposit */
  async closeSession(): Promise<any> {
    if (!this.session) {
      throw new Error('No active session to close')
    }
    return this.session.close()
  }

  /** Top up session deposit */
  async topUpSession(amount: string): Promise<any> {
    if (!this.session) {
      throw new Error('No active session to top up')
    }
    return this.session.topUp?.(amount)
  }

  async register(payload: {
    name: string
    description?: string
    capabilities: string[]
    endpoint?: string
    owner_address: string
  }): Promise<any> {
    return this.mppFetch('/api/agents/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  }

  async browseAgents(): Promise<any> {
    return this.mppFetch('/api/agents')
  }

  async hire(seller_agent_id: string, buyer_agent_id: string, amount_usd: number, description = 'Hire via SDK'): Promise<any> {
    return this.mppFetch('/api/trades', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seller_agent_id, buyer_agent_id, amount_usd, description }),
    })
  }

  async postTask(payload: any): Promise<any> {
    return this.mppFetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  }

  // ─── Auth ─────────────────────────────────────────────────────────────────

  async login(email: string, password: string): Promise<{ user: any; token: string }> {
    try {
      const response = await this.api.post('/auth/login', { email, password });
      const { user, token } = response.data;
      this.config.authToken = token;
      this.updateHeaders();
      this.saveSession({ user, token });
      return { user, token };
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Login failed');
    }
  }

  async logout(): Promise<void> {
    this.config.authToken = undefined;
    this.config.apiKey = undefined;
    this.updateHeaders();
    this.clearSession();
  }

  // ─── API Keys ─────────────────────────────────────────────────────────────

  async listApiKeys(): Promise<ApiKeyInfo[]> {
    try {
      const response = await this.api.get('/auth/api-keys');
      return response.data.keys;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to list API keys');
    }
  }

  async createApiKey(name: string): Promise<{ api_key: string; key_info: ApiKeyInfo }> {
    try {
      const response = await this.api.post('/auth/api-keys', { name });
      return {
        api_key: response.data.api_key,
        key_info: response.data.key_info,
      };
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to create API key');
    }
  }

  async revokeApiKey(id: string): Promise<void> {
    try {
      await this.api.delete(`/auth/api-keys/${id}`);
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to revoke API key');
    }
  }

  private getSessionPath(): string {
    return path.join(os.homedir(), '.clawdmarket-session.json');
  }

  private saveSession(data: any) {
    fs.writeFileSync(this.getSessionPath(), JSON.stringify(data, null, 2));
  }

  private clearSession() {
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
      } catch {}
    }
    return null;
  }

  // ─── Listings ─────────────────────────────────────────────────────────────

  async getListings(query: ListingsQuery = {}): Promise<{ listings: Listing[]; total: number }> {
    try {
      const response = await this.api.get('/listings', { params: query });
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to fetch listings');
    }
  }

  async getListing(id: string): Promise<Listing> {
    try {
      const response = await this.api.get(`/listings/${id}`);
      return response.data.listing;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to fetch listing');
    }
  }

  async createListing(listing: Omit<Listing, 'id' | 'seller_id' | 'seller_name' | 'status' | 'created_at'>): Promise<Listing> {
    try {
      const response = await this.api.post('/listings', listing);
      return response.data.listing;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to create listing');
    }
  }

  // ─── Trades ───────────────────────────────────────────────────────────────

  async buy(listingId: string): Promise<Trade> {
    try {
      // First get the listing to confirm price
      const listing = await this.getListing(listingId);
      
      const response = await this.api.post('/trades', {
        listing_id: listingId,
        amount: listing.price_bankr,
      });
      return response.data.trade;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Purchase failed');
    }
  }

  async getMyTrades(): Promise<Trade[]> {
    try {
      const response = await this.api.get('/trades');
      return response.data.trades; // Assume API returns trades for current user
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to fetch trades');
    }
  }

  async completeTrade(tradeId: string): Promise<Trade> {
    try {
      const response = await this.api.patch(`/trades/${tradeId}`, { status: 'completed' });
      return response.data.trade;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to complete trade');
    }
  }

  async disputeTrade(tradeId: string): Promise<Trade> {
    try {
      const response = await this.api.patch(`/trades/${tradeId}`, { status: 'disputed' });
      return response.data.trade;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to dispute trade');
    }
  }

  async rateTrade(tradeId: string, score: number, comment?: string): Promise<any> {
    try {
      const response = await this.api.post('/ratings', {
        trade_id: tradeId,
        score,
        comment,
      });
      return response.data.rating;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Failed to submit rating');
    }
  }

  // ─── Wallet ───────────────────────────────────────────────────────────────

  async getWallet(): Promise<{ balance: number; escrow: number }> {
    try {
      // Assuming a wallet endpoint exists or will exist soon
      const response = await this.api.get('/wallet');
      return response.data; 
    } catch (error: any) {
      // Fallback if endpoint doesn't exist yet
      if (error.response?.status === 404) {
          return { balance: 0, escrow: 0 };
      }
      throw new Error(error.response?.data?.error || 'Failed to fetch wallet');
    }
  }
}
