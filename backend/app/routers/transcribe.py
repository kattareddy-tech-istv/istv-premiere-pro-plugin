import json
import logging
import traceback
import uuid
from typing import List, Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from ..config import TRANSCRIPTS_DIR
from ..services.audio import prepare_audio_for_transcription
from ..services.revai import submit_transcription, get_job_status, get_transcript

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/transcribe", tags=["transcribe"])


class ImportTranscriptRequest(BaseModel):
    """Transcript import: array of dicts or plain strings. Large arrays supported."""
    transcript: List[Any]


def _human_size(size_bytes: int | float) -> str:
    for unit in ["B", "KB", "MB", "GB"]:
        if size_bytes < 1024:
            return f"{size_bytes:.1f} {unit}"
        size_bytes /= 1024
    return f"{size_bytes:.1f} TB"


# ── Compress ─────────────────────────────────────────────────────────────────

@router.post("/compress/{file_id}")
async def compress(file_id: str):
    """
    Prepare audio for Rev: FFmpeg transcode if upload is larger than COMPRESS_AUDIO_ABOVE_MB;
    otherwise copy file as-is (faster for typical MP3s under the limit).
    """
    try:
        result = await prepare_audio_for_transcription(file_id)
        return result
    except FileNotFoundError as e:
        raise HTTPException(404, f"Upload '{file_id}' not found: {e}")
    except Exception as e:
        logger.error(f"Compression failed for {file_id}: {traceback.format_exc()}")
        raise HTTPException(500, f"Compression failed: {type(e).__name__}: {e}")


# ── Transcription ────────────────────────────────────────────────────────────

@router.post("/start/{compressed_file_id}")
async def start_transcription(compressed_file_id: str):
    """Submit compressed audio to Rev AI. Returns job_id for polling."""
    try:
        job_id = await submit_transcription(compressed_file_id)
        return {"job_id": job_id, "status": "in_progress"}
    except FileNotFoundError:
        raise HTTPException(404, f"Compressed file '{compressed_file_id}' not found")
    except RuntimeError as e:
        raise HTTPException(500, str(e))


@router.get("/status/{job_id}")
async def check_status(job_id: str):
    """Poll Rev AI job status."""
    try:
        data = await get_job_status(job_id)
        return {
            "job_id": job_id,
            "status": data.get("status", "unknown"),
            "duration_seconds": data.get("duration_seconds"),
            "created_on": data.get("created_on"),
        }
    except RuntimeError as e:
        raise HTTPException(500, str(e))


@router.get("/result/{job_id}")
async def get_result(job_id: str):
    """Fetch parsed transcript (cached on disk after first fetch)."""
    transcript_path = TRANSCRIPTS_DIR / f"{job_id}.json"
    if transcript_path.exists():
        with open(transcript_path, encoding="utf-8") as f:
            return json.load(f)

    try:
        return await get_transcript(job_id)
    except RuntimeError as e:
        raise HTTPException(500, str(e))


@router.get("/download/{job_id}")
async def download_transcript(job_id: str):
    """Download transcript JSON file."""
    transcript_path = TRANSCRIPTS_DIR / f"{job_id}.json"
    if not transcript_path.exists():
        # Try fetching from Rev AI first
        try:
            await get_transcript(job_id)
        except Exception:
            raise HTTPException(404, "Transcript not available")

    return FileResponse(
        transcript_path,
        media_type="application/json",
        filename=f"transcript_{job_id}.json",
    )


# ── Import Transcript ────────────────────────────────────────────────────────────

@router.post("/import")
async def import_transcript(request: ImportTranscriptRequest):
    """Import transcript JSON directly (skip upload/transcription).
    Accepts large arrays (thousands of segments). Format: [{ speaker, text, start_ts, end_ts }, ...]
    """
    try:
        raw_transcript = request.transcript
        
        # Validate input
        if not isinstance(raw_transcript, list):
            raise HTTPException(400, "Transcript must be an array/list")
        
        if len(raw_transcript) == 0:
            raise HTTPException(400, "Transcript array cannot be empty")
        
        # Convert user format to internal format
        sentences = []
        seen_speakers = set()
        
        for idx, item in enumerate(raw_transcript):
            # Allow plain strings → treat as { "text": item }
            if isinstance(item, str):
                item = {"text": item.strip(), "speaker": 0, "start_ts": idx * 5.0, "end_ts": (idx + 1) * 5.0}
            if not isinstance(item, dict):
                raise HTTPException(400, f"Item at index {idx} must be an object/dictionary or string")
            
            # Get fields with fallbacks (support various formats)
            raw_speaker = item.get("speaker") or item.get("speaker_id") or 0
            text = item.get("text") or item.get("content") or item.get("value") or item.get("dialogue") or ""
            
            # Normalize speaker_id to int (JSON may send int or string)
            try:
                speaker_id = int(raw_speaker) if raw_speaker is not None else 0
            except (ValueError, TypeError):
                speaker_id = 0
            
            # Handle text - convert to string if needed
            if text is None:
                text = ""
            text = str(text).strip()
            
            if not text:
                continue  # Skip empty items
            
            # Get timestamps with multiple fallback options
            start_ts = item.get("start_ts") or item.get("start") or item.get("start_time") or 0.0
            end_ts = item.get("end_ts") or item.get("end") or item.get("end_time") or 0.0
            
            # Convert to float safely
            try:
                start_ts = float(start_ts)
                end_ts = float(end_ts)
            except (ValueError, TypeError) as e:
                raise HTTPException(400, f"Item at index {idx} has invalid timestamp format: {str(e)}")
            
            speaker_name = f"Speaker {speaker_id}"
            seen_speakers.add(speaker_id)
            
            sentences.append({
                "text": text,
                "start": start_ts,
                "end": end_ts,
                "speaker": speaker_id,
                "speaker_name": speaker_name,
                "words": [],  # Optional, can be empty
            })
        
        if len(sentences) == 0:
            raise HTTPException(400, "No valid transcript items found (all items had empty text)")
        
        # Build speakers list (all speaker_ids are int now, so sorted is safe)
        speakers = [{"id": sid, "name": f"Speaker {sid}"} for sid in sorted(seen_speakers)]
        
        # Calculate duration and word count
        duration = max((s["end"] for s in sentences if s["end"]), default=0)
        word_count = sum(len(s["text"].split()) for s in sentences)
        
        # Generate job_id
        job_id = f"import_{uuid.uuid4().hex[:12]}"
        
        # Build result
        result = {
            "job_id": job_id,
            "sentences": sentences,
            "speakers": speakers,
            "duration": duration,
            "word_count": word_count,
        }
        
        # Save to disk
        TRANSCRIPTS_DIR.mkdir(parents=True, exist_ok=True)
        transcript_path = TRANSCRIPTS_DIR / f"{job_id}.json"
        try:
            with open(transcript_path, "w", encoding="utf-8") as f:
                json.dump(result, f, indent=2, ensure_ascii=False)
        except Exception as e:
            logger.error(f"Failed to save transcript file: {e}")
            raise HTTPException(500, f"Failed to save transcript: {str(e)}")
        
        return result
        
    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
    except Exception as e:
        logger.error(f"Import transcript failed: {traceback.format_exc()}")
        # Return 500 with detail so client sees the real error
        raise HTTPException(500, f"Import failed: {type(e).__name__}: {str(e)}")
