"""
Premiere Pro XML (FCP XML v4) generator.

Parses the AI-generated cut sheet markdown to extract structured timeline
elements — interview pulls (IP), alternative takes (ALT), voiceovers (VO),
tone tags, B-roll notes, and section markers — then generates an FCP XML
file that Premiere Pro can import to reconstruct the assembly sequence.

Track layout (with real source files from editor's XML):
  V1  – Camera A primary IPs          A1 – linked audio
  V2  – Camera B primary IPs          A2 – linked audio
  V3  – Camera A ALT takes            A3 – linked audio
  V4  – Camera B ALT takes            A4 – linked audio

Track layout (placeholder / no source XML):
  V1  – Primary IPs                   A1 – linked audio
  V2  – ALT takes                     A2 – linked audio

Sequence markers carry section titles, VO narration scripts, and B-roll
production notes so the editor has full context without the text document.
"""

import re
import uuid
from dataclasses import dataclass
from typing import Optional
from xml.dom import minidom


# ── Data structures ──────────────────────────────────────────────────────────

@dataclass
class TimelineClip:
    clip_type: str              # "ip" | "alt" | "vo"
    section: str
    source_in_seconds: float    # source timecode start (0 for VO)
    source_out_seconds: float   # source timecode end (0 for VO)
    text: str
    tone: Optional[str] = None
    tone_intensity: Optional[str] = None
    broll_note: Optional[str] = None
    order: int = 0


# ── Timecode helpers ─────────────────────────────────────────────────────────

def parse_timecode(tc: str) -> float:
    """Parse HH:MM:SS, HH:MM:SS.ss, or MM:SS into float seconds."""
    tc = tc.strip().lstrip("~").strip()
    parts = tc.split(":")
    try:
        if len(parts) == 3:
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2])
        if len(parts) == 2:
            return int(parts[0]) * 60 + float(parts[1])
    except (ValueError, IndexError):
        pass
    return 0.0


def seconds_to_frames(seconds: float, timebase: int) -> int:
    return int(round(seconds * timebase))


def _tc_display(seconds: float, timebase: int) -> str:
    """HH:MM:SS:FF display string."""
    total_frames = int(round(seconds * timebase))
    f = total_frames % timebase
    total_secs = total_frames // timebase
    s = total_secs % 60
    m = (total_secs // 60) % 60
    h = total_secs // 3600
    return f"{h:02d}:{m:02d}:{s:02d}:{f:02d}"


# ── Cut sheet parser ─────────────────────────────────────────────────────────

_IP_RE = re.compile(
    r"\[IP\s*@\s*"
    r"(\d{1,2}:\d{2}:\d{2}(?:\.\d+)?)"   # start TC
    r"\s*[–\-—]\s*"
    r"~?(\d{1,2}:\d{2}:\d{2}(?:\.\d+)?)"  # end TC
    r"(?:\s*\(approx\))?"
    r"\s*\]"
    r"\s*(.*)",                             # rest of line (quote)
)

_ALT_RE = re.compile(
    r"\[ALT\s*@\s*"
    r"(\d{1,2}:\d{2}:\d{2}(?:\.\d+)?)"
    r"\s*[–\-—]\s*"
    r"~?(\d{1,2}:\d{2}:\d{2}(?:\.\d+)?)"
    r"(?:\s*\(approx\))?"
    r"\s*\]"
    r"\s*(.*)",
)

_VO_RE = re.compile(r"\[VO\]\s*(.*)")

_TONE_RE = re.compile(
    r"\[TONE:\s*(.+?)\s*[–\-—]\s*(low|mid|high)",
    re.IGNORECASE,
)

_BROLL_RE = re.compile(r"\[B-ROLL\]\s*(.*)", re.IGNORECASE)

_STRIP_QUOTES = str.maketrans("", "", "\u201c\u201d\u201e\u201f\"")


def _clean_quote(text: str) -> str:
    return text.translate(_STRIP_QUOTES).strip()


def _is_section_header(line: str) -> Optional[str]:
    """Return cleaned section title if the line looks like an ALL-CAPS header."""
    raw = line.lstrip("#").strip().strip("*").strip()
    if len(raw) < 3 or not raw[0].isalpha():
        return None
    if raw.startswith("[") or raw.startswith("\u2014"):
        return None
    skip = ("APPENDIX", "STORY SUMMARY", "DOCUMENTARY CUT SHEET",
            "B-ROLL MASTER LIST", "SOURCE TYPE SUMMARY", "RUNTIME TARGET")
    for kw in skip:
        if kw in raw.upper():
            return None
    if raw == raw.upper() and re.match(r"^[A-Z][A-Z0-9\s'\":,&\-–—.]+$", raw):
        return raw
    return None


def parse_cutsheet(cutsheet_text: str) -> list[TimelineClip]:
    """Extract structured timeline clips from cut sheet markdown."""
    clips: list[TimelineClip] = []
    current_section = "UNTITLED"
    order = 0
    last_clip: Optional[TimelineClip] = None

    for line in cutsheet_text.split("\n"):
        stripped = line.strip()
        if not stripped:
            continue

        if stripped.upper().startswith("APPENDIX"):
            break

        m = _IP_RE.match(stripped)
        if m:
            last_clip = TimelineClip(
                clip_type="ip",
                section=current_section,
                source_in_seconds=parse_timecode(m.group(1)),
                source_out_seconds=parse_timecode(m.group(2)),
                text=_clean_quote(m.group(3)),
                order=order,
            )
            clips.append(last_clip)
            order += 1
            continue

        m = _ALT_RE.match(stripped)
        if m:
            last_clip = TimelineClip(
                clip_type="alt",
                section=current_section,
                source_in_seconds=parse_timecode(m.group(1)),
                source_out_seconds=parse_timecode(m.group(2)),
                text=_clean_quote(m.group(3)),
                order=order,
            )
            clips.append(last_clip)
            order += 1
            continue

        m = _TONE_RE.search(stripped)
        if m and last_clip:
            last_clip.tone = m.group(1).strip()
            last_clip.tone_intensity = m.group(2).strip().lower()
            continue

        m = _VO_RE.match(stripped)
        if m:
            last_clip = TimelineClip(
                clip_type="vo",
                section=current_section,
                source_in_seconds=0,
                source_out_seconds=0,
                text=m.group(1).strip(),
                order=order,
            )
            clips.append(last_clip)
            order += 1
            continue

        m = _BROLL_RE.match(stripped)
        if m and last_clip:
            last_clip.broll_note = m.group(1).strip()
            continue

        sec = _is_section_header(stripped)
        if sec:
            current_section = sec
            continue

    return clips


# ── FCP XML builder ──────────────────────────────────────────────────────────

def _el(doc: minidom.Document, parent, tag: str, text: str = ""):
    """Create a child element with optional text content."""
    node = doc.createElement(tag)
    if text:
        node.appendChild(doc.createTextNode(str(text)))
    parent.appendChild(node)
    return node


def _rate_block(doc: minidom.Document, parent, timebase: int, ntsc: bool):
    r = _el(doc, parent, "rate")
    _el(doc, r, "timebase", str(timebase))
    _el(doc, r, "ntsc", "TRUE" if ntsc else "FALSE")
    return r


def _marker(doc: minidom.Document, parent, name: str, comment: str, in_frame: int):
    m = _el(doc, parent, "marker")
    _el(doc, m, "name", name)
    _el(doc, m, "comment", comment)
    _el(doc, m, "in", str(in_frame))
    _el(doc, m, "out", "-1")
    return m


def _write_file_block(
    doc: minidom.Document,
    parent,
    file_id: str,
    file_meta: Optional[dict],
    fallback_name: str,
    fallback_dur: int,
    timebase: int,
    ntsc: bool,
    width: int,
    height: int,
):
    """Write a full <file> element (first occurrence) or a back-reference."""
    fe = _el(doc, parent, "file")
    fe.setAttribute("id", file_id)

    if file_meta is not None:
        _el(doc, fe, "name", file_meta.get("name", fallback_name))
        _el(doc, fe, "pathurl", file_meta.get("pathurl", f"file://localhost/{fallback_name}.mp4"))
        _rate_block(doc, fe, file_meta.get("timebase", timebase), file_meta.get("ntsc", ntsc))
        _el(doc, fe, "duration", str(file_meta.get("duration", fallback_dur)))

        fm = _el(doc, fe, "media")
        fv = _el(doc, fm, "video")
        fsc = _el(doc, fv, "samplecharacteristics")
        _rate_block(doc, fsc, file_meta.get("timebase", timebase), file_meta.get("ntsc", ntsc))
        _el(doc, fsc, "width", str(file_meta.get("width", width)))
        _el(doc, fsc, "height", str(file_meta.get("height", height)))
        _el(doc, fsc, "anamorphic", file_meta.get("anamorphic", "FALSE"))
        _el(doc, fsc, "pixelaspectratio", file_meta.get("pixelaspectratio", "square"))
        _el(doc, fsc, "fielddominance", file_meta.get("fielddominance", "none"))
        fa = _el(doc, fm, "audio")
        fasc = _el(doc, fa, "samplecharacteristics")
        _el(doc, fasc, "depth", str(file_meta.get("audio_depth", 16)))
        _el(doc, fasc, "samplerate", str(file_meta.get("audio_samplerate", 48000)))

    return fe


# ── Public API ───────────────────────────────────────────────────────────────

def generate_premiere_xml(
    cutsheet_text: str,
    sequence_name: str = "AI Cut Sheet Assembly",
    timebase: int = 25,
    width: int = 1920,
    height: int = 1080,
    source_file_name: str = "Interview_Footage",
    ntsc: bool = False,
    vo_gap_seconds: float = 5.0,
    source_files: Optional[dict] = None,
) -> str:
    """
    Parse a cut sheet and return a complete FCP XML string.

    Parameters
    ----------
    source_files : dict, optional
        Parsed metadata from the editor's Premiere XML (output of
        ``premiere_xml_parser.parse_premiere_xml``).  When supplied the
        generator uses real file paths for Camera A (track 0) and Camera B
        (track 1), placing both on every IP and ALT.
    """
    clips = parse_cutsheet(cutsheet_text)
    ip_or_alt = [c for c in clips if c.clip_type in ("ip", "alt")]
    if not ip_or_alt:
        raise ValueError("No interview pulls ([IP @ ...]) found in the cut sheet.")

    has_real_sources = (
        source_files is not None
        and len(source_files.get("tracks", [])) >= 1
    )

    # Override settings from source XML when available
    if has_real_sources:
        timebase = source_files.get("timebase", timebase)
        ntsc = source_files.get("ntsc", ntsc)
        width = source_files.get("width", width)
        height = source_files.get("height", height)
        if source_files.get("sequence_name"):
            sequence_name = f"AI Assembly — {source_files['sequence_name']}"

    max_source_seconds = max(c.source_out_seconds for c in ip_or_alt) + 60
    source_dur = seconds_to_frames(max_source_seconds, timebase)
    vo_gap = seconds_to_frames(vo_gap_seconds, timebase)

    seq_uuid = str(uuid.uuid4())

    # Resolve camera file references
    if has_real_sources:
        tracks = source_files["tracks"]
        files_db = source_files.get("files", {})

        cam_a_track = tracks[0] if len(tracks) >= 1 else None
        cam_b_track = tracks[1] if len(tracks) >= 2 else None

        cam_a_file_id = cam_a_track["file_id"] if cam_a_track else f"file-{uuid.uuid4().hex[:8]}"
        cam_b_file_id = cam_b_track["file_id"] if cam_b_track else None

        cam_a_meta = files_db.get(cam_a_file_id)
        cam_b_meta = files_db.get(cam_b_file_id) if cam_b_file_id else None

        cam_a_master = f"masterclip-camA-{uuid.uuid4().hex[:8]}"
        cam_b_master = f"masterclip-camB-{uuid.uuid4().hex[:8]}" if cam_b_file_id else None

        if cam_a_meta and cam_a_meta.get("duration"):
            source_dur = cam_a_meta["duration"]
    else:
        cam_a_file_id = f"file-{uuid.uuid4().hex[:8]}"
        cam_b_file_id = None
        cam_a_meta = None
        cam_b_meta = None
        cam_a_master = f"masterclip-{uuid.uuid4().hex[:8]}"
        cam_b_master = None

    # ── Lay out timeline ─────────────────────────────────────────────────
    v1_items: list[dict] = []   # Camera A IPs
    v2_items: list[dict] = []   # Camera B IPs  (only when real sources)
    v3_items: list[dict] = []   # Camera A ALTs (or V2 ALTs in placeholder mode)
    v4_items: list[dict] = []   # Camera B ALTs (only when real sources)
    seq_markers: list[dict] = []
    seen_sections: set[str] = set()
    cursor = 0
    last_ip_start = 0

    ordered = sorted(clips, key=lambda c: c.order)

    for clip in ordered:
        if clip.section not in seen_sections:
            seen_sections.add(clip.section)
            seq_markers.append(dict(name=clip.section,
                                    comment=f"Section: {clip.section}",
                                    frame=cursor))

        if clip.clip_type == "vo":
            seq_markers.append(dict(
                name=f"VO: {clip.text[:50]}{'...' if len(clip.text) > 50 else ''}",
                comment=clip.text,
                frame=cursor,
            ))
            cursor += vo_gap
            continue

        dur_sec = clip.source_out_seconds - clip.source_in_seconds
        if dur_sec <= 0:
            dur_sec = 10
        dur_frames = seconds_to_frames(dur_sec, timebase)
        in_f = seconds_to_frames(clip.source_in_seconds, timebase)
        out_f = seconds_to_frames(clip.source_out_seconds, timebase)

        label = _tc_display(clip.source_in_seconds, timebase)
        label_end = _tc_display(clip.source_out_seconds, timebase)
        prefix = "IP" if clip.clip_type == "ip" else "ALT"

        item = dict(
            name=f"{prefix} {label}\u2013{label_end}",
            start=cursor if clip.clip_type == "ip" else last_ip_start,
            end=(cursor + dur_frames) if clip.clip_type == "ip" else (last_ip_start + dur_frames),
            in_frame=in_f,
            out_frame=out_f,
            source_dur=source_dur,
            tone=clip.tone,
            tone_intensity=clip.tone_intensity,
            broll=clip.broll_note,
            text=clip.text[:200],
            section=clip.section,
        )

        if clip.clip_type == "ip":
            v1_items.append(item)
            if has_real_sources and cam_b_file_id:
                v2_items.append(item)
            last_ip_start = cursor
            cursor += dur_frames
        else:
            if has_real_sources:
                v3_items.append(item)
                if cam_b_file_id:
                    v4_items.append(item)
            else:
                v3_items.append(item)

    total_dur = cursor or 1

    # ── Build XML DOM ────────────────────────────────────────────────────
    doc = minidom.Document()
    xmeml = doc.createElement("xmeml")
    xmeml.setAttribute("version", "4")
    doc.appendChild(xmeml)

    seq = _el(doc, xmeml, "sequence")
    seq.setAttribute("id", "sequence-1")
    _el(doc, seq, "uuid", seq_uuid)
    _el(doc, seq, "name", sequence_name)
    _el(doc, seq, "duration", str(total_dur))
    _rate_block(doc, seq, timebase, ntsc)

    tc = _el(doc, seq, "timecode")
    _rate_block(doc, tc, timebase, ntsc)
    _el(doc, tc, "string", "00:00:00:00")
    _el(doc, tc, "frame", "0")
    _el(doc, tc, "displayformat", "NDF")

    for sm in seq_markers:
        _marker(doc, seq, sm["name"], sm["comment"], sm["frame"])

    media = _el(doc, seq, "media")

    # ── VIDEO ────────────────────────────────────────────────────────────
    video = _el(doc, media, "video")
    vfmt = _el(doc, video, "format")
    vsc = _el(doc, vfmt, "samplecharacteristics")
    _rate_block(doc, vsc, timebase, ntsc)
    _el(doc, vsc, "width", str(width))
    _el(doc, vsc, "height", str(height))
    _el(doc, vsc, "anamorphic", "FALSE")
    _el(doc, vsc, "pixelaspectratio", "square")
    _el(doc, vsc, "fielddominance", "none")

    # Track state: which file IDs have had their full block written
    written_file_ids: set[str] = set()

    def _write_video_clipitem(parent, item, idx, tprefix, file_id, master_id, file_meta):
        ci = _el(doc, parent, "clipitem")
        ci.setAttribute("id", f"clipitem-{tprefix}-{idx}")
        _el(doc, ci, "masterclipid", master_id)
        _el(doc, ci, "name", item["name"])
        _el(doc, ci, "enabled", "TRUE")
        _el(doc, ci, "duration", str(item["source_dur"]))
        _rate_block(doc, ci, timebase, ntsc)
        _el(doc, ci, "start", str(item["start"]))
        _el(doc, ci, "end", str(item["end"]))
        _el(doc, ci, "in", str(item["in_frame"]))
        _el(doc, ci, "out", str(item["out_frame"]))

        if file_id not in written_file_ids:
            _write_file_block(doc, ci, file_id, file_meta,
                              source_file_name, source_dur,
                              timebase, ntsc, width, height)
            written_file_ids.add(file_id)
        else:
            fe = _el(doc, ci, "file")
            fe.setAttribute("id", file_id)

        if item.get("tone"):
            _marker(doc, ci,
                    f"TONE: {item['tone']} \u2014 {item['tone_intensity']}",
                    item["text"], item["in_frame"])
        if item.get("broll"):
            _marker(doc, ci, "B-ROLL", item["broll"][:250], item["in_frame"])

    def _write_audio_clipitem(parent, item, idx, tprefix, file_id, master_id):
        ci = _el(doc, parent, "clipitem")
        ci.setAttribute("id", f"clipitem-{tprefix}-{idx}")
        _el(doc, ci, "masterclipid", master_id)
        _el(doc, ci, "name", item["name"])
        _el(doc, ci, "enabled", "TRUE")
        _el(doc, ci, "duration", str(item["source_dur"]))
        _rate_block(doc, ci, timebase, ntsc)
        _el(doc, ci, "start", str(item["start"]))
        _el(doc, ci, "end", str(item["end"]))
        _el(doc, ci, "in", str(item["in_frame"]))
        _el(doc, ci, "out", str(item["out_frame"]))
        fe = _el(doc, ci, "file")
        fe.setAttribute("id", file_id)

    # V1: Camera A primary IPs
    t_v1 = _el(doc, video, "track")
    for i, item in enumerate(v1_items):
        _write_video_clipitem(t_v1, item, i + 1, "v1",
                              cam_a_file_id, cam_a_master, cam_a_meta)

    # V2: Camera B primary IPs (only with real sources)
    if v2_items and cam_b_file_id and cam_b_master:
        t_v2 = _el(doc, video, "track")
        for i, item in enumerate(v2_items):
            _write_video_clipitem(t_v2, item, i + 1, "v2",
                                  cam_b_file_id, cam_b_master, cam_b_meta)

    # V3: ALT takes (Camera A, or single-source ALTs in placeholder mode)
    if v3_items:
        t_v3 = _el(doc, video, "track")
        for i, item in enumerate(v3_items):
            _write_video_clipitem(t_v3, item, i + 1, "v3",
                                  cam_a_file_id, cam_a_master, cam_a_meta)

    # V4: Camera B ALT takes (only with real sources + 2 cameras)
    if v4_items and cam_b_file_id and cam_b_master:
        t_v4 = _el(doc, video, "track")
        for i, item in enumerate(v4_items):
            _write_video_clipitem(t_v4, item, i + 1, "v4",
                                  cam_b_file_id, cam_b_master, cam_b_meta)

    # ── AUDIO ────────────────────────────────────────────────────────────
    audio_el = _el(doc, media, "audio")
    _el(doc, audio_el, "numOutputChannels", "2")
    afmt = _el(doc, audio_el, "format")
    asc = _el(doc, afmt, "samplecharacteristics")
    _el(doc, asc, "depth", "16")
    _el(doc, asc, "samplerate", "48000")

    # A1: mirrors V1
    at1 = _el(doc, audio_el, "track")
    for i, item in enumerate(v1_items):
        _write_audio_clipitem(at1, item, i + 1, "a1", cam_a_file_id, cam_a_master)

    # A2: mirrors V2
    if v2_items and cam_b_file_id and cam_b_master:
        at2 = _el(doc, audio_el, "track")
        for i, item in enumerate(v2_items):
            _write_audio_clipitem(at2, item, i + 1, "a2", cam_b_file_id, cam_b_master)

    # A3: mirrors V3
    if v3_items:
        at3 = _el(doc, audio_el, "track")
        for i, item in enumerate(v3_items):
            _write_audio_clipitem(at3, item, i + 1, "a3", cam_a_file_id, cam_a_master)

    # A4: mirrors V4
    if v4_items and cam_b_file_id and cam_b_master:
        at4 = _el(doc, audio_el, "track")
        for i, item in enumerate(v4_items):
            _write_audio_clipitem(at4, item, i + 1, "a4", cam_b_file_id, cam_b_master)

    # ── Serialize ────────────────────────────────────────────────────────
    raw = doc.toprettyxml(indent="  ", encoding="UTF-8").decode("utf-8")
    raw = raw.replace(
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml>',
    )
    return raw


def get_parsed_clips_summary(cutsheet_text: str) -> dict:
    """Return a JSON-friendly summary of what was parsed (for preview)."""
    clips = parse_cutsheet(cutsheet_text)
    ip_clips = [c for c in clips if c.clip_type == "ip"]
    alt_clips = [c for c in clips if c.clip_type == "alt"]
    vo_clips = [c for c in clips if c.clip_type == "vo"]
    sections = list(dict.fromkeys(c.section for c in clips))

    total_ip_seconds = sum(
        max(c.source_out_seconds - c.source_in_seconds, 0) for c in ip_clips
    )

    return {
        "total_clips": len(ip_clips),
        "total_alts": len(alt_clips),
        "total_vos": len(vo_clips),
        "sections": sections,
        "estimated_runtime_seconds": round(total_ip_seconds + len(vo_clips) * 5, 1),
        "clips": [
            {
                "type": c.clip_type,
                "section": c.section,
                "in": round(c.source_in_seconds, 2),
                "out": round(c.source_out_seconds, 2),
                "duration": round(max(c.source_out_seconds - c.source_in_seconds, 0), 2),
                "tone": f"{c.tone} — {c.tone_intensity}" if c.tone else None,
                "has_broll": bool(c.broll_note),
                "text_preview": c.text[:80],
            }
            for c in clips
            if c.clip_type in ("ip", "alt")
        ],
    }
