from pydantic import BaseModel
from typing import Optional, List


# ── Upload ───────────────────────────────────────────────────────────────────

class UploadInitResponse(BaseModel):
    upload_id: str
    chunk_size: int
    total_chunks: int


class ChunkUploadResponse(BaseModel):
    upload_id: str
    chunk_index: int
    chunks_received: int
    total_chunks: int


class UploadCompleteResponse(BaseModel):
    file_id: str
    filename: str
    file_size: int
    file_size_human: str


# ── Compression ──────────────────────────────────────────────────────────────

class CompressResponse(BaseModel):
    file_id: str
    original_size: int
    compressed_size: int
    compression_ratio: float
    original_size_human: str
    compressed_size_human: str


# ── Transcription ────────────────────────────────────────────────────────────

class TranscriptWord(BaseModel):
    value: str
    start: Optional[float] = None
    end: Optional[float] = None
    confidence: Optional[float] = None
    speaker: Optional[int] = None


class TranscriptSentence(BaseModel):
    text: str
    start: Optional[float] = None
    end: Optional[float] = None
    speaker: Optional[int] = None
    speaker_name: Optional[str] = None
    words: List[TranscriptWord] = []


class Speaker(BaseModel):
    id: int
    name: str


class TranscriptResult(BaseModel):
    job_id: str
    sentences: List[TranscriptSentence]
    speakers: List[Speaker]
    duration: float
    word_count: int


# ── AI Generation ────────────────────────────────────────────────────────────

class CutSheetRequest(BaseModel):
    transcript_job_id: str
    provider: str
    model: str
    custom_prompt: Optional[str] = None


class CutSheetResponse(BaseModel):
    cutsheet_id: str
    cutsheet: str
    provider: str
    model: str
    input_tokens: int
    output_tokens: int
    cost_usd: float


# ── Premiere Pro XML Export ──────────────────────────────────────────────────

class PremiereExportRequest(BaseModel):
    sequence_name: Optional[str] = "AI Cut Sheet Assembly"
    timebase: int = 25
    width: int = 1920
    height: int = 1080
    source_file_name: Optional[str] = "Interview_Footage"
    ntsc: bool = False
    vo_gap_seconds: float = 5.0
    premiere_xml_id: Optional[str] = None
