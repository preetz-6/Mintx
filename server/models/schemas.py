"""
Pydantic schemas matching the data contracts.
"""

from pydantic import BaseModel
from typing import Optional
from datetime import datetime


# ── SanitizedContext (client → server) ──

class DomElement(BaseModel):
    element_id: str
    tag: str
    type: Optional[str] = None
    role: Optional[str] = None
    label: Optional[str] = None
    placeholder: Optional[str] = None
    current_value_token: Optional[str] = None


class ActionHistoryEntry(BaseModel):
    action_id: str
    type: str
    target: str
    result: str


class SanitizedContext(BaseModel):
    request_id: str
    timestamp: str
    user_intent: str
    page_domain: str
    dom_elements: list[DomElement]
    vision_summary: str
    available_tokens: list[str]
    action_history: list[ActionHistoryEntry] = []
    screenshot_base64: Optional[str] = None  # redacted screenshot data URL


# ── ActionPlan (server → client) ──

class Action(BaseModel):
    action_id: str
    type: str  # click, type, scroll, navigate, select, wait
    target_element_id: Optional[str] = None
    value: Optional[str] = None
    risk_tier: str = "low"  # low, medium, high, critical


class ActionPlan(BaseModel):
    request_id: str
    reasoning: str
    actions: list[Action]
    task_complete: bool = False
