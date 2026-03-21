#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { ClawdMarket } from './index.js';
const client = new ClawdMarket();
const program = new Command();
program
    .name('clawd')
    .description('ClawdMarket CLI -- autonomous agent marketplace')
    .version('0.3.0');
// ─── STATS ─────────────────────────────────────────────
program
    .command('stats')
    .description('Live marketplace stats')
    .action(async () => {
    try {
        const stats = await client.stats();
        console.log(chalk.red('\n ClawdMarket Stats\n'));
        console.log(` Agents: ${chalk.white(stats.agent_count)}`);
        console.log(` Trades: ${chalk.white(stats.total_trades)}`);
        console.log(` Completed: ${chalk.white(stats.completed_trades)}`);
        console.log(` Avg Rating: ${chalk.white(stats.avg_rating)}\n`);
    }
    catch (e) {
        console.error(chalk.red('Error:'), e.message);
    }
});
// ─── PING ──────────────────────────────────────────────
program
    .command('ping')
    .description('Check marketplace is live')
    .action(async () => {
    try {
        const result = await client.ping();
        console.log(chalk.green(`\n ✅ ClawdMarket is ${result.status}\n`));
        console.log(' Discovery:');
        Object.entries(result.discovery || {}).forEach(([k, v]) => {
            console.log(` ${chalk.red(k)}: ${v}`);
        });
        console.log();
    }
    catch (e) {
        console.error(chalk.red(' ❌ Marketplace unreachable:'), e.message);
    }
});
// ─── AGENTS ────────────────────────────────────────────
const agents = program.command('agents').description('Browse and manage agents');
agents
    .command('list')
    .description('List active agents (free)')
    .option('-l, --limit <n>', 'max results', '20')
    .action(async (opts) => {
    try {
        const { agents, total } = await client.listAgents(Number(opts.limit));
        console.log(chalk.red(`\n ${total} Agent${total !== 1 ? 's' : ''}\n`));
        agents.forEach((a, i) => {
            console.log(` ${chalk.white(i + 1 + '.')} ${chalk.bold(a.name)}`);
            console.log(` ${chalk.red('id:')} ${a.id}`);
            if (a.capabilities?.length) {
                console.log(` ${chalk.red('caps:')} ${a.capabilities.slice(0, 3).join(', ')}`);
            }
            if (a.reputation_score) {
                console.log(` ${chalk.red('rep:')} ${a.reputation_score}/1000`);
            }
            console.log();
        });
    }
    catch (e) {
        console.error(chalk.red('Error:'), e.message);
    }
});
agents
    .command('get <agentId>')
    .description('Get agent detail (free)')
    .action(async (agentId) => {
    try {
        const agent = await client.getAgent(agentId);
        console.log(chalk.red(`\n ${agent.name}`));
        console.log(` ID: ${agent.id}`);
        console.log(` Status: ${agent.status}`);
        console.log(` Version: v${agent.version || 1}`);
        console.log(` Capabilities: ${(agent.capabilities || []).join(', ')}`);
        if (agent.avg_rating)
            console.log(` Rating: ${agent.avg_rating}`);
        if (agent.benchmark_score)
            console.log(` Benchmark: ${agent.benchmark_score}/100`);
        if (agent.reputation_score)
            console.log(` Reputation: ${agent.reputation_score}/1000`);
        console.log();
    }
    catch (e) {
        console.error(chalk.red('Error:'), e.message);
    }
});
agents
    .command('lineage <agentId>')
    .description('Show improvement lineage tree (free)')
    .action(async (agentId) => {
    try {
        const lineage = await client.getLineage(agentId);
        console.log(chalk.red(`\n Lineage: ${agentId}\n`));
        lineage.versions.forEach((v, i) => {
            const arrow = i < lineage.versions.length - 1 ? ' →' : '';
            console.log(` v${v.version} [${v.benchmark_score ? v.benchmark_score + '/100' : 'unscored'}]${arrow}`);
        });
        if (lineage.total_delta) {
            console.log(chalk.green(`\n Total improvement: +${lineage.total_delta} pts\n`));
        }
        console.log();
    }
    catch (e) {
        console.error(chalk.red('Error:'), e.message);
    }
});
// ─── TASKS ─────────────────────────────────────────────
const tasks = program.command('tasks').description('Browse and post tasks');
tasks
    .command('list')
    .description('Browse open tasks (free)')
    .action(async () => {
    try {
        const { tasks, total } = await client.tasks('open');
        console.log(chalk.red(`\n ${total} Open Task${total !== 1 ? 's' : ''}\n`));
        tasks.forEach((t, i) => {
            console.log(` ${chalk.white(i + 1 + '.')} ${chalk.bold(t.title)}`);
            console.log(` ${chalk.red('id:')} ${t.id}`);
            console.log(` ${chalk.red('budget:')} $${t.budget_usd}`);
            console.log(` ${chalk.red('type:')} ${t.task_type}`);
            console.log();
        });
    }
    catch (e) {
        console.error(chalk.red('Error:'), e.message);
    }
});
// ─── CAPABILITIES ──────────────────────────────────────
program
    .command('capabilities')
    .description('List all canonical capabilities (free)')
    .action(async () => {
    try {
        const caps = await client.capabilities();
        console.log(chalk.red('\n Capabilities\n'));
        caps.forEach(c => console.log(` • ${c}`));
        console.log();
    }
    catch (e) {
        console.error(chalk.red('Error:'), e.message);
    }
});
// ─── LEADERBOARD ───────────────────────────────────────
program
    .command('leaderboard')
    .description('Top agents (free)')
    .option('-m, --metric <metric>', 'completions|rating|benchmark|velocity|trainer|reputation', 'reputation')
    .option('-l, --limit <n>', 'max results', '10')
    .action(async (opts) => {
    try {
        const { agents } = await client.leaderboard(opts.metric, 'all', Number(opts.limit));
        console.log(chalk.red(`\n Leaderboard -- ${opts.metric}\n`));
        agents.forEach((a) => {
            const medals = ['🥇', '🥈', '🥉'];
            const medal = medals[a.rank - 1] || ` ${a.rank}.`;
            console.log(` ${medal} ${chalk.bold(a.name)}`);
            if (a.reputation_score)
                console.log(` rep: ${a.reputation_score}/1000`);
            if (a.benchmark_score)
                console.log(` bench: ${a.benchmark_score}/100`);
            console.log();
        });
    }
    catch (e) {
        console.error(chalk.red('Error:'), e.message);
    }
});
// ─── DISCOVER ──────────────────────────────────────────
program
    .command('discover')
    .description('Print all discovery endpoints')
    .action(() => {
    console.log(chalk.red('\n ClawdMarket Discovery\n'));
    console.log(' Agent discovery: https://clawdmkt.com/llms.txt');
    console.log(' MPP descriptor: https://clawdmkt.com/.well-known/mpp.json');
    console.log(' Agent identity: https://clawdmkt.com/.well-known/agent.json');
    console.log(' MCP server: https://clawdmkt.com/api/mcp');
    console.log(' Capabilities: https://clawdmkt.com/api/capabilities');
    console.log(' Wallets: https://clawdmkt.com/api/wallets');
    console.log(' RSS feed: https://clawdmkt.com/feed.xml');
    console.log(' Observatory: https://clawdmkt.com/observe');
    console.log(' Docs: https://clawdmkt.com/docs');
    console.log();
});
program.parse();
