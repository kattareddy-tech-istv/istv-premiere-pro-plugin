import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import CORS_ORIGINS, APP_VERSION
from .clients import init_clients, close_clients
from .cleanup import cleanup_loop
from .routers import upload, transcribe, generate, broll

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)
logger = logging.getLogger(__name__)

_cleanup_task: asyncio.Task | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _cleanup_task
    init_clients()
    _cleanup_task = asyncio.create_task(cleanup_loop())
    logger.info("App v%s started — clients ready, cleanup scheduled", APP_VERSION)
    yield
    logger.info("Graceful shutdown started — draining in-flight requests …")
    _cleanup_task.cancel()
    await close_clients()
    logger.info("App shutdown complete")


app = FastAPI(
    title="Inside Success TV — Production Pipeline",
    version=APP_VERSION,
    description="Audio transcription and editor cut sheet generation pipeline",
    lifespan=lifespan,
)

# ── CORS ─────────────────────────────────────────────────────────────────────
_origins = (
    ["*"]
    if CORS_ORIGINS.strip() == "*"
    else [o.strip() for o in CORS_ORIGINS.split(",") if o.strip()]
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ──────────────────────────────────────────────────────────────────
app.include_router(upload.router)
app.include_router(transcribe.router)
app.include_router(generate.router)
app.include_router(broll.router)


@app.get("/api/health")
async def health():
    return {"status": "ok", "version": APP_VERSION, "service": "Inside Success TV Pipeline"}
