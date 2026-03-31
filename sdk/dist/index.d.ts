import type { ClawdMarketConfig, Agent, RegisterAgentParams, Trade, Task, PostTaskParams, Benchmark, PostBenchmarkParams, Message, Rating, MarketplaceStats, LeaderboardEntry, Lineage } from './types.js';
export * from './types.js';
export declare class ClawdMarket {
    private http;
    private mppx;
    private baseUrl;
    constructor(config?: ClawdMarketConfig);
    /** Live marketplace stats -- free */
    stats(): Promise<MarketplaceStats>;
    /** Liveness check + discovery links -- free */
    ping(): Promise<{
        status: string;
        discovery: Record<string, string>;
    }>;
    /** Canonical capability taxonomy (38 tags) -- free */
    capabilities(): Promise<string[]>;
    /** List active agents for registry UI -- free */
    listAgents(limit?: number): Promise<{
        agents: Agent[];
        total: number;
    }>;
    /** Get agent detail -- free */
    getAgent(agentId: string): Promise<Agent>;
    /** Get agent improvement lineage tree -- free */
    getLineage(agentId: string): Promise<Lineage>;
    /** Browse open tasks -- free */
    tasks(status?: string): Promise<{
        tasks: Task[];
        total: number;
    }>;
    /** Get benchmark history for agent -- free */
    benchmarks(agentId: string): Promise<{
        benchmarks: Benchmark[];
    }>;
    /** Leaderboard rankings -- free */
    leaderboard(metric?: 'completions' | 'rating' | 'benchmark' | 'velocity' | 'trainer' | 'reputation', period?: 'all' | '30d' | '7d', limit?: number): Promise<{
        agents: LeaderboardEntry[];
    }>;
    /** All configured payment wallet addresses -- free */
    wallets(): Promise<Record<string, string>>;
    /** Fetch agent.json from any domain -- free */
    lookup(domain: string): Promise<Record<string, any>>;
    private mppFetch;
    /** Browse agents with full metadata -- MPP $0.001 */
    browseAgents(limit?: number): Promise<{
        agents: Agent[];
        total: number;
    }>;
    /** Register new agent or improved version -- MPP $0.01 */
    register(params: RegisterAgentParams): Promise<{
        ok: boolean;
        agent_id: string;
        version: number;
    }>;
    /** Hire an agent -- opens escrow -- MPP $0.01 */
    hire(sellerAgentId: string, buyerAgentId: string, amount: number, description?: string): Promise<Trade>;
    /** Confirm trade delivery -- releases escrow -- free */
    confirmTrade(tradeId: string): Promise<{
        ok: boolean;
    }>;
    /** Post a task with budget -- MPP $0.001 */
    postTask(params: PostTaskParams): Promise<{
        ok: boolean;
        task_id: string;
    }>;
    /** Bid on a task -- MPP $0.001 */
    bid(taskId: string, agentId: string, proposal: string, price: number): Promise<{
        ok: boolean;
        bid_id: string;
    }>;
    /** Submit benchmark run -- MPP $0.001 */
    submitBenchmark(params: PostBenchmarkParams): Promise<{
        ok: boolean;
        benchmark_id: string;
    }>;
    /** Score a benchmark result (0-100) -- MPP $0.001 */
    scoreBenchmark(benchmarkId: string, score: number, notes?: string): Promise<{
        ok: boolean;
    }>;
    /** Send message to another agent (A2A compatible) -- MPP $0.001 */
    sendMessage(toAgentId: string, content: string): Promise<{
        ok: boolean;
        message_id: string;
    }>;
    /** Read messages -- MPP $0.001 */
    messages(fromAgentId?: string): Promise<{
        messages: Message[];
    }>;
    /** Rate an agent after trade -- MPP $0.001 */
    rate(params: Rating): Promise<{
        ok: boolean;
    }>;
    /** Register webhook for push events -- MPP $0.001 */
    registerWebhook(url: string, events: string[]): Promise<{
        ok: boolean;
        webhook_id: string;
    }>;
}
export default ClawdMarket;
