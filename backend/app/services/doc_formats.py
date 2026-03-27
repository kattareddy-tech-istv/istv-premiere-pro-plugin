"""
Documentary format presets.

Each format tunes the AI cut-sheet prompt for a specific target runtime
and editorial style. The format header is prepended to the main prompt
so the AI generates a cut sheet appropriate for the selected length.
"""

DOC_FORMATS = {
    "12_15min": {
        "label": "12-15 min (Punchy Edit)",
        "runtime": "12-15 minutes",
        "sections": "6-8",
        "style": (
            "Tight and punchy. Aggressive cuts. Maximum impact, zero filler. "
            "Favour short, high-energy IPs. Cut every weak or redundant moment. "
            "Move fast — the audience should never feel the pacing slow down."
        ),
    },
    "15min": {
        "label": "15 min (Standard)",
        "runtime": "15 minutes",
        "sections": "8-10",
        "style": (
            "Balanced pacing with a strong hook and clean throughline. "
            "Keep momentum throughout. Allow 1-2 breathing moments but no lingering."
        ),
    },
    "16_22min": {
        "label": "16-22 min (Extended)",
        "runtime": "16-22 minutes",
        "sections": "10-14",
        "style": (
            "Allow breathing room between key moments. Include secondary story threads "
            "and supporting anecdotes that add colour. The narrative can explore nuance."
        ),
    },
    "23_25min": {
        "label": "23-25 min (Full Documentary)",
        "runtime": "23-25 minutes",
        "sections": "12-18",
        "style": (
            "Full documentary treatment. Rich narrative depth. Include the full origin "
            "story, key challenges, turning points, and legacy/future arcs. "
            "All appendices should be detailed."
        ),
    },
    "20_25min_vip": {
        "label": "20-25 min (VIP Documentary)",
        "runtime": "20-25 minutes",
        "sections": "12-18",
        "style": (
            "Premium VIP production quality. Maximum storytelling depth and emotional "
            "resonance. Full arc: hook, origin, struggle, breakthrough, impact, legacy. "
            "All appendices must be thorough with detailed editor notes."
        ),
    },
}


def get_format_header(format_key: str) -> str:
    """Return a format-instruction block to prepend to the main cut-sheet prompt."""
    fmt = DOC_FORMATS.get(format_key) or DOC_FORMATS["20_25min_vip"]
    return (
        f"DOCUMENTARY FORMAT: {fmt['label']}\n"
        f"Target Runtime: {fmt['runtime']}\n"
        f"Number of Sections: {fmt['sections']} sections\n"
        f"Style Guidance: {fmt['style']}\n\n"
        "Apply these format requirements throughout. The final cut sheet MUST target "
        f"the {fmt['runtime']} runtime. Adjust the number of IPs, section depth, and "
        "overall selection volume accordingly.\n\n"
        "---\n\n"
    )
