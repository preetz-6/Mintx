"""
Mintx Server — FastAPI entry point.

Receives SanitizedContext from the browser extension,
passes it to the VLM planner, returns an ActionPlan.

No raw PII ever arrives here — only tokenized references.
"""

import os
import logging
from dotenv import load_dotenv

# Load .env before importing modules that read env vars
load_dotenv()

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import uvicorn

from planner.planner import generate_action_plan
from models.schemas import SanitizedContext, ActionPlan

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mintx")

app = FastAPI(
    title="Mintx Server",
    version="0.1.0",
    description="Privacy-preserving vision agent — server-side reasoning"
)

# CORS — allow extension to talk to us
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("MINTX_ALLOWED_ORIGINS", "http://localhost:3000").split(","),
    allow_origin_regex=r"^(chrome-extension://[a-p]{32}|moz-extension://[0-9a-f-]{36})$",
    allow_methods=["POST"],
    allow_headers=["Content-Type"],
)


@app.get("/health")
async def health():
    return {"status": "ok", "version": "0.1.0"}


@app.get("/config")
async def config():
    """Show current model config (no secrets)."""
    from planner.planner import LLM_BASE_URL, LLM_MODEL, VLM_BASE_URL, VLM_MODEL
    return {
        "llm_base_url": LLM_BASE_URL,
        "llm_model": LLM_MODEL,
        "vlm_base_url": VLM_BASE_URL,
        "vlm_model": VLM_MODEL,
    }


@app.on_event("startup")
async def startup():
    from planner.planner import LLM_BASE_URL, LLM_MODEL, VLM_BASE_URL, VLM_MODEL
    logger.info(f"Mintx Server starting")
    logger.info(f"  LLM: {LLM_MODEL} @ {LLM_BASE_URL}")
    logger.info(f"  VLM: {VLM_MODEL} @ {VLM_BASE_URL}")


@app.post("/api/plan", response_model=ActionPlan)
async def plan(context: SanitizedContext):
    """
    Receive sanitized context, reason over it, return an action plan.
    """
    try:
        action_plan = await generate_action_plan(context)
        return action_plan
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    uvicorn.run("main:app", host=os.getenv("MINTX_HOST", "127.0.0.1"), port=8000, reload=True)
