import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

# ── Paths ────────────────────────────────────────────────────────────────────
BASE_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BASE_DIR.parent

# Default cut-sheet prompt: editable at repository root (see DOCUMENTARY_CUT_SHEET_PROMPT.txt).
_repo_prompt = REPO_ROOT / "DOCUMENTARY_CUT_SHEET_PROMPT.txt"
_backend_prompt = BASE_DIR / "DOCUMENTARY_CUT_SHEET_PROMPT.txt"
_default_prompt_path = (
    _repo_prompt if _repo_prompt.exists() else _backend_prompt
)
CUTSHEET_PROMPT_FILE = Path(
    os.getenv("CUTSHEET_PROMPT_FILE", str(_default_prompt_path))
)

# Persistent storage root.
# On Render set DATA_DIR=/data (mounted persistent disk).
# Locally it falls back to the backend/ project directory.
DATA_DIR = Path(os.getenv("DATA_DIR", str(BASE_DIR)))
DATA_DIR.mkdir(parents=True, exist_ok=True)

UPLOAD_DIR = DATA_DIR / "uploads"
CHUNKS_DIR = DATA_DIR / "chunks"
COMPRESSED_DIR = DATA_DIR / "compressed"
TRANSCRIPTS_DIR = DATA_DIR / "transcripts"
CUTSHEETS_DIR = DATA_DIR / "cutsheets"
BROLL_DIR = DATA_DIR / "broll"
PREMIERE_XMLS_DIR = DATA_DIR / "premiere_xmls"
PROMPTS_DIR = DATA_DIR / "prompts"

for _d in [UPLOAD_DIR, CHUNKS_DIR, COMPRESSED_DIR, TRANSCRIPTS_DIR,
           CUTSHEETS_DIR, BROLL_DIR, PREMIERE_XMLS_DIR, PROMPTS_DIR]:
    _d.mkdir(parents=True, exist_ok=True)

# ── API Keys ─────────────────────────────────────────────────────────────────
REV_AI_TOKEN = os.getenv("REV_AI_TOKEN", "")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
PEXELS_API_KEY = os.getenv("PEXELS_API_KEY", "")

# ── Upload settings ──────────────────────────────────────────────────────────
MAX_FILE_SIZE = 10 * 1024 * 1024 * 1024  # 10 GB
CHUNK_SIZE = 10 * 1024 * 1024            # 10 MB per chunk

# ── Audio compression (FFmpeg) ───────────────────────────────────────────────
COMPRESSED_BITRATE = "64k"
COMPRESSED_SAMPLE_RATE = "16000"
COMPRESSED_FORMAT = "mp3"
FFMPEG_TIMEOUT_SECONDS = int(os.getenv("FFMPEG_TIMEOUT_SECONDS", "1800"))  # 30 min

# Uploads larger than this (bytes) are transcoded before Rev; at or below → copy as-is (saves FFmpeg time).
# Default 200 MB — e.g. 150 MB MP3 skips compression; 2 GB WAV runs through FFmpeg.
_COMPRESS_ABOVE_MB = float(os.getenv("COMPRESS_AUDIO_ABOVE_MB", "200"))
COMPRESS_AUDIO_ABOVE_MB = max(0.0, _COMPRESS_ABOVE_MB)
COMPRESS_AUDIO_THRESHOLD_BYTES = int(COMPRESS_AUDIO_ABOVE_MB * 1024 * 1024)

# ── Concurrency limits ───────────────────────────────────────────────────────
# These cap how many simultaneous external calls the backend makes,
# preventing API rate-limit storms when 20+ editors hit the tool at once.
MAX_CONCURRENT_FFMPEG = int(os.getenv("MAX_CONCURRENT_FFMPEG", "3"))
MAX_CONCURRENT_REVAI = int(os.getenv("MAX_CONCURRENT_REVAI", "4"))
MAX_CONCURRENT_AI = int(os.getenv("MAX_CONCURRENT_AI", "6"))

# ── CORS ─────────────────────────────────────────────────────────────────────
# Comma-separated origins, or "*" for wide-open (dev only).
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "*")

# ── File cleanup ─────────────────────────────────────────────────────────────
FILE_MAX_AGE_HOURS = int(os.getenv("FILE_MAX_AGE_HOURS", "24"))

# ── App version (bumped on deploy, or set via env var) ───────────────────────
APP_VERSION = os.getenv("APP_VERSION", "2.1.0")
