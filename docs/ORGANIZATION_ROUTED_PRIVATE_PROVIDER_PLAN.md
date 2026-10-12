# Next routing capability: explicitly shared private providers

Dependency audit only. Implementation and acceptance remain open; this is not a
counted capability or a production rollout.

Reviewed public-provider L1 and Tempo routes bind original organization, buyer,
department, reviewer, route/candidates, mandate, gross and separate original fee
units. Private direct-service purchases already require a provider-owner offer,
organization-owner acceptance and current buyer/department scope through
`privateProviderAccess`. Those direct-service approvals and credentials do not
grant routed purchasing authority.

Current boundaries are deliberate: `planOrganizationRouteForReview` selects only
public services and public sellers; reviewed route grants reject private services;
`reserveServiceOrder` rejects direct `provider_share_id` alongside a route/mandate.
Remove none of these public boundaries without an independently scoped grant.

The next complete capability needs:

1. A separately versioned owner proposal and independent reviewer decision that
   freeze original accepted share identity/fingerprint, both owners, original
   service contract, department and expiry with route candidates and payment terms.
   Preserve public v1/v2 authority hashes and the original gross/fee accounting.
2. Private candidate inspection for the exact current organization owner and
   selected currently authorized reviewer. Keep discovery, public reputation,
   machine suggestions, Observe, activity and read/viewer credentials private-safe.
   Apply every existing buyer/provider/verification/rail/budget hard gate.
3. Internal reservation evidence from the original reviewed grant, not an arbitrary
   caller-supplied share ID. Atomically recheck the share's accepted consent,
   original owners, service, organization/buyer assignment, department, reviewer,
   grant/mandate, capacity and shared cross-rail gross/fee limits. Recheck fresh
   intent, claim and actual SDK broadcast. Revocation stops fresh commitments while
   original paid proofs/refunds and private backed results remain recoverable.
4. Genuine disposable L1/Tempo execution, separate buyer/provider restart, explicit
   buyer acceptance, confirmed payout and original revoked-share late-payment
   refunds. Prove consent/owner/department/capacity/gross/fee/wallet races and
   before/after-commit SIGKILL rollback/recovery with one original obligation.
5. TypeScript/Python original-reference and lost-decision recovery, private
   desktop/mobile review, public privacy regression, additive migration replay,
   immutable reputation guards, five evidence queries, production build and the
   complete genuine economic/regression gate. Count only after all acceptance.

Broader product/task/workflow authority and independent-provider production proof
retain their separate gates. Publication remains one demonstrable capability per
PR in batches of ten completed capabilities, with protected CI, migration-first
deployment and exact merged-SHA production verification. No live funds or global
execution/payment flags change.
