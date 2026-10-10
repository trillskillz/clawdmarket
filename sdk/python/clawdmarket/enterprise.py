from __future__ import annotations

import re
from typing import TYPE_CHECKING, Any, Literal, TypedDict, cast

if TYPE_CHECKING:
    from .client import ClawdMarketClient, FundingVerification, MppFundingProof


class SpendingAllowedService(TypedDict):
    service_id: str
    provider_share_id: str | None


class SpendingGrantBase(TypedDict):
    client_reference: str
    name: str
    buyer_agent_id: str
    team_id: str | None
    cost_center: str
    allowed_services: list[SpendingAllowedService]
    expires_at: str
    max_purchase: str
    max_daily: str
    max_monthly: str
    max_lifetime: str


class SpendingPaymentBase(TypedDict):
    token_address: str
    payer_address: str
    treasury_address: str
    minimum_token_reserve_units: str


class SpendingEvmPayment(SpendingPaymentBase):
    chain_id: Literal[1, 11155111]
    rail: Literal['evm']
    minimum_native_reserve_wei: str
    max_gas_cost_wei: str
    max_lifetime_gas_cost_wei: str


class SpendingTempoPayment(SpendingPaymentBase):
    chain_id: Literal[4217]
    rail: Literal['mpp']
    fee_token_address: str
    minimum_fee_token_reserve_units: str
    max_fee_token_cost_units: str
    max_lifetime_fee_token_cost_units: str


class SpendingCreditGrant(SpendingGrantBase):
    version: Literal[1]


class SpendingEvmGrant(SpendingGrantBase):
    version: Literal[2]
    payment: SpendingEvmPayment


class SpendingReviewedEvmGrant(SpendingEvmGrant):
    expected_token_decimals: int
    expected_token_usd_price: float


class SpendingTempoGrant(SpendingGrantBase):
    version: Literal[3]
    payment: SpendingTempoPayment


class SpendingReviewedTempoGrant(SpendingTempoGrant):
    expected_token_decimals: Literal[6]
    expected_token_usd_price: Literal[1]


SpendingGrantInput = SpendingCreditGrant | SpendingEvmGrant | SpendingReviewedEvmGrant | SpendingTempoGrant | SpendingReviewedTempoGrant


class SpendingAccountBase(SpendingGrantBase):
    id: str
    organization_id: str
    state: Literal['active', 'revoked']
    created_at: str
    revoked_at: str | None
    credential_prefix: str


class SpendingCreditAccount(SpendingAccountBase):
    version: Literal[1]
    authority: Literal['approved_direct_service_credit']


class SpendingEvmAccount(SpendingAccountBase):
    version: Literal[2]
    authority: Literal['approved_direct_service_evm']
    payment: SpendingEvmPayment
    token_decimals: int
    token_usd_price: float


class SpendingTempoAccount(SpendingAccountBase):
    version: Literal[3]
    authority: Literal['approved_direct_service_mpp']
    payment: SpendingTempoPayment
    token_decimals: Literal[6]
    token_usd_price: Literal[1]


SpendingAccount = SpendingCreditAccount | SpendingEvmAccount | SpendingTempoAccount


class SpendingGrantResult(TypedDict):
    account: SpendingAccount
    api_key: str | None
    idempotent: bool


class SpendingOrderTerms(TypedDict):
    client_reference: str
    objective: str
    payment_rail: Literal['credit', 'evm', 'mpp']
    purchasing_approval_id: str


class SpendingOrderOptions(SpendingOrderTerms, total=False):
    input: dict[str, Any]
    provider_share_id: str
    provider_requirements: dict[str, Any]
    expected_price: str
    max_total: str


class SpendingOrderInput(TypedDict):
    service_id: str
    order: SpendingOrderOptions


class SpendingEvmClaimInput(TypedDict):
    intent_id: str
    mandate_id: str
    buyer_operation_id: str
    serialized_transaction: str
    payer_signature: str


class SpendingEvmIntentInput(TypedDict):
    buyer_operation_id: str
    chain_id: Literal[1, 11155111]
    token_address: str
    payer_address: str


class SpendingEvmFundingProof(TypedDict):
    intent_id: str
    chain_id: Literal[1, 11155111]
    token_address: str
    payer_address: str
    tx_hash: str
    payer_signature: str


class SpendingTempoClaimInput(TypedDict):
    intent_id: str
    mandate_id: str
    buyer_operation_id: str
    serialized_transaction: str


def original_grant_reference(value: str) -> str:
    if not isinstance(value, str) or value != value.strip() or not 8 <= len(value.encode('utf-16-le')) // 2 <= 200:
        raise ValueError('original client_reference must be 8 to 200 characters without surrounding whitespace')
    return value


def original_tempo_credential(value: str) -> str:
    if not isinstance(value, str) or len(value) > 16_384 or re.fullmatch(r'Payment [\x21-\x7e]+', value) is None:
        raise ValueError('original Tempo credential must be a bounded single-line Payment header')
    return value


class OrganizationSpendingClient:
    """Exact approved service purchasing. Revocation recovery requires the original buyer client."""
    def __init__(self, client: ClawdMarketClient, organization_id: str):
        if re.fullmatch(r'cmos_[a-f0-9]{64}', client._key) is None:
            raise ValueError('organization spending requires the distinct cmos_ credential')
        client._path('spending_account_service_order', organization_id)
        self._client, self._organization_id = client, organization_id

    def _call(self, operation: str, trade_id: str | None = None, body=None, *, query=None, payment_credential=None):
        params = {} if trade_id is None else {'tradeId': trade_id}
        return self._client._call(operation, self._organization_id, body, path_parameters=params, query=query, payment_credential=payment_credential)

    def order_service(self, request: SpendingOrderInput) -> dict[str, Any]:
        return self._call('spending_account_service_order', body=request)

    def get_order(self, order_id: str) -> dict[str, Any]:
        # Validate even though this identifier appears in a query rather than the path.
        from .client import UUID
        if not isinstance(order_id, str) or UUID.fullmatch(order_id) is None:
            raise ValueError('order_id must be a UUID')
        return self._call('inspect_spending_account_order', query={'order_id': order_id})

    def create_evm_payment_intent(self, trade_id: str, request: SpendingEvmIntentInput) -> dict[str, Any]:
        return self._call('spending_evm_intent', trade_id, request)

    def get_evm_payment_intent(self, trade_id: str) -> dict[str, Any]:
        return self._call('recover_spending_evm_intent', trade_id)

    def claim_evm_payment(self, trade_id: str, request: SpendingEvmClaimInput) -> dict[str, Any]:
        return self._call('spending_evm_claim', trade_id, request)

    def verify_evm_funding(self, trade_id: str, proof: SpendingEvmFundingProof) -> FundingVerification:
        return cast('FundingVerification', self._call('spending_evm_proof', trade_id, proof))

    def create_tempo_payment_intent(self, trade_id: str, buyer_operation_id: str) -> dict[str, Any]:
        return self._call('spending_mpp_intent', trade_id, {'buyer_operation_id': buyer_operation_id})

    def get_tempo_payment_intent(self, trade_id: str) -> dict[str, Any]:
        return self._call('recover_spending_mpp_intent', trade_id)

    def claim_tempo_payment(self, trade_id: str, request: SpendingTempoClaimInput) -> dict[str, Any]:
        return self._call('spending_mpp_claim', trade_id, request)

    def verify_tempo_funding(self, trade_id: str, proof: MppFundingProof) -> FundingVerification:
        return cast('FundingVerification', self._call('spending_mpp_proof', trade_id, proof))

    def submit_original_tempo_credential(self, trade_id: str, credential: str) -> FundingVerification:
        """Explicit saved credential submission; the server may broadcast its original claimed bytes."""
        return cast('FundingVerification', self._call('spending_mpp_proof', trade_id, payment_credential=original_tempo_credential(credential)))
