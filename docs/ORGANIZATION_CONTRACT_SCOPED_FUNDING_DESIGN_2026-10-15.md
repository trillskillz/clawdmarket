## Implemented local checkpoint — fresh rollout defaultfalse

The atomic writer/API, buyer SDKs, actual public API funding/fulfillment and lost
HTTP/policy/rollback controls now pass. Only isolated fixtures enable the fresh
flag. Process races/kills, durable clients/private human UI and complete release
acceptance remain required. See the current contract audit; no capability9.

## Original dependency design (historical)

# Next local boundary: one original reviewed credit funding transaction

Migration79 implements only unique immutable buyer/reference binding and original
financial recovery. There is NO scoped public funding writer/SDK/UI yet. Keep
funding_available:false and generic reviewed funding excluded until the transaction
below is implemented and verified. No capability9, deployment, real funds, custody
change or global execution authorization is implied.

Use version1/client_reference/authority_hash with a bounded body at a separate
organization contract-authorization fund resource. Derive the original buyer from
authentication, never JSON. Named mutations need payments:write, cookie mutations
need CSRF, owner/reviewer/read scope cannot pay. Known original request recovery
precedes fresh pause/role/owner/rail/expiry/availability checks. Changed or cross-
contract buyer reference reuse fails. A prior use without a request row keeps its
financial/fulfillment/refund meaning but cannot be adopted or given a fabricated
funding request. No backfill or legacy wallet funding is permitted.

Inside ONE purchasing transaction:

1. Recover the exact saved original request if present. Otherwise load the exact
   organization/authorization and verify original buyer, approved decision/hash,
   frozen terms and absence of any prior use/reservation/attribution. Reuse the
   existing current-contract-review validator for owner/link/assignment/team,
   independent selected organizational reviewer, bans/roles, original DRAFT and
   ordered milestones/deadlines, exact quote, seller visibility/credit opt-in and
   linked public inventory. Organizational review is not marketplace independence.
2. Check new-payments environment/database pause INSIDE the transaction. Preserve
   current credit readiness and the original closed rollout scope. Do not introduce
   global execution flags or external chain-fee metadata for credit.
3. Check shared original gross across route/workflow/task/listing/contract once.
   Mint only the existing internal validated purchase-evidence capability AFTER
   transactional review validation, to satisfy the buyer approval threshold for
   the exact buyer/seller/credit/gross. Keep other agent/buyer/organization/team
   caps and provider/verification constraints independent. Plain approve:true or
   finite artifact checks cannot satisfy purchase authority.
4. Atomically claim any original linked active listing, transition the SAME
   original DRAFT to FUNDED with one funding clock, post existing deposited-credit
   reserve/fee entries via the existing contract settlement functions, and record
   existing organization contract attribution. ensureAdminFeeRecipient accepts a
   transaction source: use that source, without nested default-db writes or new
   custody arrangements. Seller receives nonwithdrawable account credit and the
   upfront fee/refundable principal remain the originally approved amounts.
5. Append organization_contract_uses and its immutable unique buyer/reference
   request in the SAME transaction. Pin original fee recipient/hash/clock. Validate
   the resulting original financial record before commit. Roll every effect back
   if any claim, budget, credit or journal condition fails. Never create a trade,
   task, service order, route claim, wallet nonce or new relative deadline as an
   alias for this original contract.

Return private/no-store original contract and current milestone state, immutable
original_terms and funding receipt, held principal and observation time. Do not
expose owner-only policy data or seller output through organization review scope.
Original request GET/replay must survive revocation, reassignment, original expiry,
cancellation, partial release/refund and completion, without refreshing any budget,
reference, quote or clock. Public availability must remain distinct from measured
successful funding or independent adoption.

Target checks: genuine local deposit -> actual public owner/reviewer decision ->
actual scoped funding -> seller start/output -> exact buyer acceptance -> exact
credit posting/refund. Both SDKs must recover actually lost committed funding
replies. Exercise both reservation orders/shared ceilings, changed permissions and
rail/department/deadline/pause/budget failures, same/different-body separate-process
races, before/after-commit SIGKILL, a failing final journal append and no recycling
of original listing/gross. Preserve migration79/replay/local baseline and existing
API/ordinary financial behavior. Controlled fixtures remain controlled; no customer
outreach, reviews, deposits or purchases may be fabricated.

Then implement finite provider/buyer journals and restart behavior, private human
review/work UI, and complete genuine multi-milestone economics/process/full
predeploy/build/browser gates before accepting capability9 or a new1.120 candidate.
Existing security, provider inbox/admission/calibration/demand, publication and
separately capped live-payment/treasury-budget dependencies stay external.
