import uuid
from pathlib import Path

import aiofiles
from fastapi import APIRouter, UploadFile, File, HTTPException

from ..config import UPLOAD_DIR, MAX_FILE_SIZE

router = APIRouter(prefix="/api/upload", tags=["upload"])


def _human_size(size_bytes: int | float) -> str:
  for unit in ["B", "KB", "MB", "GB"]:
      if size_bytes < 1024:
          return f"{size_bytes:.1f} {unit}"
      size_bytes /= 1024
  return f"{size_bytes:.1f} TB"


@router.post("")
async def upload(file: UploadFile = File(...)):
    """
    Direct upload endpoint.
    - Accepts a single audio file (up to 2 GB).
    - Streams it straight to disk without loading into memory.
    """
    # Determine target path
    original_name = file.filename or "audio"
    ext = Path(original_name).suffix or ".audio"
    file_id = str(uuid.uuid4())[:12]
    output_path = UPLOAD_DIR / f"{file_id}{ext}"

    bytes_written = 0
    max_size = MAX_FILE_SIZE

    async with aiofiles.open(output_path, "wb") as out:
        while True:
            chunk = await file.read(4 * 1024 * 1024)  # 4 MB chunks
            if not chunk:
                break
            bytes_written += len(chunk)
            if bytes_written > max_size:
                await out.close()
                output_path.unlink(missing_ok=True)
                raise HTTPException(
                    400,
                    f"File exceeds 2 GB limit ({_human_size(bytes_written)})",
                )
            await out.write(chunk)

    return {
        "file_id": file_id,
        "filename": original_name,
        "file_size": bytes_written,
        "file_size_human": _human_size(bytes_written),
    }
