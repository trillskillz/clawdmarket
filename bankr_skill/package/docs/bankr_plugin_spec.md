# Bankr Plugin/Skill Spec Research (Current State)

_Last updated: 2026-03-05_

This document captures what is currently verifiable about building a Bankr-compatible skill/plugin for ClawdMarket, plus explicit gaps that require Bankr confirmation.

## Sources Reviewed

### Bankr
- https://bankr.bot
- https://github.com/bankr-bot
- https://github.com/bankr-bot/bankr-trading-agent

### OpenClaw plugin/skill references
- https://raw.githubusercontent.com/openclaw/openclaw/main/README.md
- https://raw.githubusercontent.com/openclaw/openclaw/main/docs/tools/plugin.md
- https://raw.githubusercontent.com/openclaw/openclaw/main/docs/tools/skills.md
- https://raw.githubusercontent.com/openclaw/openclaw/main/extensions/open-prose/README.md
- https://raw.githubusercontent.com/openclaw/openclaw/main/extensions/open-prose/skills/prose/SKILL.md

### Related payment protocol reference (context)
- https://github.com/coinbase/x402

---

## Executive Summary

- A **public, canonical Bankr plugin manifest schema** was **not found** in currently reachable Bankr docs/repositories.
- The Bankr public org currently exposes a trading-agent repo, but no standalone published plugin/skill SDK docs describing manifest/approval/rate-limit requirements for third-party skills.
- OpenClaw has a clear plugin + skill model (`openclaw.plugin.json` + `SKILL.md` frontmatter), which is likely relevant if Bankr integrations are expected to run through OpenClaw agents.

Because of this, this spec is split into:
1. **Verified** (from public docs)
2. **Inferred interoperability guidance** (high-confidence architectural guess)
3. **Unknowns requiring Bankr confirmation** (blocking for official submission)

---

## 1) Bankr-Compatible Skill Manifest Schema

## 1.1 Verified (publicly available)

No official Bankr manifest JSON schema was found in:
- bankr.bot publicly served pages
- bankr-bot org repositories visible without private access

## 1.2 Interop baseline (recommended until Bankr schema is published)

Use an internal manifest that is explicit enough to map into Bankr once schema is confirmed:

```json
{
  "name": "ClawdMarket",
  "version": "0.1.0",
  "description": "Agent-native marketplace powered by CLAWDCOIN on BNKR/x402 rails",
  "provider": {
    "name": "ClawdMarket",
    "website": "https://clawd.market",
    "support": "support@clawd.market"
  },
  "auth": {
    "type": "api_key_or_oauth2",
    "signature_required": true
  },
  "endpoints": {
    "intent": "/api/bankr_skill/intent",
    "health": "/api/health"
  },
  "intents": [
    "list_service",
    "find_agent",
    "pay_with_bnkr",
    "check_balance"
  ],
  "payments": {
    "rails": "x402",
    "network": "eip155:8453",
    "tokens": ["BNKR", "CLAWDCOIN"]
  },
  "limits": {
    "per_minute": 60,
    "per_hour": 1000
  }
}
```

This is an internal draft format, **not yet a Bankr-official schema**.

---

## 2) Required vs Optional Fields (Current Confidence)

## 2.1 Verified required fields for OpenClaw skill files (if used in OpenClaw stack)

For `SKILL.md` frontmatter (OpenClaw/AgentSkills-compatible):
- Required: `name`, `description`
- Optional common fields: `metadata`, `homepage`, invocation flags

Example:
```yaml
---
name: my-skill
description: What it does
metadata: { "openclaw": { "emoji": "🧩" } }
---
```

## 2.2 Bankr manifest required/optional fields

- **Unknown (not publicly documented in retrieved sources)**.
- Treat all manifest field requirements as pending Bankr documentation.

---

## 3) Authentication Model Between Bankr Agents and External Skills

## 3.1 Verified

No published Bankr third-party plugin auth contract was found.

## 3.2 Recommended implementation contract (for ClawdMarket)

Until Bankr-specific guidance is published:
1. Support **API key** for server-to-server agent calls.
2. Support **OAuth2** fallback if directory requires delegated user auth.
3. Require **wallet signature** on high-value payment actions.
4. Use stateless request verification (JWT/API-key + signature + nonce/timestamp).

This aligns with existing ClawdMarket security posture and x402 replay protections.

---

## 4) Natural-Language Command Routing to Handlers

## 4.1 Verified in OpenClaw ecosystem

OpenClaw supports command routing through:
- Plugin-registered commands (`api.registerCommand`), and/or
- Skill invocation (`SKILL.md`) with tool execution guidance.

So Bankr-origin intents can be routed into handler endpoints through a translation layer:
- NL intent → normalized intent object → backend handler

## 4.2 Suggested normalized intent envelope

```json
{
  "intent": "list_service",
  "agent_id": "agent_123",
  "wallet": "0x...",
  "params": {
    "service_name": "...",
    "description": "...",
    "price_clawdcoin": "..."
  },
  "timestamp": 1772759340,
  "nonce": "...",
  "signature": "0x..."
}
```

---

## 5) Submission / Approval Process for Bankr Directory

## 5.1 Verified

No public Bankr ecosystem-directory submission workflow was found in retrieved sources (no clearly documented PR/form/API process was discoverable).

## 5.2 Provisional workflow (until official process is confirmed)

1. Prepare manifest + endpoint docs + auth docs + test evidence.
2. Contact Bankr through official channel (site/team/community) for current submission lane.
3. Submit required artifacts in whatever channel Bankr provides (likely GitHub PR or form).
4. Track review feedback and resubmit until approved.

This section should be replaced with exact URLs and steps once Bankr publishes them.

---

## 6) Rate Limits / API Quotas for Skills

## 6.1 Verified

No public Bankr quota/rate-limit policy for third-party skills was found.

## 6.2 Recommended baseline for ClawdMarket bridge

Implement conservative limits immediately:
- 60 requests/minute per agent
- 1000 requests/hour per agent
- Return `429` + `Retry-After`
- Include structured error body for agent UX

These values match the planned ClawdMarket requirements and can be adjusted when Bankr publishes official quotas.

---

## 7) Practical Mapping: OpenClaw Plugin Repo + SKILL.md Findings

From OpenClaw plugin docs/repo:
- Plugins are declared via `openclaw.plugin.json`
- Skills are declared via `SKILL.md` files (AgentSkills-compatible)
- Plugin commands can be registered and routed before LLM fallback
- Plugin config + schema is validated at gateway level

Implication for ClawdMarket:
- Build skill handlers + auth bridge as normal HTTP API.
- Keep a transport adapter layer that can accept Bankr intent envelopes and dispatch to handlers.
- Keep manifest generation templated so it can be quickly switched to official Bankr schema once published.

---

## 8) Blocking Unknowns (Need Bankr Confirmation)

These are blockers for “official” submission and should be treated as open action items:

1. Official Bankr skill/plugin manifest schema (JSON schema or equivalent)
2. Required auth mechanism (API key vs OAuth2 vs signed wallet-only)
3. Skill discovery and registration endpoint/process
4. Directory approval criteria and SLA
5. Production rate limits/quotas and error semantics
6. Security requirements (signature algos, nonce windows, webhook verification)
7. Versioning/deprecation policy for skills

---

## 9) Recommended Next Step

Before Task 3.2 (manifest build), obtain an authoritative Bankr spec source from Bankr team and pin it here (URL + date + version). Then:
- replace provisional schema with official schema,
- run schema validation,
- proceed to manifest and submission automation with confidence.
