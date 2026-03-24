FROM python:3.12-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .
COPY DOCUMENTARY_CUT_SHEET_PROMPT.txt .

ENV DATA_DIR=/data
RUN mkdir -p /data/uploads /data/chunks /data/compressed \
             /data/transcripts /data/cutsheets /data/broll /data/premiere_xmls \
             /data/prompts

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8000/api/health || exit 1

CMD ["gunicorn", "app.main:app", \
     "-k", "uvicorn.workers.UvicornWorker", \
     "-w", "2", \
     "--bind", "0.0.0.0:8000", \
     "--timeout", "1800", \
     "--graceful-timeout", "180", \
     "--keep-alive", "5", \
     "--access-logfile", "-"]
