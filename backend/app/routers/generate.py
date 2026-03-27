import asyncio
import json
import re

import aiofiles

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional

from ..config import TRANSCRIPTS_DIR, CUTSHEETS_DIR, PREMIERE_XMLS_DIR
from ..models import CutSheetRequest, PremiereExportRequest
from ..services.ai import generate_cutsheet, PRICING, load_cutsheet_prompt
from ..services.doc_formats import DOC_FORMATS
from ..services.premiere_xml import (
    generate_premiere_xml,
    get_parsed_clips_summary,
)
from ..services.premiere_xml_parser import load_parsed_xml

router = APIRouter(prefix="/api/generate", tags=["generate"])


# ── Cut-sheet timestamp parsing helpers ──────────────────────────────────────

# Matches [IP @ HH:MM:SS–HH:MM:SS] or [ALT @ HH:MM:SS-HH:MM:SS]
_CLIP_RE = re.compile(
    r'\[(?P<type>IP|ALT)\s*@\s*(?P<in>\d{2}:\d{2}:\d{2})[\u2013\-](?P<out>\d{2}:\d{2}:\d{2})\]'
)
_TONE_RE = re.compile(r'\[TONE:\s*([^\]]+)\]')


def _tc_to_seconds(tc: str) -> float:
    """Convert HH:MM:SS to seconds."""
    h, m, s = tc.split(":")
    return int(h) * 3600 + int(m) * 60 + int(s)


def _is_section_header(line: str) -> bool:
    """Return True if the line looks like an ALL-CAPS section header."""
    s = line.strip()
    if not s or s.startswith("[") or any(c.isdigit() for c in s):
        return False
    if len(s) < 3:
        return False
    alpha = [c for c in s if c.isalpha()]
    return bool(alpha) and all(c.isupper() for c in alpha)


def _parse_cutsheet_clips(cutsheet_text: str, include_alt: bool = True) -> list:
    """Parse timestamped clips from a cut sheet text."""
    lines = cutsheet_text.splitlines()
    clips = []
    current_section = "INTRO"
    clip_id = 1

    for i, line in enumerate(lines):
        stripped = line.strip()

        # Stop at appendices (they don't contain timeline clips)
        if stripped.upper().startswith("APPENDIX"):
            break

        # Detect section headers
        if _is_section_header(stripped) and len(stripped) >= 3:
            current_section = stripped
            continue

        # Find IP or ALT timestamp
        m = _CLIP_RE.search(line)
        if not m:
            continue

        clip_type = m.group("type")
        if clip_type == "ALT" and not include_alt:
            continue

        in_tc = m.group("in")
        out_tc = m.group("out")
        in_sec = _tc_to_seconds(in_tc)
        out_sec = _tc_to_seconds(out_tc)

        # Extract verbatim quote from same line (after the bracket)
        after = line[m.end():].strip().strip('"').strip()
        quote = after[:120] if after else ""

        # Look for TONE tag on the next line
        tone = ""
        if i + 1 < len(lines):
            tone_m = _TONE_RE.search(lines[i + 1])
            if tone_m:
                tone = tone_m.group(1).strip()

        clips.append({
            "id": clip_id,
            "section": current_section,
            "type": clip_type,
            "in_tc": in_tc,
            "out_tc": out_tc,
            "in_seconds": in_sec,
            "out_seconds": out_sec,
            "duration_seconds": max(0.0, out_sec - in_sec),
            "quote": quote,
            "tone": tone,
        })
        clip_id += 1

    return sorted(clips, key=lambda c: c["in_seconds"])


# ── Model catalogue ──────────────────────────────────────────────────────────

@router.get("/models")
async def get_available_models():
    return {
        "anthropic": {
            "name": "Anthropic (Claude)",
            "models": [
                {"id": "claude-opus-4-6", "name": "Claude Opus 4.6 (Most Intelligent)", "recommended": True},
                {"id": "claude-sonnet-4-5", "name": "Claude Sonnet 4.5 (Balanced)", "recommended": False},
                {"id": "claude-haiku-4-5", "name": "Claude Haiku 4.5 (Fastest)", "recommended": False},
            ],
        },
        "openai": {
            "name": "OpenAI",
            "models": [
                {"id": "gpt-4o", "name": "GPT-4o (Latest)", "recommended": True},
                {"id": "gpt-4o-mini", "name": "GPT-4o Mini (Cheapest)", "recommended": False},
                {"id": "gpt-4-turbo", "name": "GPT-4 Turbo", "recommended": False},
            ],
        },
        "gemini": {
            "name": "Google (Gemini)",
            "models": [
                {"id": "gemini-2.0-flash", "name": "Gemini 2.0 Flash (Fastest)", "recommended": True},
                {"id": "gemini-1.5-pro", "name": "Gemini 1.5 Pro", "recommended": False},
                {"id": "gemini-2.0-pro", "name": "Gemini 2.0 Pro", "recommended": False},
            ],
        },
    }


@router.get("/pricing")
async def get_pricing():
    return PRICING


@router.get("/default-prompt")
async def get_default_prompt():
    return {"prompt": load_cutsheet_prompt()}


@router.get("/formats")
async def get_documentary_formats():
    """Return the list of documentary format presets."""
    return {
        "formats": [
            {"id": k, "label": v["label"], "runtime": v["runtime"], "sections": v["sections"]}
            for k, v in DOC_FORMATS.items()
        ]
    }


# ── Cut-sheet clip parser ─────────────────────────────────────────────────────

class ParseCutSheetRequest(BaseModel):
    cutsheet_text: str
    include_alt: Optional[bool] = True


@router.post("/parse-cutsheet")
async def parse_cutsheet(request: ParseCutSheetRequest):
    """
    Parse timestamped clips from a cut-sheet text.

    Extracts [IP @ HH:MM:SS-HH:MM:SS] and [ALT @ ...] entries and returns
    them as structured clip objects ready for the Premiere timeline.
    """
    if not request.cutsheet_text.strip():
        raise HTTPException(400, "cutsheet_text is required")

    clips = _parse_cutsheet_clips(request.cutsheet_text, include_alt=request.include_alt or True)
    total_duration = sum(c["duration_seconds"] for c in clips)

    return {
        "clips": clips,
        "total_clips": len(clips),
        "estimated_duration_seconds": round(total_duration, 1),
    }


# ── Cut sheet generation ─────────────────────────────────────────────────────

def _format_time(seconds: float | None) -> str:
    if seconds is None:
        return "00:00:00.00"
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds % 60
    return f"{h:02d}:{m:02d}:{s:05.2f}"


def _format_transcript_for_ai(transcript_data: dict) -> str:
    """Convert transcript JSON into readable timestamped text for the AI."""
    lines = []
    for sentence in transcript_data.get("sentences", []):
        start = _format_time(sentence.get("start"))
        end = _format_time(sentence.get("end"))
        speaker = sentence.get("speaker_name", "Unknown")
        text = sentence.get("text", "")
        lines.append(f"[{start} → {end}] {speaker}: {text}")
    return "\n".join(lines)


@router.post("/cutsheet")
async def create_cutsheet(request: CutSheetRequest):
    """Generate an editor cut sheet from a transcript using an AI model."""
    transcript_path = TRANSCRIPTS_DIR / f"{request.transcript_job_id}.json"
    if not transcript_path.exists():
        raise HTTPException(404, "Transcript not found. Run transcription first.")

    async with aiofiles.open(transcript_path, encoding="utf-8") as f:
        transcript_data = json.loads(await f.read())

    transcript_text = _format_transcript_for_ai(transcript_data)

    try:
        result = await generate_cutsheet(
            transcript_text,
            request.provider,
            request.model,
            request.custom_prompt,
            request.documentary_format,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"AI generation error: {str(e)}")

    # Persist
    cutsheet_id = f"{request.transcript_job_id}_{request.provider}_{request.model.replace('-', '_')}"
    cutsheet_path = CUTSHEETS_DIR / f"{cutsheet_id}.json"
    result["cutsheet_id"] = cutsheet_id

    async with aiofiles.open(cutsheet_path, "w", encoding="utf-8") as f:
        await f.write(json.dumps(result, indent=2, ensure_ascii=False))

    return result


@router.get("/download/{cutsheet_id}")
async def download_cutsheet(cutsheet_id: str, format: str = "json"):
    """Download cut sheet as JSON or TXT."""
    cutsheet_path = CUTSHEETS_DIR / f"{cutsheet_id}.json"
    if not cutsheet_path.exists():
        raise HTTPException(404, "Cut sheet not found")

    if format == "txt":
        async with aiofiles.open(cutsheet_path, encoding="utf-8") as f:
            data = json.loads(await f.read())
        txt_path = CUTSHEETS_DIR / f"{cutsheet_id}.txt"
        txt_content = (
            f"CUT SHEET — Generated by {data['provider']} ({data['model']})\n"
            + "=" * 64 + "\n\n"
            + data["cutsheet"]
            + f"\n\n{'=' * 64}\n"
            + f"Tokens: {data['input_tokens']} input / {data['output_tokens']} output\n"
            + f"Cost: ${data['cost_usd']:.4f}\n"
        )
        async with aiofiles.open(txt_path, "w", encoding="utf-8") as f:
            await f.write(txt_content)
        return FileResponse(txt_path, media_type="text/plain", filename=f"cutsheet_{cutsheet_id}.txt")

    return FileResponse(
        cutsheet_path,
        media_type="application/json",
        filename=f"cutsheet_{cutsheet_id}.json",
    )


# ── Premiere Pro XML Export ──────────────────────────────────────────────────

@router.get("/premiere-preview/{cutsheet_id}")
async def premiere_preview(cutsheet_id: str):
    """Return a JSON summary of clips that would appear in the Premiere XML."""
    cutsheet_path = CUTSHEETS_DIR / f"{cutsheet_id}.json"
    if not cutsheet_path.exists():
        raise HTTPException(404, "Cut sheet not found")

    async with aiofiles.open(cutsheet_path, encoding="utf-8") as f:
        data = json.loads(await f.read())

    try:
        summary = get_parsed_clips_summary(data["cutsheet"])
    except Exception as e:
        raise HTTPException(422, f"Failed to parse cut sheet: {e}")

    return summary


@router.post("/export-xml/{cutsheet_id}")
async def export_premiere_xml(cutsheet_id: str, settings: PremiereExportRequest):
    """Generate and download an FCP XML file for Premiere Pro import."""
    cutsheet_path = CUTSHEETS_DIR / f"{cutsheet_id}.json"
    if not cutsheet_path.exists():
        raise HTTPException(404, "Cut sheet not found")

    async with aiofiles.open(cutsheet_path, encoding="utf-8") as f:
        data = json.loads(await f.read())

    # Load real source files from editor's Premiere XML if provided
    source_files = None
    if settings.premiere_xml_id:
        source_files = await asyncio.to_thread(load_parsed_xml, settings.premiere_xml_id, PREMIERE_XMLS_DIR)
        if source_files is None:
            raise HTTPException(404, "Premiere XML metadata not found. Re-upload the XML file.")

    try:
        xml_str = generate_premiere_xml(
            cutsheet_text=data["cutsheet"],
            sequence_name=settings.sequence_name or "AI Cut Sheet Assembly",
            timebase=settings.timebase,
            width=settings.width,
            height=settings.height,
            source_file_name=settings.source_file_name or "Interview_Footage",
            ntsc=settings.ntsc,
            vo_gap_seconds=settings.vo_gap_seconds,
            source_files=source_files,
        )
    except ValueError as e:
        raise HTTPException(422, str(e))
    except Exception as e:
        raise HTTPException(500, f"XML generation error: {e}")

    xml_path = CUTSHEETS_DIR / f"{cutsheet_id}_premiere.xml"
    async with aiofiles.open(xml_path, "w", encoding="utf-8") as f:
        await f.write(xml_str)

    return FileResponse(
        xml_path,
        media_type="application/xml",
        filename=f"{cutsheet_id}_premiere.xml",
    )
