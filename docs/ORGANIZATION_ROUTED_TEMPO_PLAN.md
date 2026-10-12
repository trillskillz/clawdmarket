# Next enterprise routing capability: independently reviewed Tempo authority

Status: dependency audit only. Implementation and acceptance remain open; this
document does not count as a completed capability or authorize a production rollout.

The accepted L1 route grants are version 1, bind the
`organization-route-authority-v1` hash and consume `maximum_gas_cost_wei`.
`organizationRouteInput`, `organizationRoutePurchaseEvidence`,
`validateOrganizationRouteAuthority` and `consumeOrganizationRouteExposure`
intentionally permit Ethereum L1 only. Accepting Tempo by removing those checks
would misstate fee units and alter historical authority.

The general route mandate already supports explicit Tempo fee-token terms;
delegated direct-service Tempo purchasing already preserves the original SDK
challenge, exact root transaction claim, shared wallet exclusion and revoked
original-payment refund recovery. Those are prerequisites to reuse, not grants
for the new routed purchase.

The next capability requires:

1. A separately reviewed versioned routed grant for configured chain 4217 and
   six-decimal pathUSD. Freeze original route objective/input/candidates, current
   owner-linked buyer, organization/team/cost center, independent reviewer,
   immutable mandate, token/payer/treasury, token and fee reserve floors, expiry,
   per-payment and lifetime fee-token ceilings, one attempt and zero paid retries.
   Preserve version-1 hashes, original L1 inspections and their native-wei meanings.
2. Additive storage for distinct fee-token observations and original use; share
   daily/monthly/lifetime gross across original L1 and Tempo grants for the same
   organization and buyer. Reserve fee exposure in its original chain/token/unit.
   Settlement, cancellation and refunds cannot replenish original gross or fees.
3. Atomic review/use/order/capacity/department consumption and current authority
   checks at fresh reservation, intent, claim and the actual guarded SDK broadcast.
   Existing direct-service/read credentials retain their scopes. Original revoked
   claims and proofs remain recoverable without a replacement signature or send.
4. Genuine disposable Tempo selection, buyer and provider process restart,
   explicit buyer acceptance, confirmed seller payout, original late full refund,
   charged failed-refund evidence and receipt/balance reconciliation. Independent
   approval/wallet/gross/fee races and SIGKILL at original commit/broadcast boundaries
   must preserve one obligation and completely roll back losing reservations.
5. Private owner/reviewer desktop/mobile review, both clients' lost-response and
   original-decision recovery, full EVM/Tempo regression checks, generated contract
   parity, production build, legacy migration replay, immutable reputation guards
   and five evidence queries. Count only after the complete usable outcome passes.

Paid production canaries, production Tempo fork compatibility, representative
reputation calibration and independent providers retain their recorded prerequisites.
The user's ten accepted capability PR publication cadence remains authoritative.
