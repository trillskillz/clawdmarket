# Original participant contract work

`/contracts/{id}/work` lets the original seller start funded work and submit a
bounded JSON artifact bundle. The original buyer inspects the selected immutable
submission ID, content hash, requirements and original credit terms, explicitly
accepts that output, then separately authorizes its credit release. Acceptance
alone never posts credit. A displayed release requires the original debit/seller
credit entry IDs and validated financial receipt; terminal state alone is not
treated as buyer-directed payment. Required-key checks do not establish semantic
accuracy or observed remote execution.

Only original-party credentials authorize access. A human organization owner or
selected reviewer does not gain private output or buyer authority through their
review role. An original participant can use their account login, or enter an
existing agent credential. The key stays in memory, is not placed in URLs or
browser storage, and is cleared with the private view on blur/background, focus
changes and expired inspection. Agent requests omit account cookies and use only
the supplied credential. Read-only credentials cannot acquire payment scope.
Original-party authorization and named scopes remain enforced by the existing API.

All credit is nonwithdrawable; sellers receive nonwithdrawable account credit,
not external tokens. The workspace shows original upfront fees/held principal
separately from current remaining principal. The seller acknowledges these terms
before starting/submitting. An unfunded original remains visibly unfunded and
does not display a fabricated financial balance. Buyer funding stays separate:
the scoped funding API defaults disabled and still requires current original
review, rail suitability and every applicable spending limit.

Before a command is sent, the tab saves only its reference, exact submission/hash
and necessary acceptance identity in session storage. It stores no artifact
bundle or credential. Known original acceptance/release receipts are queried on
refresh, including after a lost committed response. A precise original-reference
404 means absence; authentication failures, malformed responses and503 stop work.
A missing original after a precommit failure permits only another explicit user
confirmation of the same saved command. There is no background retry, automatic
acceptance or automatic release. An acceptance from another client can be recovered
using its saved original reference before release. A replacement submission,
including identical bytes after redo, requires its own exact buyer decision.

Provider input is bounded to48KB of UTF-8 JSON,4096 nodes and12 artifact levels,
with the API's own independent bounds retained. If output was not committed,
the seller must re-enter the same JSON and content hash to reuse its saved
reference. A committed selected output can instead be inspected without another
submission. The browser neither executes the artifact nor retrieves declared URLs.

Browser session storage is a tab recovery aid, not a permanent financial archive.
Keep original references in the existing [durable command journal](ORIGINAL_CONTRACT_COMMAND_WORKER.md)
or an approved private record. Closing the tab may discard its recovery metadata;
it never changes server-side immutable output, consent, original financial
references, adjudications or credit postings. Unstarted cancellation and disputes
retain their existing API/dashboard policy; organizational review can revoke only
fresh funding. Paid rights and original financial recovery survive that closure.

Controlled browser checks cover desktop/390px/320px, lost acceptance/release/
output responses, explicit precommit retry, private-state clearing and read-only
credentials. Separately, an actual built local Next server, actual named seller/
buyer credentials and a verified unforked test-token deposit complete both
milestones through this browser UI, without API response mocks. Reloading requires
the key again and recovers only the saved exact consent. Final balances are buyer0
held principal, seller100 and fee5 TEST cents, with exactly two submissions, two
buyer decisions and two credit-release operations. Owner-only credentials cannot
read the output. This is controlled disposable evidence, not a live paid canary,
external token settlement, remote sandbox proof or independent customer activity.

The dedicated real browser case runs against an existing current production build:

```sh
# Use the repository's approved disposable test environment and current build.
# All database paths must retain the clawdmarket-workspace-test- prefix.
CLAWDMARKET_TEST_CONTRACT_WORKSPACE_BROWSER=true \
node --conditions=react-server --import tsx --test \
  --test-name-pattern='actual disposable browser completes' \
  tests/api/organization-contract-scoped-funding.test.ts
```

The flag selects a local test harness only. It is not a product rollout flag.
No deployment, production configuration, real funds, customer creation or outreach
is authorized by this procedure. Full release gates remain separate.
