"""
Hard local smoke test:
- Uses the real test audio file in ../testaudiofile/audiofortesting.mp3
- Calls backend upload + prepare-for-transcription functions directly
- Verifies threshold-based skip/compress behavior for current config

Run from repository root:
  py -3 backend/scripts/hard_test_local_upload.py
"""

import asyncio
import sys
from pathlib import Path

from fastapi import UploadFile

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = REPO_ROOT / "backend"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.config import COMPRESS_AUDIO_ABOVE_MB  # noqa: E402
from app.routers import upload, transcribe  # noqa: E402


async def main() -> None:
    test_file = REPO_ROOT / "testaudiofile" / "audiofortesting.mp3"

    if not test_file.exists():
        raise FileNotFoundError(f"Missing test file: {test_file}")

    size_bytes = test_file.stat().st_size
    size_mb = round(size_bytes / (1024 * 1024), 2)
    print(f"[1/3] Test file: {test_file}")
    print(f"      Size: {size_mb} MB")
    print(f"      Threshold COMPRESS_AUDIO_ABOVE_MB={COMPRESS_AUDIO_ABOVE_MB}")

    with test_file.open("rb") as fh:
        upl = UploadFile(file=fh, filename=test_file.name)
        uploaded = await upload.upload(upl)

    print("[2/3] Upload OK")
    print(f"      file_id={uploaded['file_id']}")
    print(f"      file_size_human={uploaded['file_size_human']}")

    prepared = await transcribe.compress(uploaded["file_id"])
    print("[3/3] Prepare-for-transcription OK")
    print(f"      new_file_id={prepared['file_id']}")
    print(f"      compression_skipped={prepared.get('compression_skipped')}")
    print(f"      ratio={prepared.get('compression_ratio')}")

    expected_skip = size_mb <= COMPRESS_AUDIO_ABOVE_MB
    if prepared.get("compression_skipped") != expected_skip:
        raise AssertionError(
            f"Unexpected compression behavior: expected skip={expected_skip}, "
            f"got skip={prepared.get('compression_skipped')}"
        )

    print("PASS: behavior matches threshold configuration.")


if __name__ == "__main__":
    asyncio.run(main())
