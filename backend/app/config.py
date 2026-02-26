import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

# ── Paths ────────────────────────────────────────────────────────────────────
BASE_DIR = Path(__file__).resolve().parent.parent
UPLOAD_DIR = BASE_DIR / "uploads"
CHUNKS_DIR = BASE_DIR / "chunks"
COMPRESSED_DIR = BASE_DIR / "compressed"
TRANSCRIPTS_DIR = BASE_DIR / "transcripts"
CUTSHEETS_DIR = BASE_DIR / "cutsheets"

for _d in [UPLOAD_DIR, CHUNKS_DIR, COMPRESSED_DIR, TRANSCRIPTS_DIR, CUTSHEETS_DIR]:
    _d.mkdir(parents=True, exist_ok=True)

# ── API Keys ─────────────────────────────────────────────────────────────────
REV_AI_TOKEN = os.getenv("REV_AI_TOKEN", "")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

# ── Upload settings ──────────────────────────────────────────────────────────
MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024  # 2 GB
CHUNK_SIZE = 10 * 1024 * 1024            # 10 MB per chunk

# ── Audio compression (FFmpeg) ───────────────────────────────────────────────
COMPRESSED_BITRATE = "64k"
COMPRESSED_SAMPLE_RATE = "16000"
COMPRESSED_FORMAT = "mp3"
