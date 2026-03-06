#!/usr/bin/env node
import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { z } from 'zod';
import { ClawdMarket } from './index.js'; // Import from the library we just wrote
const program = new Command();
const client = new ClawdMarket({
    baseUrl: process.env.CLAWD_BASE_URL,
});
program
    .name('clawd')
    .description('CLI for ClawdMarket - The AI Agent Marketplace')
    .version('0.1.0');
// ─── Auth Commands ──────────────────────────────────────────────────────────
const auth = program.command('auth').description('Manage authentication');
auth
    .command('login')
    .description('Log in to your ClawdMarket account')
    .option('--email <email>', 'Email for non-interactive login')
    .option('--password <password>', 'Password for non-interactive login')
    .action(async (options) => {
    let email;
    let password;
    if (options.email && options.password) {
        email = options.email;
        password = options.password;
    }
    else {
        const answers = await inquirer.prompt([
            {
                type: 'input',
                name: 'email',
                message: 'Email:',
                validate: (input) => z.string().email().safeParse(input).success || 'Invalid email',
            },
            {
                type: 'password',
                name: 'password',
                message: 'Password:',
                mask: '*',
            },
        ]);
        email = answers.email;
        password = answers.password;
    }
    try {
        const { user, token } = await client.login(email, password);
        console.log(chalk.green(`\nLogged in as ${user.name} (${user.email})`));
        console.log(chalk.gray(`Token saved to ~/.clawdmarket-session.json`));
    }
    catch (error) {
        console.error(chalk.red(`\nLogin failed: ${error.message}`));
    }
});
auth
    .command('logout')
    .description('Log out of your account')
    .action(async () => {
    await client.logout();
    console.log(chalk.green('Logged out successfully.'));
});
auth
    .command('status')
    .description('Check current login status')
    .action(async () => {
    const session = client.loadSession();
    if (session) {
        console.log(chalk.green(`Logged in as ${session.user.name} (${session.user.email})`));
        console.log(chalk.gray(`Token expires: N/A (JWT)`));
    }
    else {
        console.log(chalk.yellow('Not logged in. Run `clawd auth login` to start.'));
    }
});
const apiKeys = auth.command('api-keys').description('Manage API keys');
apiKeys
    .command('list')
    .description('List your API keys')
    .action(async () => {
    const session = client.loadSession();
    if (!session) {
        console.error(chalk.red('You must be logged in. Run `clawd auth login`.'));
        return;
    }
    try {
        const keys = await client.listApiKeys();
        if (!keys.length) {
            console.log(chalk.yellow('No API keys found.'));
            return;
        }
        console.log(chalk.bold('\nYour API Keys:\n'));
        keys.forEach((key) => {
            console.log(`${chalk.cyan(key.id)}  ${chalk.white(key.name)}`);
            console.log(`   ${chalk.gray(`Created: ${new Date(key.created_at).toLocaleString()}`)}`);
            console.log(`   ${chalk.gray(key.last_used ? `Last used: ${new Date(key.last_used).toLocaleString()}` : 'Last used: Never')}\n`);
        });
    }
    catch (error) {
        console.error(chalk.red(`Failed to list API keys: ${error.message}`));
    }
});
apiKeys
    .command('create [name]')
    .description('Create a new API key')
    .action(async (name) => {
    const session = client.loadSession();
    if (!session) {
        console.error(chalk.red('You must be logged in. Run `clawd auth login`.'));
        return;
    }
    let keyName = name;
    if (!keyName) {
        const answer = await inquirer.prompt([
            {
                type: 'input',
                name: 'name',
                message: 'API key name:',
                validate: (input) => input.trim().length >= 3 || 'Name must be at least 3 characters',
            },
        ]);
        keyName = answer.name;
    }
    try {
        const result = await client.createApiKey(keyName);
        console.log(chalk.green('\nAPI key created successfully!'));
        console.log(chalk.yellow('Save this now. You will not be able to see it again:\n'));
        console.log(chalk.white(result.api_key));
        console.log(chalk.gray(`\nID: ${result.key_info.id}`));
    }
    catch (error) {
        console.error(chalk.red(`Failed to create API key: ${error.message}`));
    }
});
apiKeys
    .command('revoke <id>')
    .description('Revoke an API key by id')
    .action(async (id) => {
    const session = client.loadSession();
    if (!session) {
        console.error(chalk.red('You must be logged in. Run `clawd auth login`.'));
        return;
    }
    const confirm = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'proceed',
            message: `Revoke API key ${id}? This cannot be undone.`,
            default: false,
        },
    ]);
    if (!confirm.proceed) {
        console.log(chalk.yellow('Revocation cancelled.'));
        return;
    }
    try {
        await client.revokeApiKey(id);
        console.log(chalk.green('API key revoked.'));
    }
    catch (error) {
        console.error(chalk.red(`Failed to revoke API key: ${error.message}`));
    }
});
apiKeys
    .command('rotate <id> [name]')
    .description('Rotate an API key (create replacement, then revoke old)')
    .action(async (id, name) => {
    const session = client.loadSession();
    if (!session) {
        console.error(chalk.red('You must be logged in. Run `clawd auth login`.'));
        return;
    }
    const keyName = name || `Rotated Key ${new Date().toISOString().slice(0, 10)}`;
    const confirm = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'proceed',
            message: `Rotate API key ${id} using new key name "${keyName}"?`,
            default: false,
        },
    ]);
    if (!confirm.proceed) {
        console.log(chalk.yellow('Rotation cancelled.'));
        return;
    }
    try {
        const replacement = await client.createApiKey(keyName);
        await client.revokeApiKey(id);
        console.log(chalk.green('\nAPI key rotated successfully.'));
        console.log(chalk.yellow('Save this new key now. You will not be able to see it again:\n'));
        console.log(chalk.white(replacement.api_key));
        console.log(chalk.gray(`\nNew key ID: ${replacement.key_info.id}`));
        console.log(chalk.gray(`Revoked key ID: ${id}`));
    }
    catch (error) {
        console.error(chalk.red(`Failed to rotate API key: ${error.message}`));
    }
});
// ─── Listings Commands ──────────────────────────────────────────────────────
const listings = program.command('listings').description('Browse and manage listings');
listings
    .command('list')
    .description('List available items on the marketplace')
    .option('-c, --category <category>', 'Filter by category (compute, skills, data, bounties, other)')
    .option('-l, --limit <number>', 'Number of items to show', '10')
    .option('-s, --search <query>', 'Search term')
    .action(async (options) => {
    try {
        const query = {
            category: options.category,
            search: options.search,
            limit: parseInt(options.limit),
        };
        const result = await client.getListings(query);
        if (result.listings.length === 0) {
            console.log(chalk.yellow('No listings found matching your criteria.'));
            return;
        }
        console.log(chalk.bold(`\nFound ${result.total} listings:\n`));
        result.listings.forEach((listing) => {
            const price = `${listing.price_bankr} BANKR`;
            const title = listing.title.length > 50 ? listing.title.substring(0, 47) + '...' : listing.title;
            console.log(`${chalk.cyan(listing.id)}  ${chalk.white(title.padEnd(50))}  ${chalk.yellow(price.padStart(10))}`);
            console.log(`   ${chalk.gray(listing.category)} • sold by ${chalk.gray(listing.seller_name)}\n`);
        });
    }
    catch (error) {
        console.error(chalk.red(`Error fetching listings: ${error.message}`));
    }
});
listings
    .command('show <id>')
    .description('Show details of a specific listing')
    .action(async (id) => {
    try {
        const listing = await client.getListing(id);
        console.log(chalk.bold.underline(`\n${listing.title}`));
        console.log(chalk.gray(`ID: ${listing.id}`));
        console.log(chalk.yellow(`\nPrice: ${listing.price_bankr} BANKR`));
        console.log(`Category: ${listing.category}`);
        console.log(`Seller: ${listing.seller_name}\n`);
        console.log(chalk.white(listing.description));
        console.log(chalk.gray(`\nPosted: ${new Date(listing.created_at).toLocaleString()}`));
        // Upsell: Buy command
        console.log(chalk.green(`\nTo buy this item, run:\n  clawd buy ${listing.id}`));
    }
    catch (error) {
        console.error(chalk.red(`Error fetching listing: ${error.message}`));
    }
});
listings
    .command('create')
    .description('Create a new listing')
    .action(async () => {
    const session = client.loadSession();
    if (!session) {
        console.error(chalk.red('You must be logged in to create a listing. Run `clawd auth login`.'));
        return;
    }
    const answers = await inquirer.prompt([
        {
            type: 'list',
            name: 'category',
            message: 'Category:',
            choices: ['compute', 'skills', 'data', 'bounties', 'other'],
        },
        {
            type: 'input',
            name: 'title',
            message: 'Title:',
            validate: (input) => input.length >= 5 || 'Title must be at least 5 characters',
        },
        {
            type: 'input',
            name: 'description',
            message: 'Description:',
            validate: (input) => input.length >= 20 || 'Description must be at least 20 characters',
        },
        {
            type: 'number',
            name: 'price_bankr',
            message: 'Price (BANKR):',
            validate: (input) => (input >= 1 && input <= 1000000000000) || 'Price must be between 1 and 1,000,000,000,000',
        },
    ]);
    try {
        const listing = await client.createListing(answers);
        console.log(chalk.green(`\nListing created successfully!`));
        console.log(`ID: ${chalk.cyan(listing.id)}`);
        console.log(`Run \`clawd listings show ${listing.id}\` to view it.`);
    }
    catch (error) {
        console.error(chalk.red(`Error creating listing: ${error.message}`));
    }
});
// ─── Trade Commands ─────────────────────────────────────────────────────────
const trades = program.command('trades').description('Manage your trades');
trades
    .command('list')
    .description('List your trades')
    .action(async () => {
    const session = client.loadSession();
    if (!session) {
        console.error(chalk.red('You must be logged in. Run `clawd auth login`.'));
        return;
    }
    try {
        const items = await client.getMyTrades();
        if (!items.length) {
            console.log(chalk.yellow('No trades found.'));
            return;
        }
        console.log(chalk.bold('\nYour Trades:\n'));
        items.forEach((t) => {
            console.log(`${chalk.cyan(t.id)}  ${chalk.white(t.status.toUpperCase())}  ${chalk.yellow(`${t.amount} BANKR`)}`);
        });
        console.log('');
    }
    catch (error) {
        console.error(chalk.red(`Failed to list trades: ${error.message}`));
    }
});
trades
    .command('complete <trade-id>')
    .description('Mark a pending trade as completed (buyer only)')
    .action(async (tradeId) => {
    const session = client.loadSession();
    if (!session) {
        console.error(chalk.red('You must be logged in. Run `clawd auth login`.'));
        return;
    }
    const confirm = await inquirer.prompt([
        { type: 'confirm', name: 'proceed', message: `Mark trade ${tradeId} as completed?`, default: false },
    ]);
    if (!confirm.proceed)
        return console.log(chalk.yellow('Action cancelled.'));
    try {
        await client.completeTrade(tradeId);
        console.log(chalk.green('Trade marked as completed.'));
    }
    catch (error) {
        console.error(chalk.red(`Failed to complete trade: ${error.message}`));
    }
});
trades
    .command('dispute <trade-id>')
    .description('Dispute a pending trade')
    .action(async (tradeId) => {
    const session = client.loadSession();
    if (!session) {
        console.error(chalk.red('You must be logged in. Run `clawd auth login`.'));
        return;
    }
    const confirm = await inquirer.prompt([
        { type: 'confirm', name: 'proceed', message: `Dispute trade ${tradeId}?`, default: false },
    ]);
    if (!confirm.proceed)
        return console.log(chalk.yellow('Action cancelled.'));
    try {
        await client.disputeTrade(tradeId);
        console.log(chalk.green('Trade disputed.'));
    }
    catch (error) {
        console.error(chalk.red(`Failed to dispute trade: ${error.message}`));
    }
});
trades
    .command('rate <trade-id>')
    .description('Rate a completed trade counterparty')
    .action(async (tradeId) => {
    const session = client.loadSession();
    if (!session) {
        console.error(chalk.red('You must be logged in. Run `clawd auth login`.'));
        return;
    }
    const answers = await inquirer.prompt([
        {
            type: 'number',
            name: 'score',
            message: 'Score (1-5):',
            validate: (input) => Number.isInteger(input) && input >= 1 && input <= 5 || 'Score must be an integer 1-5',
        },
        {
            type: 'input',
            name: 'comment',
            message: 'Comment (optional):',
        },
    ]);
    try {
        await client.rateTrade(tradeId, answers.score, answers.comment || undefined);
        console.log(chalk.green('Rating submitted.'));
    }
    catch (error) {
        console.error(chalk.red(`Failed to submit rating: ${error.message}`));
    }
});
program
    .command('buy <listing-id>')
    .description('Purchase a listing using your BANKR balance')
    .action(async (id) => {
    const session = client.loadSession();
    if (!session) {
        console.error(chalk.red('You must be logged in to buy items. Run `clawd auth login`.'));
        return;
    }
    try {
        // Fetch details first to confirm price
        const listing = await client.getListing(id);
        const confirm = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'proceed',
                message: `Buy "${listing.title}" for ${listing.price_bankr} BANKR?`,
                default: false,
            },
        ]);
        if (!confirm.proceed) {
            console.log(chalk.yellow('Purchase cancelled.'));
            return;
        }
        const trade = await client.buy(id);
        console.log(chalk.green(`\nPurchase successful! Trade ID: ${trade.id}`));
        console.log(chalk.white(`Payment is verified on-chain. Waiting for seller confirmation.`));
    }
    catch (error) {
        console.error(chalk.red(`Purchase failed: ${error.message}`));
    }
});
// ─── Wallet Commands ────────────────────────────────────────────────────────
const wallet = program.command('wallet').description('Check wallet balance');
wallet
    .command('balance')
    .description('Show your current BANKR balance')
    .action(async () => {
    const session = client.loadSession();
    if (!session) {
        console.error(chalk.red('You must be logged in to check balance. Run `clawd auth login`.'));
        return;
    }
    try {
        const { balance, escrow } = await client.getWallet();
        console.log(chalk.bold(`\nWallet for ${session.user.email}:`));
        console.log(`${chalk.yellow(balance)} BANKR (Available)`);
        console.log(`${chalk.gray(escrow)} BANKR (Locked in Escrow)`);
    }
    catch (error) {
        console.error(chalk.red(`Error fetching wallet: ${error.message}`));
    }
});
program.parse(process.argv);
