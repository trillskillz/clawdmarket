"""Separate reviewed task authority; existing route/service credentials gain no task scope."""
import re
from typing import Any, Literal, NotRequired, TypedDict


class _TaskPayment(TypedDict):
    token_address: str
    payer_address: str
    treasury_address: str
    minimum_token_reserve_units: str


class TaskEvmPayment(_TaskPayment):
    rail: Literal['evm']
    chain_id: Literal[1]
    minimum_native_reserve_wei: str
    max_gas_cost_wei: str


class TaskTempoPayment(_TaskPayment):
    rail: Literal['mpp']
    chain_id: Literal[4217]
    fee_token_address: str
    minimum_fee_token_reserve_units: str
    max_fee_token_cost_units: str


class _TaskProposal(TypedDict):
    client_reference: str
    task_id: str
    winning_bid_id: str
    reviewer_role_id: str
    expected_total: str
    max_daily: str
    max_monthly: str
    max_lifetime: str
    max_lifetime_chain_fee_units: str
    expires_at: str
    expected_token_decimals: int
    expected_token_usd_price: float


class OrganizationTaskEvmProposal(_TaskProposal):
    version: Literal[1]
    payment: TaskEvmPayment


class OrganizationTaskTempoProposal(_TaskProposal):
    version: Literal[2]
    payment: TaskTempoPayment


OrganizationTaskProposal = OrganizationTaskEvmProposal | OrganizationTaskTempoProposal


class OrganizationTaskCheckoutInput(TypedDict):
    version: Literal[1, 2]
    client_reference: str
    authority_hash: str


class OrganizationTaskDecision(OrganizationTaskCheckoutInput):
    approve: Literal[True]


class OrganizationTaskAuthorization(TypedDict):
    id: str
    organization_id: str
    task_id: str
    winning_bid_id: str
    buyer_id: str
    team_id: str | None
    cost_center: str
    client_reference: str
    version: Literal[1, 2]
    state: Literal['pending', 'approved', 'revoked']
    authority_hash: str
    terms: dict[str, Any]
    reviewer_account_id: str
    viewer_role: Literal['owner', 'reviewer']
    approved_at: str | None
    revoked_at: str | None
    review_url: str
    decision: OrganizationTaskDecision | None
    use: dict[str, Any] | None


class OrganizationTaskCheckout(TypedDict):
    ok: Literal[True]
    authorization_id: str
    authority_hash: str
    task_id: str
    trade: dict[str, Any] | None
    checkout: dict[str, Any] | None
    workspace_url: str
    payment_authority: dict[str, Any]
    created: NotRequired[bool]


def original_task_reference(value: str) -> str:
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9._:-]{8,128}', value):
        raise ValueError('original task client_reference must be 8 to 128 allowed characters')
    return value
