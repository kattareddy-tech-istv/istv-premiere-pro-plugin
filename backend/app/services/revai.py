import json
import logging
import mimetypes
from pathlib import Path

from ..config import REV_AI_TOKEN, TRANSCRIPTS_DIR, COMPRESSED_DIR
from .. import clients

logger = logging.getLogger(__name__)

REV_AI_BASE = "https://api.rev.ai/speechtotext/v1"


def _find_file(directory: Path, file_id: str) -> Path | None:
    for f in directory.iterdir():
        if f.is_file() and f.stem == file_id:
            return f
    return None


async def submit_transcription(file_id: str) -> str:
    """Submit compressed audio to Rev AI for async transcription with diarization."""
    if not REV_AI_TOKEN or not REV_AI_TOKEN.strip():
        raise RuntimeError(
            "Rev AI API token is not configured. "
            "Set REV_AI_TOKEN in backend/.env before starting transcription."
        )

    compressed_path = _find_file(COMPRESSED_DIR, file_id)
    if not compressed_path:
        raise FileNotFoundError(f"Compressed file '{file_id}' not found")

    headers = {"Authorization": f"Bearer {REV_AI_TOKEN.strip()}"}
    options = json.dumps({"skip_diarization": False, "language": "en"})

    mime, _ = mimetypes.guess_type(compressed_path.name)
    if not mime:
        mime = "application/octet-stream"

    async with clients.revai_sem:
        http = clients.get_http()
        with open(compressed_path, "rb") as f:
            files = {"media": (compressed_path.name, f, mime)}
            data = {"options": options}
            response = await http.post(
                f"{REV_AI_BASE}/jobs",
                headers=headers,
                files=files,
                data=data,
            )

    if response.status_code not in (200, 201):
        raise RuntimeError(f"Rev AI submit error ({response.status_code}): {response.text[:300]}")

    job = response.json()
    logger.info("Rev AI job submitted: %s", job["id"])
    return job["id"]


async def get_job_status(job_id: str) -> dict:
    """Poll Rev AI job status."""
    if not REV_AI_TOKEN or not REV_AI_TOKEN.strip():
        raise RuntimeError(
            "Rev AI API token is not configured. "
            "Set REV_AI_TOKEN in backend/.env before checking transcription status."
        )

    headers = {"Authorization": f"Bearer {REV_AI_TOKEN.strip()}"}

    async with clients.revai_sem:
        http = clients.get_http()
        response = await http.get(f"{REV_AI_BASE}/jobs/{job_id}", headers=headers)

    if response.status_code != 200:
        raise RuntimeError(f"Rev AI status error: {response.text[:300]}")

    return response.json()


async def get_transcript(job_id: str) -> dict:
    """Fetch and parse Rev AI transcript into sentence-level timestamped JSON."""
    headers = {
        "Authorization": f"Bearer {REV_AI_TOKEN.strip()}",
        "Accept": "application/vnd.rev.transcript.v1.0+json",
    }

    async with clients.revai_sem:
        http = clients.get_http()
        response = await http.get(
            f"{REV_AI_BASE}/jobs/{job_id}/transcript",
            headers=headers,
        )

    if response.status_code != 200:
        raise RuntimeError(f"Rev AI transcript error: {response.text[:300]}")

    raw = response.json()

    # ── Parse monologues into sentences ──────────────────────────────────
    sentences = []
    current = {"text": "", "words": [], "speaker": None, "start": None, "end": None}

    for monologue in raw.get("monologues", []):
        speaker = monologue.get("speaker", 0)
        for element in monologue.get("elements", []):
            if element["type"] == "text":
                word = {
                    "value": element["value"],
                    "start": element.get("ts", 0),
                    "end": element.get("end_ts", 0),
                    "confidence": element.get("confidence", 0),
                    "speaker": speaker,
                }
                if current["start"] is None:
                    current["start"] = word["start"]
                    current["speaker"] = speaker
                current["words"].append(word)
                current["text"] += element["value"]
                current["end"] = word["end"]

            elif element["type"] == "punct":
                current["text"] += element["value"]
                if element["value"] in (".", "!", "?"):
                    if current["text"].strip():
                        sentences.append({
                            "text": current["text"].strip(),
                            "start": current["start"],
                            "end": current["end"],
                            "speaker": current["speaker"],
                            "speaker_name": f"Speaker {current['speaker']}",
                            "words": current["words"],
                        })
                    current = {"text": "", "words": [], "speaker": None, "start": None, "end": None}

    if current["text"].strip():
        sentences.append({
            "text": current["text"].strip(),
            "start": current["start"],
            "end": current["end"],
            "speaker": current["speaker"],
            "speaker_name": f"Speaker {current['speaker']}",
            "words": current["words"],
        })

    seen = set()
    speakers = []
    for s in sentences:
        sid = s["speaker"]
        if sid not in seen:
            seen.add(sid)
            speakers.append({"id": sid, "name": f"Speaker {sid}"})

    duration = max((s["end"] for s in sentences if s["end"]), default=0)
    word_count = sum(len(s["words"]) for s in sentences)

    result = {
        "job_id": job_id,
        "sentences": sentences,
        "speakers": speakers,
        "duration": duration,
        "word_count": word_count,
    }

    transcript_path = TRANSCRIPTS_DIR / f"{job_id}.json"
    with open(transcript_path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)

    return result
