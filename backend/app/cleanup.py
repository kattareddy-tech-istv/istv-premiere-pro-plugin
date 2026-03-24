"""
Background file-cleanup task.

Deletes files older than ``FILE_MAX_AGE_HOURS`` from all data directories
every 30 minutes.  Runs as an ``asyncio`` background task started in the
app lifespan.
"""

import asyncio
import logging
import time
from pathlib import Path

from .config import (
    UPLOAD_DIR,
    COMPRESSED_DIR,
    TRANSCRIPTS_DIR,
    CUTSHEETS_DIR,
    BROLL_DIR,
    PREMIERE_XMLS_DIR,
    FILE_MAX_AGE_HOURS,
)

logger = logging.getLogger(__name__)

CLEANUP_DIRS: list[Path] = [
    UPLOAD_DIR,
    COMPRESSED_DIR,
    TRANSCRIPTS_DIR,
    CUTSHEETS_DIR,
    BROLL_DIR,
    PREMIERE_XMLS_DIR,
]

INTERVAL_SECONDS = 30 * 60  # every 30 minutes


def _purge_old_files() -> int:
    """Delete files older than the configured max age. Returns count deleted."""
    cutoff = time.time() - (FILE_MAX_AGE_HOURS * 3600)
    deleted = 0
    for directory in CLEANUP_DIRS:
        if not directory.exists():
            continue
        for f in directory.iterdir():
            if not f.is_file():
                continue
            try:
                if f.stat().st_mtime < cutoff:
                    f.unlink()
                    deleted += 1
            except OSError:
                pass
    return deleted


async def cleanup_loop() -> None:
    """Run cleanup in a perpetual loop (fire-and-forget background task)."""
    while True:
        try:
            deleted = await asyncio.to_thread(_purge_old_files)
            if deleted:
                logger.info("Cleanup: removed %d old file(s)", deleted)
        except Exception as exc:
            logger.warning("Cleanup error: %s", exc)
        await asyncio.sleep(INTERVAL_SECONDS)
