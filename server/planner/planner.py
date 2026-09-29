"""
Mintx — Action Planner

Takes a SanitizedContext and produces an ActionPlan.

Supports two modes:
1. Text-only (LLM): Uses DOM context + vision summary text
2. Vision (VLM): Sends redacted screenshot alongside text context

For SIH demo, this can talk to:
- Local Ollama (text or multimodal models)
- Together AI, Groq, OpenRouter (cloud-hosted open models)

The VLM/LLM must understand that:
- It only sees tokenized values, never real PII
- Screenshots are already redacted — PII regions are masked/blurred
- It should reference available_tokens when actions need data
- It must return structured JSON matching the ActionPlan schema
"""

import json
import os
import base64
import httpx
import logging
from models.schemas import SanitizedContext, ActionPlan, Action

logger = logging.getLogger("mintx.planner")

# ── Configuration ──
# Default: Ollama local. Override with env vars for cloud providers.
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "http://localhost:11434/v1")
LLM_MODEL = os.getenv("LLM_MODEL", "qwen2.5:7b")
LLM_API_KEY = os.getenv("LLM_API_KEY", "ollama")

# VLM config — used when screenshots are available
# Set to a multimodal model that accepts images
VLM_BASE_URL = os.getenv("VLM_BASE_URL", os.getenv("LLM_BASE_URL", "http://localhost:11434/v1"))
VLM_MODEL = os.getenv("VLM_MODEL", "llava:7b")  # default multimodal model for Ollama
VLM_API_KEY = os.getenv("VLM_API_KEY", os.getenv("LLM_API_KEY", "ollama"))


SYSTEM_PROMPT = """You are Mintx, a privacy-preserving browser automation agent. You receive sanitized context about a web page and must return an action plan.

IMPORTANT RULES:
1. You NEVER see real user data — only placeholder tokens like [NAME_001], [EMAIL_001].
2. If a screenshot is provided, it has been REDACTED — sensitive areas are blurred, blacked out, or masked with colored labels. Use it to understand page layout, but DO NOT try to read redacted content.
3. When an action needs to input user data, use the token reference (e.g., "[NAME_001]"), not a made-up value.
4. You can only reference tokens listed in "available_tokens".
5. Return a JSON object with: reasoning (string), actions (array), task_complete (boolean).
6. Each action has: action_id (string), type (click|type|scroll|select|wait), target_element_id (string), value (string|null), risk_tier (low|medium|high).
7. Be conservative — prefer fewer actions per step. The agent will re-observe after each batch.
8. Set task_complete to true only when the user's intent is fully accomplished.

Respond with ONLY valid JSON, no markdown fences."""


async def generate_action_plan(context: SanitizedContext) -> ActionPlan:
    """
    Send sanitized context to LLM/VLM, parse response into ActionPlan.
    Routes to VLM if screenshot is available, otherwise uses text-only LLM.
    """
    has_screenshot = context.screenshot_base64 is not None

    if has_screenshot:
        logger.info("Using VLM mode (screenshot available)")
        return await _plan_with_vlm(context)
    else:
        logger.info("Using text-only LLM mode")
        return await _plan_with_llm(context)


async def _plan_with_llm(context: SanitizedContext) -> ActionPlan:
    """Text-only planning via LLM."""
    user_message = format_context(context)

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            f"{LLM_BASE_URL}/chat/completions",
            headers={
                "Authorization": f"Bearer {LLM_API_KEY}",
                "Content-Type": "application/json"
            },
            json={
                "model": LLM_MODEL,
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_message}
                ],
                "temperature": 0.1,
                "max_tokens": 1024,
                "response_format": {"type": "json_object"}
            }
        )

    return _parse_response(response, context)


async def _plan_with_vlm(context: SanitizedContext) -> ActionPlan:
    """
    Vision-language planning — sends redacted screenshot + text context.
    Uses OpenAI-compatible multimodal API format.
    """
    text_context = format_context(context)

    # Extract base64 data from data URL
    screenshot_b64 = context.screenshot_base64
    if screenshot_b64 and screenshot_b64.startswith("data:"):
        # Strip "data:image/png;base64," prefix
        screenshot_b64 = screenshot_b64.split(",", 1)[1]

    # Build multimodal message with image + text
    user_content = [
        {
            "type": "image_url",
            "image_url": {
                "url": f"data:image/png;base64,{screenshot_b64}",
                "detail": "low"  # low detail to save tokens/latency
            }
        },
        {
            "type": "text",
            "text": (
                "This is a REDACTED screenshot of the page. Sensitive data has been "
                "masked/blurred/blacked out for privacy. Use it to understand layout.\n\n"
                + text_context
            )
        }
    ]

    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            f"{VLM_BASE_URL}/chat/completions",
            headers={
                "Authorization": f"Bearer {VLM_API_KEY}",
                "Content-Type": "application/json"
            },
            json={
                "model": VLM_MODEL,
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_content}
                ],
                "temperature": 0.1,
                "max_tokens": 1024,
            }
        )

    return _parse_response(response, context)


def _parse_response(response, context: SanitizedContext) -> ActionPlan:
    """Parse LLM/VLM response into ActionPlan."""
    if response.status_code != 200:
        raise RuntimeError(f"API error: {response.status_code} — {response.text}")

    result = response.json()
    content = result["choices"][0]["message"]["content"]

    # Try to extract JSON from response (handle markdown fences)
    content = content.strip()
    if content.startswith("```"):
        # Strip markdown code fences
        lines = content.split("\n")
        content = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])

    plan_data = json.loads(content)

    # Build ActionPlan with proper action IDs
    req_id = context.request_id.split("_")[1] if "_" in context.request_id else "x"
    actions = []
    for i, a in enumerate(plan_data.get("actions", [])):
        actions.append(Action(
            action_id=f"act_{req_id}_{i+1}",
            type=a.get("type", "click"),
            target_element_id=a.get("target_element_id"),
            value=a.get("value"),
            risk_tier=a.get("risk_tier", "low")
        ))

    return ActionPlan(
        request_id=context.request_id,
        reasoning=plan_data.get("reasoning", ""),
        actions=actions,
        task_complete=plan_data.get("task_complete", False)
    )


def format_context(ctx: SanitizedContext) -> str:
    """Format SanitizedContext into a readable prompt for the LLM/VLM."""
    elements_str = "\n".join([
        f"  - [{e.element_id}] <{e.tag} type={e.type} role={e.role}> "
        f"label=\"{e.label or ''}\" placeholder=\"{e.placeholder or ''}\" "
        f"value_token={e.current_value_token or 'empty'}"
        for e in ctx.dom_elements
    ])

    history_str = "\n".join([
        f"  - {h.action_id}: {h.type} → {h.target} = {h.result}"
        for h in ctx.action_history
    ]) or "  (none)"

    return f"""USER INTENT: {ctx.user_intent}
PAGE: {ctx.page_domain}
VISION SUMMARY: {ctx.vision_summary}

AVAILABLE TOKENS: {', '.join(ctx.available_tokens) or '(none)'}

DOM ELEMENTS:
{elements_str}

ACTION HISTORY:
{history_str}

Return your action plan as JSON."""
