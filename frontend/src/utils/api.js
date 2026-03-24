// Backend URL: from .env (VITE_API_URL) or a sensible local default.
// Dev note: when we run the frontend on 3001, we typically run the backend on 8001.
const DEFAULT_LOCAL_BACKEND = (() => {
  if (typeof window === "undefined") return "http://localhost:8000";
  const port = window.location?.port;
  return port === "3001" ? "http://127.0.0.1:8001" : "http://localhost:8000";
})();

const API_BASE =
  typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_API_URL
    ? import.meta.env.VITE_API_URL.replace(/\/$/, "")
    : DEFAULT_LOCAL_BACKEND;
const API = `${API_BASE}/api`;

// Hardcoded at build time — compared against backend /api/health version
export const FRONTEND_VERSION = "2.1.0";

export async function checkBackendVersion() {
  try {
    const r = await fetch(`${API}/health`);
    if (!r.ok) return null;
    const data = await r.json();
    return data.version || null;
  } catch {
    return null;
  }
}

// ── Direct File Upload (with progress) ──────────────────────────────────────

const UPLOAD_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export async function uploadFile(file, onProgress) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);

    const xhr = new XMLHttpRequest();
    xhr.timeout = UPLOAD_TIMEOUT_MS;
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

    xhr.ontimeout = () => {
      reject(new Error("Upload timed out (30 min limit). Try a smaller file or check your connection."));
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

/** Defaults for auto cut-sheet generation (mirrors ModelSelector init). */
export async function getCutSheetAutoDefaults() {
  try {
    const [models, promptRes] = await Promise.all([getModels(), getDefaultPrompt()]);
    const anth = models?.anthropic?.models;
    let modelId = "claude-opus-4-6";
    if (anth && anth.length > 0) {
      const rec = anth.find((m) => m.recommended);
      modelId = rec?.id || anth[0].id;
    }
    return {
      provider: "anthropic",
      model: modelId,
      prompt: promptRes?.prompt ?? "",
    };
  } catch {
    return { provider: "anthropic", model: "claude-opus-4-6", prompt: "" };
  }
}

// ── B-Roll Suggestions ───────────────────────────────────────────────────

export async function generateBRoll({ transcriptJobId, provider, model, verifyPexels = true, customPrompt }) {
  let r;
  try {
    r = await fetch(`${API}/broll/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transcript_job_id: String(transcriptJobId),
        provider: provider || "anthropic",
        model: model || "claude-opus-4-6",
        verify_pexels: verifyPexels,
        custom_prompt: customPrompt || undefined,
      }),
    });
  } catch (err) {
    throw new Error(err.message || "Network error during B-roll generation");
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(data.detail || "B-roll generation failed");
  }
  return data;
}

export async function getCachedBRoll(jobId) {
  const r = await fetch(`${API}/broll/${jobId}`);
  if (!r.ok) return null;
  return r.json();
}

export async function searchPexels(query, perPage = 5) {
  const r = await fetch(`${API}/broll/search-pexels`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, per_page: perPage }),
  });
  if (!r.ok) return { available: false, results: [] };
  return r.json();
}

export async function getBRollPrompt() {
  const r = await fetch(`${API}/broll/prompt`);
  if (!r.ok) throw new Error("Failed to fetch B-roll prompt");
  return r.json();
}

// ── Premiere Pro XML Round-Trip ──────────────────────────────────────────

export async function uploadPremiereXML(file) {
  const form = new FormData();
  form.append("file", file);
  const r = await fetch(`${API}/upload/premiere-xml`, { method: "POST", body: form });
  if (!r.ok) {
    const data = await r.json().catch(() => ({}));
    throw new Error(data.detail || "Premiere XML upload failed");
  }
  return r.json();
}

export async function getPremierePreview(cutsheetId) {
  const r = await fetch(`${API}/generate/premiere-preview/${cutsheetId}`);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || "Preview failed");
  return r.json();
}

export async function exportPremiereXML(cutsheetId, settings = {}) {
  const r = await fetch(`${API}/generate/export-xml/${cutsheetId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sequence_name: settings.sequenceName || "AI Cut Sheet Assembly",
      timebase: settings.timebase || 25,
      width: settings.width || 1920,
      height: settings.height || 1080,
      source_file_name: settings.sourceFileName || "Interview_Footage",
      ntsc: settings.ntsc || false,
      vo_gap_seconds: settings.voGapSeconds ?? 5.0,
      premiere_xml_id: settings.premiereXmlId || null,
    }),
  });
  if (!r.ok) {
    const data = await r.json().catch(() => ({}));
    throw new Error(data.detail || "XML export failed");
  }
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${cutsheetId}_premiere.xml`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── AI Generation ───────────────────────────────────────────────────────

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
