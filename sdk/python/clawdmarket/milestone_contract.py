"""Recover one original unfunded draft; no organization review or credit funding authority."""
import re
from typing import Any, Literal, NotRequired, TypedDict


class MilestoneDraftInput(TypedDict):
    title: str
    amount: float
    deadline_in_hours: NotRequired[int]
    review_window_hours: NotRequired[int]
    acceptance_spec: NotRequired[dict[str, Any]]


class MilestoneContractDraftInput(TypedDict):
    client_reference: str
    milestones: list[MilestoneDraftInput]
    seller_id: NotRequired[str]
    listing_id: NotRequired[str]
    expires_in_hours: NotRequired[int]


class OriginalContractCreation(TypedDict):
    contract: dict[str, Any]
    milestones: list[dict[str, Any]]
    creation: dict[str, str]
    idempotent: bool


def original_contract_creation_reference(value: str) -> str:
    if not isinstance(value, str) or re.fullmatch(r'[A-Za-z0-9._:-]{8,128}', value) is None:
        raise ValueError('original contract client_reference must be 8 to 128 allowed characters')
    return value


class OriginalContractAcceptanceInput(TypedDict):
    version: Literal[1]
    client_reference: str
    submission_id: str
    content_hash: str
    approve: Literal[True]


class OriginalContractAcceptance(TypedDict):
    decision: dict[str, Any]
    selected_submission_id: str | None
    applies_to_current_submission: bool
    current_milestone_state: str
    credit_remaining_principal_minor: int
    financial_release_performed: Literal[False]
    semantic_accuracy: Literal['unmeasured']
    idempotent: NotRequired[bool]
    observed_at: NotRequired[str]
