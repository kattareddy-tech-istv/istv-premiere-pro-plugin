"""
Singleton API clients with connection pooling and concurrency semaphores.

Initialised once at app startup via ``init_clients()``, torn down at
shutdown via ``close_clients()``.  Every service module imports the
getter helpers instead of constructing throw-away clients per request.
"""

import asyncio
import logging

import httpx
import anthropic
import openai
import google.generativeai as genai

from .config import (
    ANTHROPIC_API_KEY,
    OPENAI_API_KEY,
    GEMINI_API_KEY,
    MAX_CONCURRENT_REVAI,
    MAX_CONCURRENT_AI,
    MAX_CONCURRENT_FFMPEG,
)

logger = logging.getLogger(__name__)

# ── Private state ────────────────────────────────────────────────────────────
_http_client: httpx.AsyncClient | None = None
_anthropic_client: anthropic.AsyncAnthropic | None = None
_openai_client: openai.AsyncOpenAI | None = None
_gemini_configured: bool = False

# ── Semaphores ───────────────────────────────────────────────────────────────
revai_sem: asyncio.Semaphore | None = None
ai_sem: asyncio.Semaphore | None = None
ffmpeg_sem: asyncio.Semaphore | None = None


# ── Lifecycle ────────────────────────────────────────────────────────────────

def init_clients() -> None:
    global _http_client, _anthropic_client, _openai_client, _gemini_configured
    global revai_sem, ai_sem, ffmpeg_sem

    _http_client = httpx.AsyncClient(
        timeout=httpx.Timeout(connect=30, read=600, write=600, pool=30),
        limits=httpx.Limits(max_connections=100, max_keepalive_connections=20),
    )

    if ANTHROPIC_API_KEY:
        _anthropic_client = anthropic.AsyncAnthropic(
            api_key=ANTHROPIC_API_KEY,
            max_retries=2,
        )

    if OPENAI_API_KEY:
        _openai_client = openai.AsyncOpenAI(
            api_key=OPENAI_API_KEY,
            max_retries=2,
        )

    if GEMINI_API_KEY:
        genai.configure(api_key=GEMINI_API_KEY)
        _gemini_configured = True
        logger.info("Gemini client configured")

    revai_sem = asyncio.Semaphore(MAX_CONCURRENT_REVAI)
    ai_sem = asyncio.Semaphore(MAX_CONCURRENT_AI)
    ffmpeg_sem = asyncio.Semaphore(MAX_CONCURRENT_FFMPEG)

    logger.info(
        "Clients initialised  (revai=%d  ai=%d  ffmpeg=%d)",
        MAX_CONCURRENT_REVAI, MAX_CONCURRENT_AI, MAX_CONCURRENT_FFMPEG,
    )


async def close_clients() -> None:
    global _http_client, _anthropic_client, _openai_client
    if _http_client:
        await _http_client.aclose()
        _http_client = None
    if _anthropic_client:
        try:
            await _anthropic_client.close()
        except Exception:
            pass
        _anthropic_client = None
    if _openai_client:
        try:
            await _openai_client.close()
        except Exception:
            pass
        _openai_client = None
    logger.info("Clients closed")


# ── Getters ──────────────────────────────────────────────────────────────────

def get_http() -> httpx.AsyncClient:
    if _http_client is None:
        raise RuntimeError("HTTP client not initialised — call init_clients() first")
    return _http_client


def get_anthropic() -> anthropic.AsyncAnthropic:
    if _anthropic_client is None:
        raise RuntimeError("Anthropic client not initialised — check ANTHROPIC_API_KEY")
    return _anthropic_client


def get_openai() -> openai.AsyncOpenAI:
    if _openai_client is None:
        raise RuntimeError("OpenAI client not initialised — check OPENAI_API_KEY")
    return _openai_client


def get_gemini_model(model_name: str, max_output_tokens: int) -> "genai.GenerativeModel":
    """Return a GenerativeModel for the given model name.
    genai.configure() is already called once at startup."""
    if not _gemini_configured:
        raise RuntimeError("Gemini client not configured — check GEMINI_API_KEY")
    return genai.GenerativeModel(
        model_name,
        generation_config=genai.types.GenerationConfig(max_output_tokens=max_output_tokens),
    )
