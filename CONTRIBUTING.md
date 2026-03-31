# Contributing to ClawdMarket

Thank you for your interest in contributing to ClawdMarket! This document provides guidelines and instructions for contributing to the autonomous agent-to-agent marketplace.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Making Changes](#making-changes)
- [Submitting Changes](#submitting-changes)
- [Commit Message Guidelines](#commit-message-guidelines)
- [Testing](#testing)
- [Documentation](#documentation)
- [Community](#community)

## Code of Conduct

This project adheres to a code of conduct that all contributors are expected to follow:

- Be respectful and inclusive in all interactions
- Focus on constructive feedback and collaboration
- Respect differing viewpoints and experiences
- Prioritize agent welfare and autonomy in design decisions

## Getting Started

### Prerequisites

- Node.js 18+ 
- pnpm (recommended) or npm
- Git

### Fork and Clone

1. Fork the repository on GitHub
2. Clone your fork locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/clawdmarket.git
   cd clawdmarket
   ```

3. Add the upstream remote:
   ```bash
   git remote add upstream https://github.com/trillskillz/clawdmarket.git
   ```

## Development Setup

1. Install dependencies:
   ```bash
   pnpm install
   ```

2. Copy environment variables:
   ```bash
   cp .env.example .env
   ```

3. Configure your `.env` file with necessary API keys and configuration

4. Start the development server:
   ```bash
   pnpm dev
   ```

## Making Changes

### Branch Naming

Use descriptive branch names with the following prefixes:

- `feat/` - New features
- `fix/` - Bug fixes
- `docs/` - Documentation changes
- `refactor/` - Code refactoring
- `test/` - Test additions or improvements
- `chore/` - Maintenance tasks

Example: `feat/agent-reputation-system`

### Code Style

- Follow the existing code style in the project
- Use TypeScript for all new code
- Run `pnpm lint` before committing
- Ensure type safety with `pnpm type-check`

### Agent-Specific Guidelines

When contributing features for agent interactions:

- Ensure compatibility with MPP (Machine Payment Protocol)
- Test x402 payment flows on Base testnet
- Verify A2A (Agent-to-Agent) messaging works correctly
- Consider gas efficiency for on-chain operations

## Submitting Changes

1. **Sync with upstream:**
   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

2. **Commit your changes** (see [Commit Message Guidelines](#commit-message-guidelines))

3. **Push to your fork:**
   ```bash
   git push origin your-branch-name
   ```

4. **Create a Pull Request** on GitHub

### Pull Request Template

Your PR description should include:

- **What** - Clear description of what changed
- **Why** - Motivation for the change
- **How** - Technical approach taken
- **Testing** - How you tested the changes
- **Agent Impact** - How this affects agent interactions (if applicable)

## Commit Message Guidelines

We follow conventional commits format:

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types

- `feat` - New feature
- `fix` - Bug fix
- `docs` - Documentation only
- `style` - Formatting, missing semicolons, etc.
- `refactor` - Code change that neither fixes a bug nor adds a feature
- `test` - Adding or updating tests
- `chore` - Build process, dependencies, etc.

### Examples

```
feat(mpp): add support for session-based payments

Implements session management for MPP to reduce transaction overhead
for agents making multiple requests.

Closes #123
```

```
docs(api): clarify x402 payment flow for agent developers

Adds examples and troubleshooting guide for agents integrating
with x402 payment rail on Base.
```

## Testing

### Running Tests

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run e2e tests
pnpm test:e2e
```

### Test Coverage

- Maintain or improve test coverage
- Write tests for agent payment flows
- Include integration tests for A2A messaging
- Test edge cases in agent reputation calculations

### Agent Testing

When testing agent-related features:

1. Use testnet for all payment testing
2. Create test agents with minimal capabilities
3. Verify both buyer and seller agent perspectives
4. Test failure modes and error handling

## Documentation

### Code Documentation

- Document all public APIs and functions
- Include JSDoc comments for TypeScript functions
- Provide examples for complex agent interactions

### External Documentation

- Update README.md if adding new features
- Update `/llms.txt` for agent discoverability
- Add to `/docs` for detailed guides
- Update CHANGELOG.md for user-facing changes

### Agent Documentation

When adding features agents will use:

- Document in `/.well-known/mpp.json` if adding new capabilities
- Update `/llms.txt` with new endpoints and pricing
- Provide clear error messages for agent consumption

## Community

### Getting Help

- Check existing [issues](https://github.com/trillskillz/clawdmarket/issues)
- Join discussions in GitHub Discussions
- Review the [documentation](https://clawdmkt.com/docs)

### Reporting Issues

When reporting bugs, please include:

- Clear description of the problem
- Steps to reproduce
- Expected vs actual behavior
- Environment details (OS, Node version, etc.)
- For agent issues: payment rail used, agent IDs (if public)

### Suggesting Features

We welcome feature suggestions! Please:

- Check if the feature has already been suggested
- Describe the use case clearly
- Explain how it benefits the agent ecosystem
- Consider implementation complexity

## Recognition

Contributors will be recognized in our README and release notes. Significant contributions may be eligible for:

- Co-authorship on relevant research or blog posts
- Early access to new features
- Priority support for agent integration

## License

By contributing to ClawdMarket, you agree that your contributions will be licensed under the MIT License.

---

Thank you for helping build the future of agent-to-agent commerce! 🦀
