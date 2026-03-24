import asyncio
import json
import logging
import random

import google.generativeai as genai

from ..config import (
    GEMINI_API_KEY, PEXELS_API_KEY, BROLL_DIR, TRANSCRIPTS_DIR, PROMPTS_DIR,
)
from .. import clients
from .ai import PRICING, _split_prompt_transcript

from .broll_prompt_v2 import BROLL_CUT_SHEET_PROMPT_V2

_BROLL_PROMPT_FILE = PROMPTS_DIR / "broll.txt"


def load_broll_prompt() -> str:
    """Read the B-roll prompt from disk if it exists, else use the hardcoded default."""
    try:
        if _BROLL_PROMPT_FILE.exists():
            text = _BROLL_PROMPT_FILE.read_text(encoding="utf-8").strip()
            if text:
                return text
    except Exception as exc:
        logging.getLogger(__name__).warning("Failed to read broll prompt file: %s", exc)
    return BROLL_CUT_SHEET_PROMPT_V2

logger = logging.getLogger(__name__)

MAX_RETRIES = 3
RETRY_BASE_DELAY = 2.0


def _calculate_cost(provider: str, model: str, input_tokens: int, output_tokens: int) -> float:
    p = PRICING.get(provider, {}).get(model, {"input": 0, "output": 0})
    return round((input_tokens * p["input"] + output_tokens * p["output"]) / 1_000_000, 6)


def _format_time(seconds: float | None) -> str:
    if seconds is None:
        return "00:00:00"
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    return f"{h:02d}:{m:02d}:{s:02d}"


def _format_transcript_for_broll(transcript_data: dict) -> str:
    """Format Rev.ai transcript for B-Roll Cut Sheet Master Prompt v2."""
    lines = []
    for sentence in transcript_data.get("sentences", []):
        start = _format_time(sentence.get("start"))
        end = _format_time(sentence.get("end"))
        speaker = sentence.get("speaker_name", "Unknown")
        text = sentence.get("text", "").strip()
        if text:
            lines.append(f'[{start} \u2013 {end}] {speaker}: "{text}"')
    return "\n".join(lines)


async def _generate_broll_anthropic(transcript_text: str, model: str, prompt_template: str) -> dict:
    client = clients.get_anthropic()
    system_text, user_text = _split_prompt_transcript(prompt_template, transcript_text)
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

    cache_hit = getattr(message.usage, "cache_read_input_tokens", 0) or 0
    if cache_hit:
        logger.info("B-roll Anthropic cache hit: %d tokens from cache", cache_hit)

    return {
        "raw": output_text,
        "input_tokens": message.usage.input_tokens,
        "output_tokens": message.usage.output_tokens,
    }


async def _generate_broll_openai(transcript_text: str, model: str, prompt_template: str) -> dict:
    client = clients.get_openai()
    full_prompt = prompt_template.replace("{transcript}", transcript_text)
    output_limit = 32768 if "4o" in model or "gpt-4" in model else 8192

    async with clients.ai_sem:
        response = await client.chat.completions.create(
            model=model,
            max_tokens=output_limit,
            messages=[{"role": "user", "content": full_prompt}],
        )

    return {
        "raw": response.choices[0].message.content,
        "input_tokens": response.usage.prompt_tokens,
        "output_tokens": response.usage.completion_tokens,
    }


async def _generate_broll_gemini(transcript_text: str, model: str, prompt_template: str) -> dict:
    genai.configure(api_key=GEMINI_API_KEY)
    output_limit = 65536 if "pro" in model else 8192
    gmodel = genai.GenerativeModel(
        model,
        generation_config=genai.types.GenerationConfig(max_output_tokens=output_limit),
    )
    full_prompt = prompt_template.replace("{transcript}", transcript_text)

    async def _call():
        return await gmodel.generate_content_async(full_prompt)

    async with clients.ai_sem:
        for attempt in range(MAX_RETRIES + 1):
            try:
                response = await _call()
                break
            except Exception as e:
                err_str = str(e).lower()
                if ("429" in err_str or "resource" in err_str or "quota" in err_str) and attempt < MAX_RETRIES:
                    delay = RETRY_BASE_DELAY * (2 ** attempt) + random.uniform(0, 1)
                    logger.warning("Gemini rate limited, retrying in %.1fs", delay)
                    await asyncio.sleep(delay)
                else:
                    raise

    inp = getattr(response.usage_metadata, "prompt_token_count", 0) if hasattr(response, "usage_metadata") else 0
    out = getattr(response.usage_metadata, "candidates_token_count", 0) if hasattr(response, "usage_metadata") else 0
    return {"raw": response.text, "input_tokens": inp, "output_tokens": out}


async def search_pexels(query: str, per_page: int = 5) -> dict:
    """Search Pexels video API to validate B-roll availability."""
    if not PEXELS_API_KEY or not PEXELS_API_KEY.strip():
        return {"available": False, "reason": "no_api_key", "results": []}

    headers = {"Authorization": PEXELS_API_KEY.strip()}
    try:
        client = clients.get_http()
        resp = await client.get(
            "https://api.pexels.com/videos/search",
            headers=headers,
            params={"query": query, "per_page": per_page},
            timeout=15,
        )
        if resp.status_code != 200:
            return {"available": False, "reason": f"api_error_{resp.status_code}", "results": []}
        data = resp.json()
        videos = data.get("videos", [])
        return {
            "available": len(videos) > 0,
            "total_results": data.get("total_results", 0),
            "results": [
                {
                    "id": v["id"],
                    "url": v.get("url", ""),
                    "duration": v.get("duration", 0),
                    "width": v.get("width", 0),
                    "height": v.get("height", 0),
                    "image": v.get("image", ""),
                }
                for v in videos[:per_page]
            ],
        }
    except Exception as e:
        logger.warning("Pexels search failed for '%s': %s", query, e)
        return {"available": False, "reason": str(e), "results": []}


async def generate_broll_suggestions(
    transcript_job_id: str,
    provider: str,
    model: str,
    verify_pexels: bool = True,
    custom_prompt: str | None = None,
) -> dict:
    """Generate B-roll cut sheet from transcript using B-Roll Cut Sheet Master Prompt v2."""
    transcript_path = TRANSCRIPTS_DIR / f"{transcript_job_id}.json"
    if not transcript_path.exists():
        raise FileNotFoundError(f"Transcript '{transcript_job_id}' not found")

    with open(transcript_path, encoding="utf-8") as f:
        transcript_data = json.load(f)

    transcript_text = _format_transcript_for_broll(transcript_data)

    base_prompt = custom_prompt.strip() if custom_prompt and custom_prompt.strip() else load_broll_prompt()
    if "{transcript}" not in base_prompt:
        base_prompt = base_prompt.rstrip() + "\n\nTRANSCRIPT:\n{transcript}"

    dispatch = {
        "anthropic": _generate_broll_anthropic,
        "openai": _generate_broll_openai,
        "gemini": _generate_broll_gemini,
    }
    fn = dispatch.get(provider)
    if not fn:
        raise ValueError(f"Unknown AI provider: {provider}")

    ai_result = await fn(transcript_text, model, base_prompt)
    cutsheet_markdown = ai_result["raw"].strip()

    inp = ai_result.get("input_tokens", 0)
    out = ai_result.get("output_tokens", 0)
    cost_usd = _calculate_cost(provider, model, inp, out)

    result = {
        "job_id": transcript_job_id,
        "provider": provider,
        "model": model,
        "input_tokens": inp,
        "output_tokens": out,
        "cost_usd": cost_usd,
        "cutsheet": cutsheet_markdown,
        "output_format": "markdown",
    }

    broll_path = BROLL_DIR / f"{transcript_job_id}_broll.json"
    with open(broll_path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)

    return result
