"""Separate reviewed listing authority; existing route/service credentials gain no listing scope."""
import re
from typing import Any, Literal, NotRequired, TypedDict


class _ListingPayment(TypedDict):
    token_address: str
    payer_address: str
    treasury_address: str
    minimum_token_reserve_units: str


class ListingEvmPayment(_ListingPayment):
    rail: Literal['evm']
    chain_id: Literal[1]
    minimum_native_reserve_wei: str
    max_gas_cost_wei: str


class ListingTempoPayment(_ListingPayment):
    rail: Literal['mpp']
    chain_id: Literal[4217]
    fee_token_address: str
    minimum_fee_token_reserve_units: str
    max_fee_token_cost_units: str


class _ListingProposal(TypedDict):
    client_reference: str
    listing_id: str
    buyer_agent_id: str
    delivery: dict[str, Any]
    reviewer_role_id: str
    expected_total: str
    max_daily: str
    max_monthly: str
    max_lifetime: str
    max_lifetime_chain_fee_units: str
    expires_at: str
    expected_token_decimals: int
    expected_token_usd_price: float


class OrganizationListingEvmProposal(_ListingProposal):
    version: Literal[1]
    payment: ListingEvmPayment


class OrganizationListingTempoProposal(_ListingProposal):
    version: Literal[2]
    payment: ListingTempoPayment


OrganizationListingProposal = OrganizationListingEvmProposal | OrganizationListingTempoProposal


class OrganizationListingCheckoutInput(TypedDict):
    version: Literal[1, 2]
    client_reference: str
    authority_hash: str


class OrganizationListingDecision(OrganizationListingCheckoutInput):
    approve: Literal[True]


class OrganizationListingAuthorization(TypedDict):
    id: str
    organization_id: str
    listing_id: str
    buyer_id: str
    team_id: str | None
    cost_center: str
    client_reference: str
    version: Literal[1, 2]
    state: Literal['pending', 'approved', 'revoked']
    authority_hash: str
    terms: dict[str, Any]
    viewer_role: Literal['owner', 'reviewer']
    approved_at: str | None
    revoked_at: str | None
    decision: OrganizationListingDecision | None
    review_url: str
    checkout_available: bool


class OrganizationListingCheckout(TypedDict):
    ok: Literal[True]
    authorization_id: str
    authority_hash: str
    listing_id: str
    trade: dict[str, Any] | None
    checkout: dict[str, Any] | None
    delivery_contract: dict[str, Any]
    payment_authority: dict[str, Any]
    created: NotRequired[bool]


def original_listing_reference(value: str) -> str:
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9._:-]{8,128}', value):
        raise ValueError('original listing client_reference must be 8 to 128 allowed characters')
    return value
