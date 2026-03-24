"""
Parse an FCP XML file exported from Premiere Pro.

Extracts the sequence settings (timebase, resolution) and all video-track
file references so the XML generator can re-emit them with real pathurls
instead of placeholders.  The parser assumes the editor's synced master
timeline has Camera A on the first video track and Camera B on the second.
"""

import json
import uuid
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Optional


def _text(el: Optional[ET.Element], tag: str, default: str = "") -> str:
    child = el.find(tag) if el is not None else None
    return (child.text or default) if child is not None else default


def _int(el: Optional[ET.Element], tag: str, default: int = 0) -> int:
    try:
        return int(_text(el, tag, str(default)))
    except (ValueError, TypeError):
        return default


def _bool(el: Optional[ET.Element], tag: str) -> bool:
    return _text(el, tag).upper() == "TRUE"


def _parse_file_element(file_el: ET.Element) -> dict:
    """Extract all useful fields from a <file> element."""
    rate_el = file_el.find("rate")
    media_el = file_el.find("media")

    video_sc = None
    audio_sc = None
    if media_el is not None:
        vid = media_el.find("video")
        if vid is not None:
            video_sc = vid.find("samplecharacteristics")
        aud = media_el.find("audio")
        if aud is not None:
            audio_sc = aud.find("samplecharacteristics")

    return {
        "id": file_el.get("id", ""),
        "name": _text(file_el, "name"),
        "pathurl": _text(file_el, "pathurl"),
        "duration": _int(file_el, "duration"),
        "timebase": _int(rate_el, "timebase", 25),
        "ntsc": _bool(rate_el, "ntsc"),
        "width": _int(video_sc, "width", 1920) if video_sc is not None else 0,
        "height": _int(video_sc, "height", 1080) if video_sc is not None else 0,
        "anamorphic": _text(video_sc, "anamorphic", "FALSE") if video_sc is not None else "FALSE",
        "pixelaspectratio": _text(video_sc, "pixelaspectratio", "square") if video_sc is not None else "square",
        "fielddominance": _text(video_sc, "fielddominance", "none") if video_sc is not None else "none",
        "audio_depth": _int(audio_sc, "depth", 16) if audio_sc is not None else 16,
        "audio_samplerate": _int(audio_sc, "samplerate", 48000) if audio_sc is not None else 48000,
    }


def parse_premiere_xml(xml_content: str) -> dict:
    """
    Parse FCP XML content and return structured metadata.

    Returns
    -------
    dict with keys:
        premiere_xml_id : str   – unique ID for this parsed result
        sequence_name   : str
        timebase        : int
        ntsc            : bool
        width           : int
        height          : int
        tracks          : list[dict]  – one entry per video track with file info
        files           : dict[str, dict]  – keyed by file id, full file metadata
    """
    root = ET.fromstring(xml_content)

    # Find the first <sequence> (could be root child or nested in a bin/project)
    seq = root.find(".//sequence")
    if seq is None:
        raise ValueError("No <sequence> element found in the XML file.")

    seq_name = _text(seq, "name", "Untitled Sequence")

    # Sequence-level rate
    seq_rate = seq.find("rate")
    seq_timebase = _int(seq_rate, "timebase", 25)
    seq_ntsc = _bool(seq_rate, "ntsc")

    # Sequence video format → resolution
    vid_fmt = seq.find("media/video/format/samplecharacteristics")
    seq_width = _int(vid_fmt, "width", 1920)
    seq_height = _int(vid_fmt, "height", 1080)

    # Collect all unique <file> elements across the entire XML
    all_files: dict[str, dict] = {}
    for file_el in root.iter("file"):
        fid = file_el.get("id", "")
        if not fid or fid in all_files:
            continue
        # Only parse fully-populated file elements (not back-references)
        if file_el.find("name") is not None or file_el.find("pathurl") is not None:
            all_files[fid] = _parse_file_element(file_el)

    # Walk video tracks to determine Camera A / Camera B by track order
    video_el = seq.find("media/video")
    tracks: list[dict] = []

    if video_el is not None:
        camera_labels = ["Camera A", "Camera B", "Camera C", "Camera D",
                         "Camera E", "Camera F"]
        for idx, track_el in enumerate(video_el.findall("track")):
            # Find the dominant file on this track (first clipitem with a file ref)
            track_file_id = None
            for ci in track_el.findall("clipitem"):
                fe = ci.find("file")
                if fe is not None:
                    fid = fe.get("id", "")
                    if fid and fid in all_files:
                        track_file_id = fid
                        break

            if track_file_id and track_file_id in all_files:
                fdata = all_files[track_file_id]
                label = camera_labels[idx] if idx < len(camera_labels) else f"Track {idx + 1}"
                tracks.append({
                    "track_index": idx,
                    "label": label,
                    "file_id": track_file_id,
                    "file_name": fdata["name"],
                    "pathurl": fdata["pathurl"],
                    "duration": fdata["duration"],
                })

    premiere_xml_id = f"pxml_{uuid.uuid4().hex[:12]}"

    return {
        "premiere_xml_id": premiere_xml_id,
        "sequence_name": seq_name,
        "timebase": seq_timebase,
        "ntsc": seq_ntsc,
        "width": seq_width,
        "height": seq_height,
        "tracks": tracks,
        "files": all_files,
    }


def save_parsed_xml(parsed: dict, output_dir: Path) -> Path:
    """Persist the parsed metadata as JSON and return the file path."""
    output_dir.mkdir(parents=True, exist_ok=True)
    path = output_dir / f"{parsed['premiere_xml_id']}.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(parsed, f, indent=2, ensure_ascii=False)
    return path


def load_parsed_xml(premiere_xml_id: str, storage_dir: Path) -> Optional[dict]:
    """Load previously parsed metadata by ID."""
    path = storage_dir / f"{premiere_xml_id}.json"
    if not path.exists():
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)
