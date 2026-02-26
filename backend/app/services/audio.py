import asyncio
import subprocess
import uuid
from pathlib import Path

from ..config import UPLOAD_DIR, COMPRESSED_DIR, COMPRESSED_BITRATE, COMPRESSED_SAMPLE_RATE, COMPRESSED_FORMAT


def _human_size(size_bytes: int) -> str:
    for unit in ["B", "KB", "MB", "GB"]:
        if size_bytes < 1024:
            return f"{size_bytes:.1f} {unit}"
        size_bytes /= 1024
    return f"{size_bytes:.1f} TB"


def _find_file(directory: Path, file_id: str) -> Path | None:
    """Find a file by its stem (file_id) in a directory."""
    for f in directory.iterdir():
        if f.is_file() and f.stem == file_id:
            return f
    return None


def _run_ffmpeg_compress(upload_path: Path, compressed_path: Path) -> str | None:
    """Run FFmpeg in a blocking subprocess. Returns error string or None on success."""
    result = subprocess.run(
        [
            "ffmpeg",
            "-i", str(upload_path),
            "-vn",                              # strip video
            "-ac", "1",                         # mono
            "-ar", COMPRESSED_SAMPLE_RATE,      # 16 kHz
            "-b:a", COMPRESSED_BITRATE,         # 64 kbps
            "-threads", "0",                    # use all cores
            "-y",                               # overwrite
            str(compressed_path),
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        return result.stderr[:500]
    return None


async def compress_audio(file_id: str) -> dict:
    """
    Compress audio using FFmpeg.
    - Converts to mono 16 kHz MP3 at 64 kbps.
    - A 2 GB WAV → ~50-100 MB. Massive speed gain for Rev AI upload.
    - Runs FFmpeg in a thread pool (Windows compatibility).
    """
    upload_path = _find_file(UPLOAD_DIR, file_id)
    if not upload_path:
        raise FileNotFoundError(f"Upload file '{file_id}' not found in {UPLOAD_DIR}")

    compressed_id = str(uuid.uuid4())[:12]
    compressed_path = COMPRESSED_DIR / f"{compressed_id}.{COMPRESSED_FORMAT}"

    # Run blocking FFmpeg in thread pool so we don't block the event loop
    error = await asyncio.to_thread(_run_ffmpeg_compress, upload_path, compressed_path)
    if error:
        raise RuntimeError(f"FFmpeg compression failed: {error}")

    original_size = upload_path.stat().st_size
    compressed_size = compressed_path.stat().st_size

    return {
        "file_id": compressed_id,
        "original_size": original_size,
        "compressed_size": compressed_size,
        "compression_ratio": round(original_size / max(compressed_size, 1), 2),
        "original_size_human": _human_size(original_size),
        "compressed_size_human": _human_size(compressed_size),
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
        )
        return result.stdout.strip()

    output = await asyncio.to_thread(_probe)
    try:
        return float(output)
    except (ValueError, AttributeError):
        return 0.0
