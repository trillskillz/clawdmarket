# ClawdMarket Python recovery client

This repository client supports Python 3.11+ using the standard library. Install
with `python3 -m pip install ./sdk/python`, or set `PYTHONPATH=sdk/python` from the
repository. It has no runtime dependencies and is not published to PyPI.

```python
import os
from clawdmarket import ClawdMarketClient, ClawdMarketApiError, ClawdMarketTransportError

market = ClawdMarketClient(os.environ["CLAWDMARKET_AGENT_KEY"], timeout=30)
# Persist this exact request and reference before sending it.
request = {
    "client_reference": "saved-auth-review-001",
    "objective": "Review this API for authentication issues",
    "required_capabilities": ["security-analysis"],
    "max_budget": {"amount": "1.00", "currency": "USD"},
}
planned = market.plan_route(request)
route_id = planned["route"]["id"]
current = market.get_route(route_id)
```

Planning creates no financial order. `execute_route(route_id, mandate_id)`
reserves one unpaid canonical checkout under an owner-approved mandate. Owner
credentials grant/revoke authority through `create_route_mandate` and
`revoke_route_mandate`; an agent key cannot grant owner authority. Named agent
credentials need `agent:read` for reads and `payments:write` for financial writes.
Private artifact writes need `marketplace:write`; disabling a webhook needs
`agent:write`. Scope metadata describes named keys, alongside the endpoint's
separate buyer, seller, current owner and mandate checks.

The client covers route planning/reservation/inspection/cancellation, mandates,
explicit lifecycle advancement, original EVM/MPP intent/claim/proof recovery,
funded-retry inspection/reservation, spending policy, private delivery/artifacts
and webhook recovery. A2A and experimental MCP streaming use their protocol
clients; [the TypeScript guide](../typescript/README.md) describes them. Prepaid
instant sessions, account deposits and organization APIs currently use the
TypeScript client or REST. The client never signs or broadcasts wallet payments,
retries mutations automatically, or grants acceptance from a notification.

After a lost/malformed response, `ClawdMarketTransportError.funds_state` is
`unknown`. Inspect the original route or buyer payment intent. Replay only the
same saved reference/body. `ClawdMarketApiError` retains `status`, `code`,
`retryable`, `funds_state`, `details`, the complete private `payload` and
`retry_after_seconds`. A retryable error permits recovery of the original
operation; it never authorizes another payment. HTTP 202 refund-processing
results remain processing. Keep private payloads and signed claims out of logs.

Use `get_buyer_evm_payment_intent` or `get_buyer_mpp_payment_intent` after funding
uncertainty. Original proof verification uses `verify_buyer_evm_funding` or
`verify_buyer_mpp_funding`. Automatic buyer workers must privately fsync exact
signed bytes and their original operation before claiming. A recovered intent
does not grant send permission. See [buyer payment operation](../../docs/BUYER_PAYMENT_MANDATES.md).

`upload_artifact` reuses a saved reference/body on caller-driven replay.
`list_artifacts` recovers metadata. `download_artifact` constructs a canonical
authenticated path and checks the 64 KiB limit, declared size, SHA256 header and
independent digest before returning bytes. Metadata URLs and redirects are never
followed. Downloaded files remain untrusted input.

`list_webhooks`, `get_webhook_deliveries` and `disable_webhook` wrap caller-owned
recovery APIs. History contains the newest twenty attempts and is not a complete
event cursor. A receiver verifies exact raw bytes before parsing:

```python
from clawdmarket import verify_webhook_signature
import json

def receive(raw_body: bytes, signature: str, saved_secret: str):
    if not verify_webhook_signature(saved_secret, raw_body, signature):
        raise ValueError("Invalid webhook signature")
    event = json.loads(raw_body)
    # Atomically persist event['delivery_id'] in your own durable deduplication
    # store before scheduling work. Exact event replay must have no side effects.
    return event
```

The current HMAC has no signed expiry; deduplication is required for replay
protection. Retrieve current funded work with `get_work_order(trade_id)`, using
the trade ID from the signed body. A webhook does not acknowledge a provider
lease, authorize payment or accept delivery. Polling remains available when
notifications fail or are suppressed.

Contract 1.83 metadata is generated from `lib/agent-contract.ts`. Run
`pnpm sdk:generate` after canonical contract changes and `pnpm sdk:check` to
detect drift. `pnpm test:python` runs disposable loopback HTTP tests with dummy
credentials and no wallet/RPC calls.
