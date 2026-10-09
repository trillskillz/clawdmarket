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
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
from http.client import HTTPException
from email.utils import parsedate_to_datetime

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
            if UUID.fullmatch(value) is None:
                raise ValueError(f"{name} must be a UUID")
            path = path.replace("{" + name + "}", value)
        return spec["method"], path

    def _open(self, method: str, path: str, body: Mapping[str, Any] | None, accept: str, timeout: float | None = None):
        headers = {"Authorization": f"Bearer {self._key}", "Accept": accept}
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

    def _call(self, operation: str, record_id: str | None = None, body: Mapping[str, Any] | None = None, *, timeout: float | None = None) -> JSON:
        method, path = self._path(operation, record_id)
        with self._open(method, path, body, "application/json", timeout) as response:
            return self._json(response)

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

    def cancel_route(self, route_id: str) -> JSON:
        return self._call("cancel_planned_route", route_id)

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
