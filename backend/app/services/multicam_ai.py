"""
Multicam AI analysis service.

Takes a Premiere Pro sequence info payload (tracks, clips, timecodes)
and uses Claude to suggest edit points, camera switches, and cuts.
Returns structured JSON suggestions the panel can display and apply.
"""

import json
import logging
from .. import clients

logger = logging.getLogger(__name__)

MULTICAM_ANALYSIS_PROMPT = """You are a professional video editor with 20+ years of experience editing multicam interview footage, documentaries, and talk shows.

You have been given a JSON description of an Adobe Premiere Pro timeline sequence. The sequence has multiple video and audio tracks representing different camera angles and audio sources.

Your task is to analyze the timeline and suggest specific edit points to create a clean, professional assembly cut.

SEQUENCE DATA:
{sequence_info}

EDITOR INSTRUCTIONS:
{custom_instructions}

Analyze the tracks and clips and return ONLY a valid JSON object in this exact format:

{{
  "summary": "Brief 2-3 sentence analysis of the sequence",
  "total_suggestions": <number>,
  "estimated_edit_duration_seconds": <number>,
  "suggestions": [
    {{
      "id": <sequential integer starting at 1>,
      "time_seconds": <float — sequence timeline position in seconds>,
      "timecode": "<HH:MM:SS:FF format>",
      "action": "<one of: razor_cut | trim_in | trim_out | add_marker | camera_note>",
      "track_index": <video track index 0-based, or -1 for all tracks>,
      "track_label": "<human label like 'Camera A (V1)'>",
      "reason": "<1-2 sentence explanation of why this edit point>",
      "confidence": "<high | medium | low>",
      "cut_type": "<cut | j_cut | l_cut | match_cut>"
    }}
  ]
}}

Focus your suggestions on:
1. Natural speech pauses — good clean cut points where the speaker finishes a thought
2. Camera switches — moments where cutting to a different angle improves pacing or coverage
3. Dead air removal — long pauses or off-topic tangents to trim
4. Action matches — where action or movement on one camera matches another
5. B-roll placement — moments where cutaway/reaction shots would help

Rules:
- Only suggest cuts where there is actually a clip present on that track at that time
- Prefer high-confidence cuts at natural pauses over mid-sentence cuts
- For multicam sequences with 2+ cameras, suggest camera switches at 30-90 second intervals unless content requires otherwise
- Keep suggestions ordered chronologically by time_seconds
- Return 5-25 suggestions for a typical 5-30 minute sequence
- Do NOT include any markdown, code fences, or explanation outside the JSON object
"""


def _format_sequence_for_ai(sequence_info: dict) -> str:
    """Format the sequence JSON as readable text for Claude."""
    lines = []
    lines.append(f"Sequence: \"{sequence_info.get('sequence_name', 'Unnamed')}\"")
    lines.append(f"Frame Rate: {sequence_info.get('frame_rate', 25)} fps")
    lines.append(f"Duration: {sequence_info.get('duration_seconds', 0):.1f} seconds ({_seconds_to_tc(sequence_info.get('duration_seconds', 0), sequence_info.get('frame_rate', 25))})")
    lines.append("")

    video_tracks = sequence_info.get("video_tracks", [])
    audio_tracks = sequence_info.get("audio_tracks", [])

    lines.append(f"VIDEO TRACKS ({len(video_tracks)} total):")
    for vt in video_tracks:
        clips = vt.get("clips", [])
        lines.append(f"  V{vt['index'] + 1} \"{vt.get('name', 'Video ' + str(vt['index'] + 1))}\": {len(clips)} clips")
        for clip in clips[:50]:  # cap at 50 clips per track for token budget
            start_tc = _seconds_to_tc(clip.get("start_seconds", 0), sequence_info.get("frame_rate", 25))
            end_tc = _seconds_to_tc(clip.get("end_seconds", 0), sequence_info.get("frame_rate", 25))
            dur = clip.get("duration_seconds", 0)
            lines.append(f"    [{start_tc} -> {end_tc}] ({dur:.1f}s) \"{clip.get('name', 'clip')}\"")

    lines.append("")
    lines.append(f"AUDIO TRACKS ({len(audio_tracks)} total):")
    for at in audio_tracks:
        clips = at.get("clips", [])
        lines.append(f"  A{at['index'] + 1} \"{at.get('name', 'Audio ' + str(at['index'] + 1))}\": {len(clips)} clips")

    return "\n".join(lines)


def _seconds_to_tc(seconds: float, fps: float = 25) -> str:
    """Convert seconds to HH:MM:SS:FF timecode string."""
    if fps <= 0:
        fps = 25
    total_frames = int(round(seconds * fps))
    ff = total_frames % int(fps)
    total_secs = total_frames // int(fps)
    ss = total_secs % 60
    mm = (total_secs // 60) % 60
    hh = total_secs // 3600
    return f"{hh:02d}:{mm:02d}:{ss:02d}:{ff:02d}"


async def analyze_multicam_sequence(
    sequence_info: dict,
    model: str = "claude-opus-4-6",
    custom_instructions: str = "",
) -> dict:
    """
    Send sequence info to Claude and get back structured edit suggestions.

    Parameters
    ----------
    sequence_info : dict
        JSON from getMulticamSequenceInfo() in host.jsx
    model : str
        Claude model to use
    custom_instructions : str
        Editor-provided instructions (e.g. "focus on the interview sections")

    Returns
    -------
    dict with keys: summary, total_suggestions, suggestions, input_tokens, output_tokens, cost_usd
    """
    client = clients.get_anthropic()

    formatted = _format_sequence_for_ai(sequence_info)
    instructions = custom_instructions.strip() or "Create a clean, engaging assembly cut with good pacing."

    prompt = MULTICAM_ANALYSIS_PROMPT.format(
        sequence_info=formatted,
        custom_instructions=instructions,
    )

    async with clients.ai_sem:
        message = await client.messages.create(
            model=model,
            max_tokens=8192,
            messages=[{"role": "user", "content": prompt}],
        )

    raw_text = message.content[0].text.strip()
    inp = message.usage.input_tokens
    out = message.usage.output_tokens

    # Parse the JSON response
    try:
        # Strip any accidental markdown fences
        if raw_text.startswith("```"):
            raw_text = raw_text.split("```")[1]
            if raw_text.startswith("json"):
                raw_text = raw_text[4:]
            raw_text = raw_text.strip()
        result = json.loads(raw_text)
    except json.JSONDecodeError as e:
        logger.warning("Failed to parse Claude JSON response: %s\nRaw: %s", e, raw_text[:500])
        # Return a minimal valid response so the UI doesn't crash
        result = {
            "summary": "Analysis complete. See raw output for details.",
            "total_suggestions": 0,
            "estimated_edit_duration_seconds": 0,
            "suggestions": [],
            "raw_output": raw_text,
        }

    # Pricing (claude-opus-4-6)
    pricing = {
        "claude-opus-4-6":  {"input": 5.0,  "output": 25.0},
        "claude-sonnet-4-5": {"input": 3.0,  "output": 15.0},
        "claude-haiku-4-5":  {"input": 1.0,  "output": 5.0},
    }
    p = pricing.get(model, {"input": 5.0, "output": 25.0})
    cost = round((inp * p["input"] + out * p["output"]) / 1_000_000, 6)

    result["input_tokens"] = inp
    result["output_tokens"] = out
    result["cost_usd"] = cost
    result["model"] = model

    return result
