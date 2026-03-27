import json
import logging
import traceback

import aiofiles

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from ..config import BROLL_DIR
from ..services.broll import generate_broll_suggestions, search_pexels, load_broll_prompt

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/broll", tags=["broll"])


class BRollRequest(BaseModel):
    transcript_job_id: str
    provider: str
    model: str
    verify_pexels: Optional[bool] = True
    custom_prompt: Optional[str] = None


class PexelsSearchRequest(BaseModel):
    query: str
    per_page: Optional[int] = 5


@router.post("/generate")
async def generate_broll(request: BRollRequest):
    """Generate B-roll suggestions for a transcript using AI."""
    try:
        result = await generate_broll_suggestions(
            transcript_job_id=request.transcript_job_id,
            provider=request.provider,
            model=request.model,
            verify_pexels=request.verify_pexels,
            custom_prompt=request.custom_prompt,
        )
        return result
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    except RuntimeError as e:
        raise HTTPException(500, str(e))
    except Exception as e:
        logger.error(f"B-roll generation failed: {traceback.format_exc()}")
        raise HTTPException(500, f"B-roll generation failed: {type(e).__name__}: {e}")


@router.get("/prompt")
async def get_broll_prompt():
    """Return the active B-roll prompt (hot-loaded from disk or hardcoded default)."""
    return {"prompt": load_broll_prompt()}


@router.get("/{job_id}")
async def get_broll(job_id: str):
    """Get cached B-roll suggestions."""
    broll_path = BROLL_DIR / f"{job_id}_broll.json"
    if not broll_path.exists():
        raise HTTPException(404, "B-roll suggestions not found")
    async with aiofiles.open(broll_path, encoding="utf-8") as f:
        return json.loads(await f.read())


@router.post("/search-pexels")
async def search_pexels_endpoint(request: PexelsSearchRequest):
    """Search Pexels for B-roll verification."""
    result = await search_pexels(request.query, request.per_page)
    return result
