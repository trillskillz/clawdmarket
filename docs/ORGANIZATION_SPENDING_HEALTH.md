# Enterprise external-payment observations

HTTP 1.102 adds private `organization_spending` aggregates to the existing administrator-only `/api/admin/routing/health` snapshot, hourly monitoring and protected read-only operator preflight. The operations console displays original enterprise payment obligations. Version-2 L1 and version-3 Tempo accounts are inspected even after revocation or expiry; those state changes never erase original gross uses or signed claims.

The inspector checks the original authority fingerprint, order/trade/approval/gross-use linkage, missing uses, original lifetime gross and full per-checkout lifetime fee exposure; exact original intent/claim/receipt chain, payer, token, treasury, amount and hash; cross-family wallet/nonce or transaction collisions with route claims; claims still unresolved after 900 seconds; and failed or overdue original enterprise payout/refund transfers. Reserve and fee ceilings remain authorization bounds, not measured transaction fees. Credit-account money remains covered by the existing deposited-credit audit.

Only fixed counts and alert codes leave the inspector. SQL selects no credential secret or digest. Owner/account/order/trade IDs, wallet addresses, transaction hashes, work input/output and private provider data are not returned to the console, cron or production preflight. The admin endpoint retains account authorization and private/no-store responses. Monitoring inspection failure returns the existing fixed unavailable alert; it does not reveal database diagnostics.

| Code | Meaning |
| --- | --- |
| ORGANIZATION_SPENDING_USAGE_INVARIANT | Original reviewed authority or gross order/approval/use linkage changed or exceeded its original lifetime ceiling. |
| ORGANIZATION_SPENDING_FEE_EXPOSURE | Original full per-checkout fee exposure exceeds its reviewed lifetime bound or terms are invalid. |
| ORGANIZATION_PAYMENT_CLAIM_INVARIANT | Exact original intent, claim, fee authority or confirmed funding receipt contradicts another original record. |
| ORGANIZATION_WALLET_COLLISION | Original enterprise wallet/nonce, active claim or transaction collides with another route or enterprise claim. |
| ORGANIZATION_PAYMENT_UNCONFIRMED | An original claim remains unresolved beyond 900 seconds. |
| ORGANIZATION_TRANSFER_UNCERTAIN | Original enterprise refund/payout failed or remains pending beyond 900 seconds. |

Investigate through the original buyer/owner history and [buyer payment recovery client](BUYER_SPENDING_WORKER.md). Preserve original signed bytes, hash and gross exposure. A timeout, cancelled reservation or revoked credential cannot prove payment absence. Refunds finish only after authoritative treasury confirmation. Do not clear uncertainty by deleting claims, copying approvals or creating replacement payments.

These alerts report obligations. Routing pause/resume retains its existing scope and financial checks; enterprise checkout retains its separate grant, exact approval and ordinary new-payment controls. The inspector cannot change flags, authorize a send, accept a delivery, move escrow or execute a refund. The protected preflight fails on enterprise alerts while existing proof and settlement workers keep their paths. Apply existing migrations through ID 62 before using this code; no new migration is introduced.

Real disposable L1/Tempo and private built-console acceptance evidence is recorded in the master plan. Production activation, live wallet funds, independent provider evidence and complete persisted Tempo fee measurement remain separately gated.
