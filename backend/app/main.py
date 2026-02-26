from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers import upload, transcribe, generate

app = FastAPI(
    title="Inside Success TV — Production Pipeline",
    version="1.0.0",
    description="Audio transcription and editor cut sheet generation pipeline",
)

# ── CORS (allow React dev server) ────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ──────────────────────────────────────────────────────────────────
app.include_router(upload.router)
app.include_router(transcribe.router)
app.include_router(generate.router)


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "Inside Success TV Pipeline"}
