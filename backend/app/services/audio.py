import asyncio
import logging
import shutil
import subprocess
import uuid
from pathlib import Path

from ..config import (
    UPLOAD_DIR,
    COMPRESSED_DIR,
    COMPRESSED_BITRATE,
    COMPRESSED_SAMPLE_RATE,
    COMPRESSED_FORMAT,
    COMPRESS_AUDIO_THRESHOLD_BYTES,
    COMPRESS_AUDIO_ABOVE_MB,
    FFMPEG_TIMEOUT_SECONDS,
)
from .. import clients

logger = logging.getLogger(__name__)


def _human_size(size_bytes: int) -> str:
    for unit in ["B", "KB", "MB", "GB"]:
        if size_bytes < 1024:
            return f"{size_bytes:.1f} {unit}"
        size_bytes /= 1024
    return f"{size_bytes:.1f} TB"


def _find_file(directory: Path, file_id: str) -> Path | None:
    for f in directory.iterdir():
        if f.is_file() and f.stem == file_id:
            return f
    return None


def _run_ffmpeg_compress(upload_path: Path, compressed_path: Path) -> str | None:
    """Run FFmpeg in a blocking subprocess with timeout. Returns error string or None."""
    try:
        result = subprocess.run(
            [
                "ffmpeg",
                "-i", str(upload_path),
                "-vn",
                "-ac", "1",
                "-ar", COMPRESSED_SAMPLE_RATE,
                "-b:a", COMPRESSED_BITRATE,
                "-threads", "0",
                "-y",
                str(compressed_path),
            ],
            capture_output=True,
            text=True,
            timeout=FFMPEG_TIMEOUT_SECONDS,
        )
        if result.returncode != 0:
            return result.stderr[:500]
        return None
    except subprocess.TimeoutExpired:
        return f"FFmpeg timed out after {FFMPEG_TIMEOUT_SECONDS}s"


async def compress_audio(file_id: str) -> dict:
    """
    Compress audio using FFmpeg (mono 16 kHz MP3 at 64 kbps).
    Semaphore limits concurrent FFmpeg processes to prevent CPU starvation.
    """
    upload_path = _find_file(UPLOAD_DIR, file_id)
    if not upload_path:
        raise FileNotFoundError(f"Upload file '{file_id}' not found in {UPLOAD_DIR}")

    compressed_id = str(uuid.uuid4())[:12]
    compressed_path = COMPRESSED_DIR / f"{compressed_id}.{COMPRESSED_FORMAT}"

    async with clients.ffmpeg_sem:
        logger.info("FFmpeg compressing %s → %s", upload_path.name, compressed_path.name)
        error = await asyncio.to_thread(_run_ffmpeg_compress, upload_path, compressed_path)

    if error:
        compressed_path.unlink(missing_ok=True)
        raise RuntimeError(f"FFmpeg compression failed: {error}")

    original_size = upload_path.stat().st_size
    compressed_size = compressed_path.stat().st_size
    logger.info(
        "Compression done: %s → %s (%.1fx)",
        _human_size(original_size), _human_size(compressed_size),
        original_size / max(compressed_size, 1),
    )

    return {
        "file_id": compressed_id,
        "compression_skipped": False,
        "original_size": original_size,
        "compressed_size": compressed_size,
        "compression_ratio": round(original_size / max(compressed_size, 1), 2),
        "original_size_human": _human_size(original_size),
        "compressed_size_human": _human_size(compressed_size),
    }


async def prepare_audio_for_transcription(file_id: str) -> dict:
    """
    Large uploads (> COMPRESS_AUDIO_ABOVE_MB) → FFmpeg to mono 16 kHz MP3 for Rev.
    Smaller uploads → copy into the transcription folder unchanged (no FFmpeg).
    """
    upload_path = _find_file(UPLOAD_DIR, file_id)
    if not upload_path:
        raise FileNotFoundError(f"Upload file '{file_id}' not found in {UPLOAD_DIR}")

    original_size = upload_path.stat().st_size

    if original_size > COMPRESS_AUDIO_THRESHOLD_BYTES:
        return await compress_audio(file_id)

    new_id = str(uuid.uuid4())[:12]
    ext = upload_path.suffix if upload_path.suffix else f".{COMPRESSED_FORMAT}"
    dest = COMPRESSED_DIR / f"{new_id}{ext}"

    logger.info(
        "Skipping FFmpeg — upload %s ≤ threshold %s MB; copying %s → %s for Rev",
        _human_size(original_size),
        COMPRESS_AUDIO_ABOVE_MB,
        upload_path.name,
        dest.name,
    )
    await asyncio.to_thread(shutil.copy2, upload_path, dest)

    return {
        "file_id": new_id,
        "compression_skipped": True,
        "original_size": original_size,
        "compressed_size": original_size,
        "compression_ratio": 1.0,
        "original_size_human": _human_size(original_size),
        "compressed_size_human": _human_size(original_size),
    }


async def get_audio_duration(file_path: str) -> float:
    """Get audio duration in seconds using ffprobe."""
    def _probe():
        result = subprocess.run(
            [
                "ffprobe",
                "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                file_path,
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        return result.stdout.strip()

    output = await asyncio.to_thread(_probe)
    try:
        return float(output)
    except (ValueError, AttributeError):
        return 0.0
