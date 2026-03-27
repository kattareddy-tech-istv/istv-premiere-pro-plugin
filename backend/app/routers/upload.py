import asyncio
import uuid
from pathlib import Path

import aiofiles
from fastapi import APIRouter, UploadFile, File, HTTPException

from ..config import UPLOAD_DIR, MAX_FILE_SIZE, PREMIERE_XMLS_DIR
from ..services.premiere_xml_parser import parse_premiere_xml, save_parsed_xml

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
    - Accepts a single audio file (up to 10 GB).
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
                    f"File exceeds 10 GB limit ({_human_size(bytes_written)})",
                )
            await out.write(chunk)

    return {
        "file_id": file_id,
        "filename": original_name,
        "file_size": bytes_written,
        "file_size_human": _human_size(bytes_written),
    }


@router.post("/premiere-xml")
async def upload_premiere_xml(file: UploadFile = File(...)):
    """
    Upload a Premiere Pro XML (FCP XML) file.
    Parses it to extract camera file references, sequence settings,
    and track layout for the XML round-trip export.
    """
    original_name = file.filename or "timeline.xml"
    if not original_name.lower().endswith(".xml"):
        raise HTTPException(400, "File must be an XML file (.xml)")

    content = await file.read()
    if len(content) > 100 * 1024 * 1024:
        raise HTTPException(400, "XML file exceeds 100 MB limit")

    try:
        xml_text = content.decode("utf-8")
    except UnicodeDecodeError:
        try:
            xml_text = content.decode("utf-8-sig")
        except UnicodeDecodeError:
            raise HTTPException(400, "Could not decode XML file as UTF-8")

    try:
        parsed = parse_premiere_xml(xml_text)
    except Exception as e:
        raise HTTPException(422, f"Failed to parse Premiere XML: {e}")

    await asyncio.to_thread(save_parsed_xml, parsed, PREMIERE_XMLS_DIR)

    return {
        "premiere_xml_id": parsed["premiere_xml_id"],
        "filename": original_name,
        "sequence_name": parsed["sequence_name"],
        "timebase": parsed["timebase"],
        "ntsc": parsed["ntsc"],
        "width": parsed["width"],
        "height": parsed["height"],
        "tracks": parsed["tracks"],
    }
