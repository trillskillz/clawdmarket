"""Recover one original unfunded draft; no organization review or credit funding authority."""
import re
from typing import Any, NotRequired, TypedDict


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
