# Inside Success TV — Production Pipeline

Audio transcription and editor cut sheet generation pipeline.

**Upload raw audio (up to 2 GB) → FFmpeg compression → Rev AI transcription with speaker diarization → AI-powered editor cut sheet generation (Claude / OpenAI / Gemini)**

---

## Architecture

| Layer    | Stack                          | Purpose                                   |
| -------- | ------------------------------ | ----------------------------------------- |
| Backend  | **FastAPI** (Python 3.12+)     | Audio processing, API orchestration       |
| Frontend | **React 18** + Vite            | Interactive pipeline UI                   |
| Audio    | **FFmpeg**                     | Compress 2 GB → ~100 MB (mono 16kHz 64k) |
| STT      | **Rev AI**                     | Transcription + speaker diarization       |
| AI       | **Claude / OpenAI / Gemini**   | Cut sheet generation                      |

---

## Prerequisites

- **Python 3.12+**
- **Node.js 18+**
- **FFmpeg** installed and on PATH (`ffmpeg -version` to verify)
- API keys for: Rev AI, Anthropic, OpenAI, Google Gemini

---

## Quick Start (Development)

### 1. Backend

```bash
cd backend
python -m venv venv
venv\Scripts\activate        # Windows
# source venv/bin/activate   # macOS/Linux
pip install -r requirements.txt
```

Fill in `backend/.env` with your API keys:

```
REV_AI_TOKEN=your_token
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=AI...
```

Start the backend:

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:3000**

---

## Deployment (Vercel + Render recommended)

### Frontend on Vercel

1. Create a Vercel project from this repo using **`frontend`** as the root directory.
2. Set env var:

```bash
VITE_API_URL=https://your-render-backend.onrender.com
```

3. Build settings:
   - Framework preset: **Vite**
   - Build command: `npm run build`
   - Output directory: `dist`

`frontend/vercel.json` already includes SPA rewrite to `index.html`.

### Backend on Render

Use included `render.yaml` (Blueprint deploy). It provisions:
- Docker web service from `backend/Dockerfile`
- Persistent disk mounted at `/data`
- Health check at `/api/health`
- Required env keys (set secure values in Render dashboard)

Important backend env vars:
- `REV_AI_TOKEN`
- `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY`
- `CORS_ORIGINS=https://your-vercel-domain.vercel.app`
- `COMPRESS_AUDIO_ABOVE_MB=200` (threshold for when FFmpeg runs)

### Alternative: Local Docker Compose

```bash
docker-compose up --build
```

- Frontend: `http://localhost:3000`
- Backend API: `http://localhost:8000`

---

## Pipeline Flow

1. **Upload** — Chunked upload (10 MB chunks) handles files up to 2 GB
2. **Prepare Audio** — If upload is above `COMPRESS_AUDIO_ABOVE_MB` (default 200 MB), FFmpeg converts to mono 16 kHz MP3 at 64 kbps; otherwise upload is passed through as-is
3. **Transcribe** — Rev AI async transcription with speaker diarization
4. **Review** — Sentence-by-sentence timestamped transcript with speaker labels
5. **Generate** — AI model generates editor cut sheet from transcript
6. **Download** — Export transcript (JSON) and cut sheet (JSON/TXT) at any step

---

## API Endpoints

| Method | Path                                  | Description                    |
| ------ | ------------------------------------- | ------------------------------ |
| POST   | `/api/upload/init`                    | Initialize chunked upload      |
| POST   | `/api/upload/chunk/{upload_id}`       | Upload single chunk            |
| POST   | `/api/upload/complete/{upload_id}`    | Assemble chunks                |
| POST   | `/api/transcribe/compress/{file_id}`  | Compress audio with FFmpeg     |
| POST   | `/api/transcribe/start/{file_id}`     | Submit to Rev AI               |
| GET    | `/api/transcribe/status/{job_id}`     | Poll transcription status      |
| GET    | `/api/transcribe/result/{job_id}`     | Get parsed transcript          |
| GET    | `/api/transcribe/download/{job_id}`   | Download transcript JSON       |
| GET    | `/api/generate/models`                | Available AI models            |
| GET    | `/api/generate/pricing`               | Token pricing per model        |
| POST   | `/api/generate/cutsheet`              | Generate cut sheet             |
| GET    | `/api/generate/download/{id}`         | Download cut sheet             |

---

## AI Model Options

### Anthropic (Claude)
- **Claude Opus 4.6** — Most intelligent, launched Feb 2026 ($5/$25 per 1M tokens)
- **Claude Sonnet 4.5** — Balanced speed/intelligence, recommended ($3/$15)
- **Claude Haiku 4.5** — Fastest, most cost-efficient ($1/$5)

### OpenAI
- **GPT-4o** — Latest, recommended ($2.5/$10)
- **GPT-4o Mini** — Cheapest ($0.15/$0.60)
- **GPT-4 Turbo** — High capability ($10/$30)

### Google Gemini
- **Gemini 2.0 Flash** — Fastest, recommended ($0.075/$0.30)
- **Gemini 1.5 Pro** — Balanced ($1.25/$5)
- **Gemini 2.0 Pro** — Most capable ($1.25/$10)

---

## Cost Tracking

Token counts and costs are tracked in real-time for every AI API call. The UI displays:
- Estimated cost before generation (based on transcript word count)
- Actual input/output tokens after generation
- Per-model cost breakdown
- Running total across all generations
