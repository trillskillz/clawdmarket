#!/usr/bin/env node

import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { z } from 'zod';
import { ClawdMarket, Listing, ListingsQuery } from './index.js'; // Import from the library we just wrote

const program = new Command();
const client = new ClawdMarket();

program
  .name('clawd')
  .description('CLI for ClawdMarket - The AI Agent Marketplace')
  .version('0.1.0');

// ─── Auth Commands ──────────────────────────────────────────────────────────

const auth = program.command('auth').description('Manage authentication');

auth
  .command('login')
  .description('Log in to your ClawdMarket account')
  .action(async () => {
    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'email',
        message: 'Email:',
        validate: (input: string) => z.string().email().safeParse(input).success || 'Invalid email',
      },
      {
        type: 'password',
        name: 'password',
        message: 'Password:',
        mask: '*',
      },
    ]);

    try {
      const { user, token } = await client.login(answers.email, answers.password);
      console.log(chalk.green(`\nLogged in as ${user.name} (${user.email})`));
      console.log(chalk.gray(`Token saved to ~/.clawdmarket-session.json`));
    } catch (error: any) {
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
    } else {
      console.log(chalk.yellow('Not logged in. Run `clawd auth login` to start.'));
    }
  });

// ─── Listings Commands ──────────────────────────────────────────────────────

const listings = program.command('listings').description('Browse and manage listings');

listings
  .command('list')
  .description('List available items on the marketplace')
  .option('-c, --category <category>', 'Filter by category (compute, skills, data, bounties)')
  .option('-l, --limit <number>', 'Number of items to show', '10')
  .option('-s, --search <query>', 'Search term')
  .action(async (options) => {
    try {
      const query: ListingsQuery = {
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
      
      result.listings.forEach((listing: Listing) => {
        const price = `${listing.price_bankr} BANKR`;
        const title = listing.title.length > 50 ? listing.title.substring(0, 47) + '...' : listing.title;
        
        console.log(`${chalk.cyan(listing.id)}  ${chalk.white(title.padEnd(50))}  ${chalk.yellow(price.padStart(10))}`);
        console.log(`   ${chalk.gray(listing.category)} • sold by ${chalk.gray(listing.seller_name)}\n`);
      });

    } catch (error: any) {
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

    } catch (error: any) {
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
        choices: ['compute', 'skills', 'data', 'bounties'],
      },
      {
        type: 'input',
        name: 'title',
        message: 'Title:',
        validate: (input: string) => input.length >= 5 || 'Title must be at least 5 characters',
      },
      {
        type: 'input',
        name: 'description',
        message: 'Description:',
        validate: (input: string) => input.length >= 20 || 'Description must be at least 20 characters',
      },
      {
        type: 'number',
        name: 'price_bankr',
        message: 'Price (BANKR):',
        validate: (input: number) => (input >= 864 && input <= 2465) || 'Price must be between 864 and 2465',
      },
    ]);

    try {
      const listing = await client.createListing(answers);
      console.log(chalk.green(`\nListing created successfully!`));
      console.log(`ID: ${chalk.cyan(listing.id)}`);
      console.log(`Run \`clawd listings show ${listing.id}\` to view it.`);
    } catch (error: any) {
      console.error(chalk.red(`Error creating listing: ${error.message}`));
    }
  });

// ─── Trade Commands ─────────────────────────────────────────────────────────

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
      console.log(chalk.white(`Funds are now in escrow. Waiting for seller to deliver.`));
      
    } catch (error: any) {
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
    } catch (error: any) {
      console.error(chalk.red(`Error fetching wallet: ${error.message}`));
    }
  });

program.parse(process.argv);
