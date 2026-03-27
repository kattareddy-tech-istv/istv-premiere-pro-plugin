"""
Multicam analysis router.

POST /api/multicam/analyze          — accepts sequence info JSON, returns AI edit suggestions
POST /api/multicam/detect-silences  — detects silence gaps in a clip using the transcript
"""

import json

import aiofiles

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from ..config import TRANSCRIPTS_DIR
from ..services.multicam_ai import analyze_multicam_sequence

router = APIRouter(prefix="/api/multicam", tags=["multicam"])


class MulticamAnalysisRequest(BaseModel):
    sequence_info: dict
    model: str = "claude-opus-4-6"
    custom_instructions: Optional[str] = None


class SilenceDetectionRequest(BaseModel):
    job_id: str
    clip_in_seconds: float
    clip_out_seconds: float
    min_silence_duration_seconds: float = 0.4


@router.post("/analyze")
async def analyze_multicam(request: MulticamAnalysisRequest):
    """
    Analyze a Premiere Pro sequence and return AI-generated edit suggestions.

    The sequence_info dict is the output of getMulticamSequenceInfo() from host.jsx.
    Returns structured suggestions (razor cuts, camera notes, markers) the panel
    can display for editor confirmation and then apply via ExtendScript.
    """
    if not request.sequence_info:
        raise HTTPException(400, "sequence_info is required")

    video_tracks = request.sequence_info.get("video_tracks", [])
    if not video_tracks:
        raise HTTPException(400, "No video tracks found in sequence info. Make sure a sequence is open in Premiere Pro.")

    total_clips = sum(t.get("clip_count", 0) for t in video_tracks)
    if total_clips == 0:
        raise HTTPException(400, "No clips found on video tracks. Add some clips to the timeline first.")

    try:
        result = await analyze_multicam_sequence(
            sequence_info=request.sequence_info,
            model=request.model,
            custom_instructions=request.custom_instructions or "",
        )
    except Exception as e:
        raise HTTPException(500, f"AI analysis error: {str(e)}")

    return result


@router.post("/detect-silences")
async def detect_silences(request: SilenceDetectionRequest):
    """
    Detect silence gaps in a clip's time range using the existing transcript.

    Uses word-level timestamps from the Rev.ai transcript to find gaps between
    consecutive words that exceed the minimum silence duration threshold.
    Returns absolute timeline positions matching the sequence layout.
    """
    transcript_path = TRANSCRIPTS_DIR / f"{request.job_id}.json"
    if not transcript_path.exists():
        raise HTTPException(404, "Transcript not found. Run transcription first.")

    async with aiofiles.open(transcript_path, encoding="utf-8") as f:
        transcript_data = json.loads(await f.read())

    clip_in = request.clip_in_seconds
    clip_out = request.clip_out_seconds
    min_dur = request.min_silence_duration_seconds

    # Collect word-level timestamps within the clip's time range
    words: list[tuple[float, float]] = []

    # Format 1: our sentences/words format (stored after processing)
    for sentence in transcript_data.get("sentences", []):
        for word in sentence.get("words", []):
            t_start = word.get("start")
            t_end = word.get("end")
            if t_start is None or t_end is None:
                continue
            t_start, t_end = float(t_start), float(t_end)
            if t_end < clip_in - 0.1 or t_start > clip_out + 0.1:
                continue
            words.append((t_start, t_end))

    # Format 2: raw Rev.ai monologue format
    if not words:
        for mono in transcript_data.get("monologues", []):
            for elem in mono.get("elements", []):
                if elem.get("type") != "text":
                    continue
                t_start = elem.get("ts")
                t_end = elem.get("end_ts")
                if t_start is None or t_end is None:
                    continue
                t_start, t_end = float(t_start), float(t_end)
                if t_end < clip_in - 0.1 or t_start > clip_out + 0.1:
                    continue
                words.append((t_start, t_end))

    words.sort(key=lambda w: w[0])

    # Find gaps between consecutive words
    silences = []
    for i in range(len(words) - 1):
        gap_start = words[i][1]
        gap_end = words[i + 1][0]
        duration = gap_end - gap_start
        if duration >= min_dur:
            silences.append({
                "in_seconds": round(gap_start, 3),
                "out_seconds": round(gap_end, 3),
                "duration_seconds": round(duration, 3),
            })

    total_silence = sum(s["duration_seconds"] for s in silences)
    return {
        "silences": silences,
        "total_silences": len(silences),
        "total_silence_duration_seconds": round(total_silence, 3),
    }
