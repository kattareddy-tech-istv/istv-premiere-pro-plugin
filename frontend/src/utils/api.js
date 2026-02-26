// Backend URL: from .env (VITE_API_URL) or default localhost:8000. Requests go to the backend directly.
const API_BASE =
  typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_API_URL
    ? import.meta.env.VITE_API_URL.replace(/\/$/, "")
    : "http://localhost:8000";
const API = `${API_BASE}/api`;

// ── Direct File Upload (with progress) ──────────────────────────────────────

export async function uploadFile(file, onProgress) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API}/upload`);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && typeof onProgress === "function") {
        const pct = (event.loaded / event.total) * 100;
        onProgress(pct);
      }
    };

    xhr.onreadystatechange = () => {
      if (xhr.readyState !== XMLHttpRequest.DONE) return;
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const json = JSON.parse(xhr.responseText);
          resolve(json);
        } catch {
          reject(new Error("Upload response parse failed"));
        }
      } else {
        let message = "Upload failed";
        try {
          const parsed = JSON.parse(xhr.responseText);
          if (parsed?.detail) message = parsed.detail;
        } catch {
          // ignore
        }
        reject(new Error(message));
      }
    };

    xhr.onerror = () => {
      reject(new Error("Network error during upload"));
    };

    xhr.send(form);
  });
}

// ── Compression & Transcription ─────────────────────────────────────────────

export async function compressAudio(fileId) {
  const r = await fetch(`${API}/transcribe/compress/${fileId}`, { method: "POST" });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || "Compression failed");
  return r.json();
}

export async function startTranscription(compressedFileId) {
  const r = await fetch(`${API}/transcribe/start/${compressedFileId}`, { method: "POST" });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || "Transcription start failed");
  return r.json();
}

export async function checkTranscriptionStatus(jobId) {
  const r = await fetch(`${API}/transcribe/status/${jobId}`);
  if (!r.ok) throw new Error("Status check failed");
  return r.json();
}

export async function getTranscriptResult(jobId) {
  const r = await fetch(`${API}/transcribe/result/${jobId}`);
  if (!r.ok) throw new Error("Failed to fetch transcript");
  return r.json();
}

export async function importTranscript(transcriptData) {
  try {
    const r = await fetch(`${API}/transcribe/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript: transcriptData }),
    });

    if (!r.ok) {
      let errorDetail = "Import failed";
      if (r.status === 404) {
        errorDetail =
          "Backend not running (404). Start it first: run backend\\run.bat (Windows) or in a terminal: cd backend && uvicorn app.main:app --reload --port 8000. Then restart the frontend (npm run dev).";
      } else {
        try {
          const errorData = await r.json();
          errorDetail = errorData.detail || errorData.message || `Server error: ${r.status} ${r.statusText}`;
        } catch {
          errorDetail = `Server error: ${r.status} ${r.statusText}`;
        }
      }
      const error = new Error(errorDetail);
      error.response = r;
      throw error;
    }

    return await r.json();
  } catch (err) {
    if (err instanceof Error) {
      throw err;
    }
    throw new Error(`Import failed: ${String(err)}`);
  }
}

// ── AI Generation ───────────────────────────────────────────────────────────

export async function getModels() {
  const r = await fetch(`${API}/generate/models`);
  if (!r.ok) throw new Error("Failed to fetch models");
  return r.json();
}

export async function getPricing() {
  const r = await fetch(`${API}/generate/pricing`);
  if (!r.ok) throw new Error("Failed to fetch pricing");
  return r.json();
}

export async function getDefaultPrompt() {
  const r = await fetch(`${API}/generate/default-prompt`);
  if (!r.ok) throw new Error("Failed to fetch prompt");
  return r.json();
}

export async function generateCutSheet({ transcriptJobId, provider, model, prompt }) {
  let r;
  try {
    r = await fetch(`${API}/generate/cutsheet`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transcript_job_id: transcriptJobId != null ? String(transcriptJobId) : undefined,
        provider: provider || "anthropic",
        model: model || "claude-sonnet-4-5",
        custom_prompt: prompt || undefined,
      }),
    });
  } catch (err) {
    throw new Error(err.message || "Network error. Is the backend running?");
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const detail = data.detail;
    const message = Array.isArray(detail)
      ? detail.map((d) => d.msg || JSON.stringify(d)).join("; ")
      : detail || "Cut sheet generation failed";
    throw new Error(typeof message === "string" ? message : JSON.stringify(message));
  }
  return data;
}
