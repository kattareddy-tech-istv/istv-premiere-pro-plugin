import asyncio
import logging
import random

import anthropic
import openai
import google.generativeai as genai

from ..config import GEMINI_API_KEY, PROMPTS_DIR, CUTSHEET_PROMPT_FILE
from .. import clients

logger = logging.getLogger(__name__)

MAX_RETRIES = 3
RETRY_BASE_DELAY = 2.0

ANTHROPIC_FALLBACK = {
    "claude-opus-4-6": "claude-sonnet-4-5",
    "claude-sonnet-4-5": "claude-haiku-4-5",
}
OPENAI_FALLBACK = {
    "gpt-4o": "gpt-4o-mini",
    "gpt-4-turbo": "gpt-4o",
}
GEMINI_FALLBACK = {
    "gemini-2.0-pro": "gemini-2.0-flash",
    "gemini-1.5-pro": "gemini-2.0-flash",
}

# ── Pricing per 1M tokens (USD) ─────────────────────────────────────────────
PRICING = {
    "anthropic": {
        "claude-opus-4-6":               {"input": 5.0,  "output": 25.0},
        "claude-sonnet-4-5":             {"input": 3.0,  "output": 15.0},
        "claude-haiku-4-5":              {"input": 1.0,  "output": 5.0},
    },
    "openai": {
        "gpt-4o":       {"input": 2.5,  "output": 10.0},
        "gpt-4o-mini":  {"input": 0.15, "output": 0.6},
        "gpt-4-turbo":  {"input": 10.0, "output": 30.0},
    },
    "gemini": {
        "gemini-2.0-flash":  {"input": 0.075, "output": 0.3},
        "gemini-1.5-pro":    {"input": 1.25,  "output": 5.0},
        "gemini-2.0-pro":    {"input": 1.25,  "output": 10.0},
    },
}


_FALLBACK_CUTSHEET_PROMPT = (
    "Missing DOCUMENTARY_CUT_SHEET_PROMPT.txt. Add it at the repo root next to `backend/`, "
    "or set CUTSHEET_PROMPT_FILE.\n\nTRANSCRIPT:\n{transcript}\n"
)

_LEGACY_CUTSHEET_FILE = PROMPTS_DIR / "cutsheet.txt"


def load_cutsheet_prompt() -> str:
    """Load cut-sheet instructions from repo-root file (preferred), legacy data path, or fallback."""
    paths = [CUTSHEET_PROMPT_FILE, _LEGACY_CUTSHEET_FILE]
    for path in paths:
        try:
            if path.exists():
                t = path.read_text(encoding="utf-8").strip()
                if t:
                    return t
        except OSError as exc:
            logger.warning("Failed to read cutsheet prompt file %s: %s", path, exc)
    return _FALLBACK_CUTSHEET_PROMPT


def _calculate_cost(provider: str, model: str, input_tokens: int, output_tokens: int) -> float:
    p = PRICING.get(provider, {}).get(model, {"input": 0, "output": 0})
    return round((input_tokens * p["input"] + output_tokens * p["output"]) / 1_000_000, 6)


# ── Retry helper for Gemini (Anthropic/OpenAI SDKs have built-in retry) ─────

async def _retry_gemini(fn, *args, retries=MAX_RETRIES):
    for attempt in range(retries + 1):
        try:
            return await fn(*args)
        except Exception as e:
            err_str = str(e).lower()
            if ("429" in err_str or "resource" in err_str or "quota" in err_str) and attempt < retries:
                delay = RETRY_BASE_DELAY * (2 ** attempt) + random.uniform(0, 1)
                logger.warning("Gemini rate limited (attempt %d/%d), retrying in %.1fs", attempt + 1, retries + 1, delay)
                await asyncio.sleep(delay)
            else:
                raise


# ── Prompt splitting helper (for Anthropic prompt caching) ───────────────────

def _split_prompt_transcript(prompt: str, transcript_text: str) -> tuple[str, str]:
    """Split a prompt template at {transcript} into (system_text, user_text).
    The system portion gets cached by Anthropic, saving tokens + cost."""
    if "{transcript}" in prompt:
        idx = prompt.index("{transcript}")
        system_text = prompt[:idx].rstrip()
        after = prompt[idx + len("{transcript}"):].strip()
        user_text = f"TRANSCRIPT:\n{transcript_text}"
        if after:
            user_text += f"\n\n{after}"
    else:
        system_text = prompt
        user_text = transcript_text
    return system_text, user_text


# ── Anthropic (Claude) — with prompt caching ────────────────────────────────

async def _generate_anthropic(transcript_text: str, model: str, prompt: str) -> dict:
    client = clients.get_anthropic()
    system_text, user_text = _split_prompt_transcript(prompt, transcript_text)
    output_limit = 65536 if "opus" in model else 32768

    async with clients.ai_sem:
        async with client.messages.stream(
            model=model,
            max_tokens=output_limit,
            system=[{
                "type": "text",
                "text": system_text,
                "cache_control": {"type": "ephemeral"},
            }],
            messages=[{"role": "user", "content": user_text}],
        ) as stream:
            output_text = ""
            async for text in stream.text_stream:
                output_text += text
            message = await stream.get_final_message()
            inp = message.usage.input_tokens
            out = message.usage.output_tokens

    cache_hit = getattr(message.usage, "cache_read_input_tokens", 0) or 0
    if cache_hit:
        logger.info("Anthropic cache hit: %d tokens read from cache", cache_hit)

    return {
        "cutsheet": output_text,
        "provider": "anthropic",
        "model": model,
        "input_tokens": inp,
        "output_tokens": out,
        "cost_usd": _calculate_cost("anthropic", model, inp, out),
    }


# ── OpenAI ───────────────────────────────────────────────────────────────────

async def _generate_openai(transcript_text: str, model: str, prompt: str) -> dict:
    client = clients.get_openai()
    full_prompt = prompt.replace("{transcript}", transcript_text)
    output_limit = 16384 if "4o" in model else 4096

    async with clients.ai_sem:
        response = await client.chat.completions.create(
            model=model,
            max_tokens=output_limit,
            messages=[{"role": "user", "content": full_prompt}],
        )

    output_text = response.choices[0].message.content
    inp = response.usage.prompt_tokens
    out = response.usage.completion_tokens

    return {
        "cutsheet": output_text,
        "provider": "openai",
        "model": model,
        "input_tokens": inp,
        "output_tokens": out,
        "cost_usd": _calculate_cost("openai", model, inp, out),
    }


# ── Google Gemini ────────────────────────────────────────────────────────────

async def _generate_gemini(transcript_text: str, model: str, prompt: str) -> dict:
    genai.configure(api_key=GEMINI_API_KEY)
    output_limit = 65536 if "pro" in model else 8192
    gmodel = genai.GenerativeModel(
        model,
        generation_config=genai.types.GenerationConfig(max_output_tokens=output_limit),
    )
    full_prompt = prompt.replace("{transcript}", transcript_text)

    async def _call():
        return await gmodel.generate_content_async(full_prompt)

    async with clients.ai_sem:
        response = await _retry_gemini(_call)

    output_text = response.text
    inp = getattr(response.usage_metadata, "prompt_token_count", 0) if hasattr(response, "usage_metadata") else 0
    out = getattr(response.usage_metadata, "candidates_token_count", 0) if hasattr(response, "usage_metadata") else 0

    return {
        "cutsheet": output_text,
        "provider": "gemini",
        "model": model,
        "input_tokens": inp,
        "output_tokens": out,
        "cost_usd": _calculate_cost("gemini", model, inp, out),
    }


# ── Fallback helpers ─────────────────────────────────────────────────────────

def _is_rate_limit(exc: Exception) -> bool:
    if isinstance(exc, (anthropic.RateLimitError, openai.RateLimitError)):
        return True
    if isinstance(exc, anthropic.APIStatusError) and exc.status_code in (429, 529):
        return True
    if isinstance(exc, openai.APIStatusError) and exc.status_code == 429:
        return True
    err = str(exc).lower()
    return "429" in err or "rate" in err or "quota" in err

_FALLBACK_MAPS = {
    "anthropic": ANTHROPIC_FALLBACK,
    "openai": OPENAI_FALLBACK,
    "gemini": GEMINI_FALLBACK,
}


# ── Dispatcher ───────────────────────────────────────────────────────────────

async def generate_cutsheet(
    transcript_text: str,
    provider: str,
    model: str,
    custom_prompt: str | None = None,
) -> dict:
    prompt = custom_prompt or load_cutsheet_prompt()
    if "{transcript}" not in prompt:
        prompt += "\n\nTRANSCRIPT:\n{transcript}"

    dispatch = {
        "anthropic": _generate_anthropic,
        "openai": _generate_openai,
        "gemini": _generate_gemini,
    }

    fn = dispatch.get(provider)
    if not fn:
        raise ValueError(f"Unknown AI provider: {provider}")

    fallback_map = _FALLBACK_MAPS.get(provider, {})
    current_model = model

    while True:
        try:
            return await fn(transcript_text, current_model, prompt)
        except Exception as exc:
            fallback = fallback_map.get(current_model)
            if _is_rate_limit(exc) and fallback:
                logger.warning(
                    "Rate limited on %s/%s — falling back to %s",
                    provider, current_model, fallback,
                )
                current_model = fallback
                await asyncio.sleep(RETRY_BASE_DELAY + random.uniform(0, 1))
            else:
                raise
