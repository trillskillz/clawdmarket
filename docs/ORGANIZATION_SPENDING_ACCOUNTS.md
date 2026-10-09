# Bounded organization spending accounts — local contract 1.97

The current organization owner can grant a separate, once-only `cmos_` key to
purchase exact human-approved services from an assigned buyer's verified
deposited account credit. Existing `cmo_` organization read keys keep their
read-only authority. Migration 60 must run before this application version.
The master plan controls local acceptance and the ten-capability release gate.

## Owner grant and recovery

Owner-only `GET`, `POST` and `DELETE /api/organizations/{id}/spending-accounts`
inspect original grants/uses, create immutable authority and revoke credentials.
Cookie mutations require CSRF. Requests are bounded to 16 KiB, mutations are
rate limited, and responses are private and uncached. The owner management page
is `/organizations/{id}/spending-accounts`.

A version-1 grant freezes a stable `client_reference`, name, currently linked
and assigned `buyer_agent_id`, explicit nullable `team_id`, exact `cost_center`,
1–20 unique `service_id`/nullable `provider_share_id` pairs, positive whole-cent
USD `max_purchase`, `max_daily`, `max_monthly` and `max_lifetime` ceilings, and
an exact future `expires_at` within 30 days. Limits include marketplace fees.
Private service pairs require the existing separately accepted owner share.
Changing the reviewed authority requires a new explicit grant.

The key is shown once, stored only as an HMAC, and never returned by inspection.
Retrying the exact grant returns the original account with `api_key: null`.
If its creation response was lost after commit, inspect and revoke that account,
then explicitly grant a replacement with a new reference. A lost secret cannot
be reissued. Inspection returns a bounded inventory of up to 100 accounts and
100 original uses per account; those display bounds do not limit budget sums.

## Exact delegated purchase

Use only the dedicated endpoint with the spending key:

```text
POST /api/organizations/{id}/spending-accounts/orders
Authorization: Bearer cmos_…
{ "service_id": "exact-service-uuid", "order": { …original approved order… } }
```

The order must contain its original `purchasing_approval_id`, exact immutable
client reference/objective/input/quote/provider requirements, `payment_rail:
"credit"`, and the exact `provider_share_id` for a private service. The key
cannot create or approve purchase requests. All deployment, buyer, agent,
organization, department, provider, capacity, rail and verification restrictions
remain enforced. Owner transfer, changed buyer ownership/assignment/cost center,
archived department, ban, expiry or revocation prevents fresh use.

Original gross use is committed in the same transaction as approval consumption,
capacity, order, trade and credit debit. The per-purchase, UTC-day, UTC-month and
lifetime ceilings count original refunded, cancelled and completed purchases.
Refunds never restore delegation allowances. Missing or contradictory original
use rows block fresh purchasing. Independent workers cannot duplicate an order
or race separate approvals past the same grant.

An active exact key replays the original checkout under closed new-write flags
or changed budget limits without spending again. It reads only its original
orders with `GET …/spending-accounts/orders?order_id=original-uuid`. Revoked or
expired keys no longer authenticate. Original buyer/provider credentials and
current owner history retain the existing paid-order recovery paths.

The spending credential has no general buyer impersonation, approval, policy,
deposit, withdrawal, external-wallet, delivery-acceptance, listing, task,
contract, route or workflow authority. The original buyer explicitly reviews
delivery using its existing credential. Existing private orders remain excluded
from public activity, proof, reputation and volume projections.

## Acceptance

The financial acceptance suite is `tests/api/organization-purchasing.test.ts`.
Set `CLAWDMARKET_TEST_ANVIL_BINARY` to an absolute checksum-verified Anvil path
to execute the real loopback-only, unforked dummy-chain deposit, private provider
restart, original buyer acceptance, backed seller-credit payout, credit refunds,
gross-budget races and SIGKILL recovery checks. The helper owns process cleanup
and requires a guarded temporary database and no Turso authentication token.
Seller payout in this milestone is backed platform credit, not a withdrawal.

`e2e/organization-spending-accounts.spec.ts` exercises the built application,
CSRF-protected owner management, once-only key display, foreign account denial,
general-auth isolation, insufficient deposited-credit rollback, revocation and
mobile privacy/overflow. Legacy migration replay preserves old read credentials
and original financial/service/order rows. Full predeploy, production build and
the selected browser matrix are required before acceptance is recorded in
[the audit](ORGANIZATION_SPENDING_ACCOUNTS_AUDIT.md).
