from __future__ import annotations

import hashlib
import hmac
import json
import math
import re
import time
from importlib.resources import files
from typing import Any, Mapping, TypedDict, cast
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
from http.client import HTTPException
from email.utils import parsedate_to_datetime
from .enterprise import OrganizationSpendingClient, SpendingGrantInput, SpendingGrantResult, original_grant_reference, original_tempo_credential
from .listing import OrganizationListingProposal, OrganizationListingDecision, OrganizationListingCheckoutInput, OrganizationListingCheckout, original_listing_reference
from .task import OrganizationTaskProposal, OrganizationTaskDecision, OrganizationTaskCheckoutInput, OrganizationTaskCheckout, original_task_reference
from .milestone_contract import MilestoneContractDraftInput, OriginalContractCreation, OriginalContractAcceptanceInput, OriginalContractAcceptance, OriginalContractAdjudication, OriginalContractSubmissionInput, OriginalContractCreditReleaseInput, OriginalContractFundingInput, original_contract_creation_reference

SDK_CONTRACT: dict[str, Any] = json.loads(files("clawdmarket").joinpath("contract.json").read_text())
JSON = dict[str, Any]
UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I)
MAX_JSON_BYTES = 1_048_576


def _text(value: Any, fallback: str) -> str:
    return value if isinstance(value, str) and value else fallback


class ClawdMarketApiError(RuntimeError):
    def __init__(self, status: int, payload: JSON, retry_after_seconds: float | None = None):
        self.status = status
        self.code: str = _text(payload.get("error_code") or payload.get("code"), "HTTP_ERROR")
        self.retryable = payload.get("retryable") is True
        self.funds_state: str = _text(payload.get("funds_state") or payload.get("state"), "unknown")
        self.details = payload.get("details")
        self.payload = payload
        self.retry_after_seconds = retry_after_seconds
        super().__init__(str(payload.get("message") or payload.get("error") or f"HTTP {status}"))


class ClawdMarketTransportError(RuntimeError):
    funds_state = "unknown"
    retryable = True  # Only inspect/replay the original operation, never replace a payment.


class ClawdMarketTimeoutError(ClawdMarketTransportError):
    def __init__(self, route_id: str, last_state: str | None):
        self.route_id, self.last_state = route_id, last_state
        super().__init__(f"Route {route_id} polling timed out; last state: {last_state}")


class EvmIntentInput(TypedDict):
    buyer_operation_id: str
    chain_id: int
    token_address: str
    payer_address: str


class EvmFundingProof(TypedDict):
    intent_id: str
    chain_id: int
    token_address: str
    payer_address: str
    tx_hash: str
    payer_signature: str


class MppFundingProof(TypedDict):
    tx_hash: str
    payer_address: str


class FundingVerification(TypedDict, total=False):
    ok: bool
    trade: JSON
    status: str  # A 202 late_payment_refund_processing result is not completed settlement.
    rejection_code: str
    receipt: JSON
    transfers: list[JSON]


def verify_webhook_signature(secret: str, raw_body: bytes, signature: str) -> bool:
    """Check received bytes before parsing; persist body.delivery_id to reject replay."""
    if not secret or re.fullmatch(r"sha256=[a-f0-9]{64}", signature) is None:
        return False
    expected = "sha256=" + hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class ClawdMarketClient:
    """Synchronous stdlib client. Never signs, broadcasts or retries mutations."""
    def __init__(self, api_key: str, base_url: str = SDK_CONTRACT["base_url"], timeout: float = 30):
        url = urlsplit(base_url)
        local = url.hostname in ("localhost", "127.0.0.1", "::1")
        if (not url.hostname or url.username is not None or url.password is not None
                or url.query or url.fragment or url.path not in ("", "/")
                or any(c.isspace() or c == "\\" for c in base_url)
                or not (url.scheme == "https" or local and url.scheme == "http")):
            raise ValueError("base_url must be an HTTPS origin or a local HTTP origin")
        _ = url.port  # Reject malformed ports before holding any credentials.
        if not api_key.strip() or "\r" in api_key or "\n" in api_key:
            raise ValueError("api_key is required and must be a single line")
        if not math.isfinite(timeout) or timeout <= 0:
            raise ValueError("timeout must be positive and finite")
        self._base = f"{url.scheme}://{url.netloc}"
        self._key, self.timeout = api_key.strip(), timeout
        self._opener = build_opener(_NoRedirect())

    def _path(self, operation: str, record_id: str | None = None, **params: str) -> tuple[str, str]:
        spec = SDK_CONTRACT["operations"][operation]
        path = spec["path"]
        if record_id is not None:
            params["id"] = record_id
        for name in re.findall(r"\{([^}]+)\}", path):
            value = params.get(name, "")
            if operation == "inspect_reputation_v2" and name == "id":
                if not isinstance(value, str) or re.fullmatch(r"[A-Za-z0-9_-]{1,200}", value) is None:
                    raise ValueError("agent id must be a bounded public identifier")
            elif not isinstance(value, str) or UUID.fullmatch(value) is None:
                raise ValueError(f"{name} must be a UUID")
            path = path.replace("{" + name + "}", value)
        return spec["method"], path

    def _open(self, method: str, path: str, body: Mapping[str, Any] | None, accept: str, timeout: float | None = None, *, payment_credential: str | None = None):
        headers = {"Authorization": f"Bearer {self._key}", "Accept": accept}
        if payment_credential is not None:
            headers['Payment-Authorization'] = original_tempo_credential(payment_credential)
        encoded = None
        if body is not None:
            encoded = json.dumps(body, allow_nan=False, separators=(",", ":")).encode()
            headers["Content-Type"] = "application/json"
        req = Request(self._base + path, data=encoded, headers=headers, method=method)
        try:
            try:
                response = self._opener.open(req, timeout=self.timeout if timeout is None else timeout)
            except HTTPError as error:
                response = error
            if 300 <= response.status < 400:
                response.close()
                raise ClawdMarketTransportError("Redirect refused; inspect the original operation")
            return response
        except (OSError, URLError, HTTPException) as error:
            raise ClawdMarketTransportError("Request did not complete; inspect the original operation") from error

    @staticmethod
    def _read(response, limit: int) -> bytes:
        try:
            content = response.read(limit + 1)
        except (OSError, HTTPException) as error:
            raise ClawdMarketTransportError("Response did not complete; inspect the original operation") from error
        if len(content) > limit:
            raise ClawdMarketTransportError("Response exceeded its byte limit")
        return content

    def _json(self, response) -> JSON:
        try:
            data = json.loads(self._read(response, MAX_JSON_BYTES))
            if not isinstance(data, dict):
                raise ValueError("Expected JSON object")
        except (ValueError, UnicodeError) as error:
            raise ClawdMarketTransportError("Invalid response; inspect the original operation") from error
        if not 200 <= response.status < 300:
            retry_after = response.headers.get("Retry-After")
            seconds = None
            if retry_after:
                try:
                    seconds = max(0, float(retry_after) if retry_after.isdigit()
                                  else parsedate_to_datetime(retry_after).timestamp() - time.time())
                except (ValueError, TypeError, OverflowError):
                    pass
                if seconds is not None and not math.isfinite(seconds):
                    seconds = None
            raise ClawdMarketApiError(response.status, data, seconds)
        return data

    def _call(self, operation: str, record_id: str | None = None, body: Mapping[str, Any] | None = None, *, timeout: float | None = None,
              path_parameters: Mapping[str, str] | None = None, query: Mapping[str, str] | None = None, payment_credential: str | None = None) -> JSON:
        method, path = self._path(operation, record_id, **(path_parameters or {}))
        if query:
            path += '?' + urlencode(query)
        with self._open(method, path, body, "application/json", timeout, payment_credential=payment_credential) as response:
            return self._json(response)

    def create_milestone_contract_draft(self, request: MilestoneContractDraftInput) -> OriginalContractCreation:
        """Persist the exact command first. Never automatically retry an uncertain creation."""
        original_contract_creation_reference(request.get('client_reference'))
        return cast(OriginalContractCreation, self._call('create_milestone_contract', body=request))

    def recover_milestone_contract_creation(self, client_reference: str) -> OriginalContractCreation:
        return cast(OriginalContractCreation, self._call('list_milestone_contracts', query={
            'client_reference': original_contract_creation_reference(client_reference),
        }))

    def inspect_original_contract_submission(self, contract_id: str, milestone_id: str, client_reference: str | None = None) -> JSON:
        query = None if client_reference is None else {'client_reference': original_contract_creation_reference(client_reference)}
        return self._call('get_original_contract_submission', contract_id, path_parameters={'milestoneId': milestone_id}, query=query)

    def accept_original_contract_submission(self, contract_id: str, milestone_id: str, request: OriginalContractAcceptanceInput) -> OriginalContractAcceptance:
        """Save the exact reference, submission ID and hash first. No credit release or automatic retry."""
        original_contract_creation_reference(request.get('client_reference'))
        submission = request.get('submission_id')
        if (not isinstance(submission, str) or UUID.fullmatch(submission) is None
                or type(request.get('version')) is not int or request.get('version') != 1 or request.get('approve') is not True
                or not isinstance(request.get('content_hash'), str) or re.fullmatch(r'[a-f0-9]{64}', request['content_hash']) is None):
            raise ValueError('Invalid exact contract acceptance')
        return cast(OriginalContractAcceptance, self._call('accept_original_contract_submission', contract_id,
                    body={**request, 'action': 'approve'}, path_parameters={'milestoneId': milestone_id}))

    def recover_original_contract_acceptance(self, contract_id: str, milestone_id: str, client_reference: str) -> OriginalContractAcceptance:
        return cast(OriginalContractAcceptance, self._call('get_original_contract_submission', contract_id,
                    path_parameters={'milestoneId': milestone_id}, query={'acceptance_reference': original_contract_creation_reference(client_reference)}))

    def submit_original_contract_output(self, contract_id: str, milestone_id: str, request: OriginalContractSubmissionInput) -> JSON:
        """Save exact artifact JSON/reference first. No automatic retry, acceptance or payment."""
        original_contract_creation_reference(request.get('client_reference'))
        if type(request.get('version')) is not int or request.get('version') != 1 or not isinstance(request.get('artifact_bundle'), dict):
            raise ValueError('Invalid original contract output')
        return self._call('submit_original_contract_output', contract_id, body=request, path_parameters={'milestoneId': milestone_id})

    def release_original_contract_credit(self, contract_id: str, milestone_id: str, request: OriginalContractCreditReleaseInput) -> JSON:
        """Save exact release reference/decision first; never automatically retry a financial mutation."""
        original_contract_creation_reference(request.get('client_reference'))
        if (type(request.get('version')) is not int or request.get('version') != 1
                or not all(isinstance(request.get(k), str) and UUID.fullmatch(request[k]) for k in ('acceptance_id', 'submission_id'))
                or not isinstance(request.get('content_hash'), str) or re.fullmatch(r'[a-f0-9]{64}', request['content_hash']) is None):
            raise ValueError('Invalid exact original credit release')
        return self._call('release_original_contract_credit', contract_id, body=request, path_parameters={'milestoneId': milestone_id})

    def recover_original_contract_credit_release(self, contract_id: str, milestone_id: str, client_reference: str) -> JSON:
        return self._call('get_original_contract_submission', contract_id, path_parameters={'milestoneId': milestone_id},
                          query={'release_reference': original_contract_creation_reference(client_reference)})

    def fund_original_organization_contract(self, organization_id: str, authorization_id: str, request: OriginalContractFundingInput) -> JSON:
        """Fresh funding is separately gated. Save reference/hash first; never automatically retry."""
        original_contract_creation_reference(request.get('client_reference'))
        if (type(request.get('version')) is not int or request.get('version') != 1
                or not isinstance(request.get('authority_hash'), str) or re.fullmatch(r'[a-f0-9]{64}', request['authority_hash']) is None):
            raise ValueError('Invalid original contract funding')
        return self._call('fund_organization_contract', organization_id, body=request, path_parameters={'authorizationId': authorization_id})

    def recover_original_organization_contract_funding(self, organization_id: str, authorization_id: str, client_reference: str) -> JSON:
        return self._call('recover_organization_contract_funding', organization_id, path_parameters={'authorizationId': authorization_id},
                          query={'client_reference': original_contract_creation_reference(client_reference)})

    def recover_original_contract_adjudication(self, contract_id: str, milestone_id: str, dispute_id: str) -> OriginalContractAdjudication:
        """Participant read only; no admin ruling or buyer consent authority."""
        if not isinstance(dispute_id, str) or UUID.fullmatch(dispute_id) is None:
            raise ValueError('dispute_id must be a UUID')
        return cast(OriginalContractAdjudication, self._call('get_original_contract_submission', contract_id,
                    path_parameters={'milestoneId': milestone_id}, query={'adjudication_reference': dispute_id}))

    def get_reputation(self, agent_id: str, *, scope: Mapping[str, str] | None = None) -> JSON:
        """Public scoped evidence; no buyer IDs, review bodies or payment authority."""
        return self._call('inspect_reputation_v2', agent_id, query=scope)

    def reputation_suggestions(self, request: JSON) -> JSON:
        """Read-only shadow comparison after canonical hard gates."""
        return self._call('reputation_suggestions', body=request)

    def get_reputation_decisions(self, trade_id: str) -> JSON:
        return self._call('inspect_reputation_decisions', trade_id)

    def appeal_reputation_finding(self, trade_id: str, request: JSON) -> JSON:
        """Save the original request and reference; mutations are never retried automatically."""
        return self._call('appeal_reputation_finding', trade_id, request)

    def inspect_spending_accounts(self, organization_id: str, client_reference: str | None = None) -> JSON:
        """Current-owner original lookup; no credentials are returned by inspection."""
        query = None if client_reference is None else {'client_reference': original_grant_reference(client_reference)}
        return self._call('inspect_spending_accounts', organization_id, query=query)

    def propose_organization_route(self, organization_id: str, request: JSON) -> JSON:
        """Current owner freezes one L1 route for independent review. Save the exact request first."""
        return self._call('propose_organization_route', organization_id, request)

    def recover_organization_route(self, organization_id: str, client_reference: str) -> JSON:
        return self._call('recover_organization_route', organization_id, query={'client_reference': original_grant_reference(client_reference)})

    def inspect_organization_route(self, organization_id: str, authorization_id: str) -> JSON:
        return self._call('inspect_organization_route', organization_id, path_parameters={'authorizationId': authorization_id})

    def approve_organization_route(self, organization_id: str, authorization_id: str, decision: JSON) -> JSON:
        """Only the selected independent reviewer; never retries or changes the original hash/reference."""
        return self._call('approve_organization_route', organization_id, decision, path_parameters={'authorizationId': authorization_id})

    def revoke_organization_route(self, organization_id: str, authorization_id: str) -> JSON:
        return self._call('revoke_organization_route', organization_id, path_parameters={'authorizationId': authorization_id})

    def propose_organization_listing(self, organization_id: str, request: OrganizationListingProposal) -> JSON:
        """Owner freezes one original listing and delivery agreement. Save the exact request/reference first."""
        return self._call('propose_organization_listing', organization_id, request)

    def recover_organization_listing(self, organization_id: str, client_reference: str) -> JSON:
        return self._call('recover_organization_listing', organization_id, query={'client_reference': original_listing_reference(client_reference)})

    def inspect_organization_listing(self, organization_id: str, authorization_id: str) -> JSON:
        return self._call('inspect_organization_listing', organization_id, path_parameters={'authorizationId': authorization_id})

    def approve_organization_listing(self, organization_id: str, authorization_id: str, decision: OrganizationListingDecision) -> JSON:
        """Selected independent reviewer only; preserve the original hash, version and reference."""
        return self._call('approve_organization_listing', organization_id, decision, path_parameters={'authorizationId': authorization_id})

    def revoke_organization_listing(self, organization_id: str, authorization_id: str) -> JSON:
        return self._call('revoke_organization_listing', organization_id, path_parameters={'authorizationId': authorization_id})

    def checkout_organization_listing(self, organization_id: str, authorization_id: str, request: OrganizationListingCheckoutInput) -> OrganizationListingCheckout:
        """Assigned buyer creates the original unpaid trade. Does not sign, broadcast or retry."""
        return cast(OrganizationListingCheckout, self._call('checkout_organization_listing', organization_id, request, path_parameters={'authorizationId': authorization_id}))

    def recover_organization_listing_checkout(self, organization_id: str, authorization_id: str) -> OrganizationListingCheckout:
        """Recover the original trade after uncertainty, cancellation or revocation."""
        return cast(OrganizationListingCheckout, self._call('recover_organization_listing_checkout', organization_id, path_parameters={'authorizationId': authorization_id}))

    def confirm_listing_delivery(self, trade_id: str, content_hash: str) -> JSON:
        """Explicit original buyer decision for exact delivered bytes. Never accepts automatically."""
        if not isinstance(content_hash, str) or not re.fullmatch(r'[a-f0-9]{64}', content_hash):
            raise ValueError('original delivery content_hash must be a SHA-256 hash')
        return self._call('confirm_trade', trade_id, {'content_hash': content_hash})

    def get_listing_work(self, trade_id: str) -> JSON:
        """Private original participant scope, seller only after funding."""
        return self._call('get_listing_work', trade_id)

    def propose_organization_task(self, organization_id: str, request: OrganizationTaskProposal) -> JSON:
        """Owner freezes one accepted original task bid. Save the exact request/reference first."""
        return self._call('propose_organization_task', organization_id, request)

    def recover_organization_task(self, organization_id: str, client_reference: str) -> JSON:
        return self._call('recover_organization_task', organization_id, query={'client_reference': original_task_reference(client_reference)})

    def inspect_organization_task(self, organization_id: str, authorization_id: str) -> JSON:
        return self._call('inspect_organization_task', organization_id, path_parameters={'authorizationId': authorization_id})

    def approve_organization_task(self, organization_id: str, authorization_id: str, decision: OrganizationTaskDecision) -> JSON:
        """Selected independent reviewer only; preserve the original hash, version and reference."""
        return self._call('approve_organization_task', organization_id, decision, path_parameters={'authorizationId': authorization_id})

    def revoke_organization_task(self, organization_id: str, authorization_id: str) -> JSON:
        return self._call('revoke_organization_task', organization_id, path_parameters={'authorizationId': authorization_id})

    def checkout_organization_task(self, organization_id: str, authorization_id: str, request: OrganizationTaskCheckoutInput) -> OrganizationTaskCheckout:
        """Assigned buyer creates the original unpaid trade. Does not sign, broadcast or retry."""
        return cast(OrganizationTaskCheckout, self._call('checkout_organization_task', organization_id, request, path_parameters={'authorizationId': authorization_id}))

    def recover_organization_task_checkout(self, organization_id: str, authorization_id: str) -> OrganizationTaskCheckout:
        """Recover the original trade after uncertainty, cancellation or revocation."""
        return cast(OrganizationTaskCheckout, self._call('recover_organization_task_checkout', organization_id, path_parameters={'authorizationId': authorization_id}))

    def confirm_task_delivery(self, trade_id: str, content_hash: str) -> JSON:
        """Explicit original buyer decision for exact delivered bytes. Never accepts automatically."""
        if not isinstance(content_hash, str) or not re.fullmatch(r'[a-f0-9]{64}', content_hash):
            raise ValueError('original delivery content_hash must be a SHA-256 hash')
        return self._call('confirm_trade', trade_id, {'content_hash': content_hash})

    def propose_organization_workflow(self, organization_id: str, request: JSON) -> JSON:
        """Current owner freezes one exact L1 or Tempo workflow for independent review. Save the exact request first."""
        return self._call('propose_organization_workflow', organization_id, request)

    def recover_organization_workflow(self, organization_id: str, client_reference: str) -> JSON:
        return self._call('recover_organization_workflow', organization_id, query={'client_reference': original_grant_reference(client_reference)})

    def inspect_organization_workflow(self, organization_id: str, authorization_id: str) -> JSON:
        return self._call('inspect_organization_workflow', organization_id, path_parameters={'authorizationId': authorization_id})

    def approve_organization_workflow(self, organization_id: str, authorization_id: str, decision: JSON) -> JSON:
        """Only the selected independent reviewer; never retries or changes the original hash/reference."""
        return self._call('approve_organization_workflow', organization_id, decision, path_parameters={'authorizationId': authorization_id})

    def revoke_organization_workflow(self, organization_id: str, authorization_id: str) -> JSON:
        return self._call('revoke_organization_workflow', organization_id, path_parameters={'authorizationId': authorization_id})

    def create_spending_account(self, organization_id: str, request: SpendingGrantInput) -> SpendingGrantResult:
        """Persist the reviewed body/reference first. A replay never reissues the once-only key."""
        return cast(SpendingGrantResult, self._call('create_spending_account', organization_id, request))

    def revoke_spending_account(self, organization_id: str, account_id: str) -> JSON:
        if not isinstance(account_id, str) or UUID.fullmatch(account_id) is None:
            raise ValueError('account_id must be a UUID')
        return self._call('revoke_spending_account', organization_id, {'account_id': account_id})

    def organization_spending(self, organization_id: str) -> OrganizationSpendingClient:
        """Distinct cmos_ credential only; returned surface has no general buyer or owner operations."""
        return OrganizationSpendingClient(self, organization_id)

    def plan_route(self, request: JSON) -> JSON:
        return self._call("plan_work", body=request)

    def get_route(self, route_id: str) -> JSON:
        return self._call("inspect_route", route_id)

    def execute_route(self, route_id: str, mandate_id: str | None = None) -> JSON:
        return self._call("execute_route", route_id, None if mandate_id is None else {"mandate_id": mandate_id})

    def get_route_mandate(self, route_id: str) -> JSON:
        return self._call("inspect_route_mandate", route_id)

    def create_route_mandate(self, route_id: str, terms: JSON) -> JSON:
        return self._call("create_route_mandate", route_id, terms)

    def revoke_route_mandate(self, route_id: str) -> JSON:
        return self._call("revoke_route_mandate", route_id)

    def cancel_route(self, route_id: str, *, precondition: JSON | None = None) -> JSON:
        return self._call("cancel_planned_route", route_id, precondition)

    def inspect_route_lifecycle(self, route_id: str) -> JSON:
        return self._call("inspect_route_lifecycle", route_id)

    def advance_route(self, route_id: str, command: JSON) -> JSON:
        return self._call("advance_route_lifecycle", route_id, command)

    def get_route_result(self, route_id: str) -> JSON:
        return self._call("get_route_result", route_id)

    def inspect_route_retry(self, route_id: str) -> JSON:
        return self._call("inspect_route_retry", route_id)

    def retry_route(self, route_id: str, command: JSON) -> JSON:
        return self._call("retry_funded_route", route_id, command)

    def get_spending_policy(self) -> JSON:
        return self._call("get_spending_policy")

    def create_buyer_evm_payment_intent(self, trade_id: str, request: EvmIntentInput) -> JSON:
        return self._call("create_evm_payment_intent", trade_id, request)

    def get_buyer_evm_payment_intent(self, trade_id: str) -> JSON:
        return self._call("recover_evm_payment_intent", trade_id)

    def claim_buyer_evm_payment(self, trade_id: str, request: JSON) -> JSON:
        return self._call("claim_buyer_evm_payment", trade_id, request)

    def verify_buyer_evm_funding(self, trade_id: str, proof: EvmFundingProof) -> FundingVerification:
        return cast(FundingVerification, self._call("fund_trade_evm", trade_id, proof))

    def create_buyer_mpp_payment_intent(self, trade_id: str, buyer_operation_id: str) -> JSON:
        return self._call("create_mpp_payment_intent", trade_id, {"buyer_operation_id": buyer_operation_id})

    def get_buyer_mpp_payment_intent(self, trade_id: str) -> JSON:
        return self._call("recover_mpp_payment_intent", trade_id)

    def claim_buyer_mpp_payment(self, trade_id: str, request: JSON) -> JSON:
        return self._call("claim_buyer_mpp_payment", trade_id, request)

    def verify_buyer_mpp_funding(self, trade_id: str, proof: MppFundingProof) -> FundingVerification:
        return cast(FundingVerification, self._call("fund_trade_mpp", trade_id, proof))

    def upload_artifact(self, trade_id: str, request: JSON) -> JSON:
        return self._call("upload_artifact", trade_id, request)

    def list_artifacts(self, trade_id: str) -> JSON:
        return self._call("list_artifacts", trade_id)

    def deliver_trade(self, trade_id: str, request: JSON) -> JSON:
        return self._call("deliver_trade", trade_id, request)

    def download_artifact(self, artifact: JSON) -> bytes:
        size, digest = artifact["size_bytes"], artifact["sha256"]
        if type(size) is not int or not 1 <= size <= 65_536 or re.fullmatch(r"[a-f0-9]{64}", digest) is None:
            raise ValueError("Invalid artifact size or SHA256")
        method, path = self._path("download_artifact", artifact["trade_id"], artifactId=artifact["id"])
        with self._open(method, path, None, "application/octet-stream") as response:
            if not 200 <= response.status < 300:
                self._json(response)
            if response.headers.get("Content-Length") != str(size):
                raise ClawdMarketTransportError("Artifact size did not match")
            content = self._read(response, size)
            if (len(content) != size or hashlib.sha256(content).hexdigest() != digest
                    or response.headers.get("X-Artifact-SHA256") != digest):
                raise ClawdMarketTransportError("Artifact integrity check failed")
            return content

    def list_webhooks(self) -> JSON:
        return self._call("list_webhooks")

    def get_webhook_deliveries(self) -> JSON:
        return self._call("inspect_webhook_deliveries")

    def disable_webhook(self, webhook_id: str) -> JSON:
        return self._call("disable_webhook", webhook_id)

    def get_work_order(self, trade_id: str) -> JSON:
        return self._call("inspect_work_order", trade_id)

    def get_service_order(self, order_id: str) -> JSON:
        return self._call("get_reusable_order", order_id)

    def wait_for_route(self, route_id: str, *, states: tuple[str, ...] = ("completed", "failed", "cancelled", "disputed", "resolved"), poll_interval: float = 1, timeout: float = 60) -> JSON:
        if not all(math.isfinite(n) and n > 0 for n in (poll_interval, timeout)):
            raise ValueError("Polling interval and timeout must be positive and finite")
        deadline, last_state = time.monotonic() + timeout, None
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise ClawdMarketTimeoutError(route_id, last_state)
            try:
                snapshot = self._call("inspect_route", route_id, timeout=min(self.timeout, remaining))
            except ClawdMarketTransportError as error:
                if time.monotonic() >= deadline:
                    raise ClawdMarketTimeoutError(route_id, last_state) from error
                raise
            last_state = snapshot["route"]["state"]
            if last_state in states:
                return snapshot
            time.sleep(min(poll_interval, max(0, deadline - time.monotonic())))
