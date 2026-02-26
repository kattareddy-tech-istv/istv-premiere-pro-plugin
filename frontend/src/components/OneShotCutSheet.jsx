import { useEffect, useMemo, useRef, useState } from "react";
import { getDefaultPrompt, getModels, getPricing } from "../utils/api";
import { estimateCost } from "../utils/costs";

function extractJsonArray(text) {
  text = (text || "").trim();
  const startIdx = text.indexOf("[");
  if (startIdx === -1) throw new Error("No JSON array found. Expected '['");

  let depth = 0;
  let inString = false;
  let escapeNext = false;
  let endIdx = -1;

  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (ch === "\\") {
      escapeNext = true;
      continue;
    }
    if (ch === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "[") depth++;
    if (ch === "]") {
      depth--;
      if (depth === 0) {
        endIdx = i;
        break;
      }
    }
  }
  if (endIdx === -1) throw new Error("Unclosed JSON array. Missing ']'");
  return text.substring(startIdx, endIdx + 1);
}

function validateTranscriptArray(arr) {
  if (!Array.isArray(arr)) throw new Error("Transcript must be an array");
  if (arr.length === 0) throw new Error("Transcript array cannot be empty");
  for (let i = 0; i < arr.length; i++) {
    const it = arr[i];
    if (typeof it !== "object" || it === null) throw new Error(`Item at index ${i} must be an object`);
    if (!("text" in it)) throw new Error(`Item at index ${i} must have a 'text' field`);
  }
  return arr;
}

export default function OneShotCutSheet({ disabled, onRun }) {
  const [models, setModels] = useState(null);
  const [pricing, setPricing] = useState(null);
  const [provider, setProvider] = useState("anthropic");
  const [model, setModel] = useState("claude-opus-4-6");
  const [prompt, setPrompt] = useState("");
  const [showPrompt, setShowPrompt] = useState(true);

  const [jsonText, setJsonText] = useState("");
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    Promise.all([getModels(), getPricing(), getDefaultPrompt()])
      .then(([m, p, d]) => {
        setModels(m);
        setPricing(p);
        setPrompt(d.prompt);
        const rec = m?.anthropic?.models?.find((x) => x.recommended);
        if (rec?.id) setModel(rec.id);
      })
      .catch(console.error);
  }, []);

  const parsedPreview = useMemo(() => {
    try {
      if (!jsonText.trim()) return null;
      const maybe = JSON.parse(jsonText.trim());
      if (Array.isArray(maybe)) return maybe;
      return null;
    } catch {
      return null;
    }
  }, [jsonText]);

  const est = useMemo(() => {
    if (!pricing) return null;
    // rough estimate before import: use client-side word count
    const arr = parsedPreview;
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const wordCount = arr.reduce((s, it) => s + String(it?.text || "").trim().split(/\s+/).filter(Boolean).length, 0);
    const estInputTokens = Math.round(wordCount * 1.35);
    return {
      wordCount,
      estInputTokens,
      estCost: estimateCost(provider, model, estInputTokens, pricing),
    };
  }, [pricing, provider, model, parsedPreview]);

  const handleProviderChange = (p) => {
    setProvider(p);
    if (models?.[p]?.models) {
      const rec = models[p].models.find((m) => m.recommended);
      setModel(rec?.id || models[p].models[0].id);
    }
  };

  const handleFile = async (file) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".json")) {
      setError("Please select a JSON file");
      return;
    }
    const text = await file.text();
    // Try normalize to array only + pretty-print
    const cleaned = extractJsonArray(text);
    const parsed = validateTranscriptArray(JSON.parse(cleaned));
    setJsonText(JSON.stringify(parsed, null, 2));
    setError(null);
  };

  const handleRun = async () => {
    setError(null);
    try {
      let txt = jsonText.trim();
      let parsed;
      try {
        parsed = JSON.parse(txt);
      } catch {
        const cleaned = extractJsonArray(jsonText);
        parsed = JSON.parse(cleaned);
      }
      parsed = validateTranscriptArray(parsed);
      await onRun({ transcriptArray: parsed, provider, model, prompt });
    } catch (e) {
      setError(e?.message || "Failed to run one-shot generation");
    }
  };

  if (!models) return null;

  return (
    <div className="card fade-in">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h3 style={{ color: "var(--gold)", fontSize: 16, fontWeight: 600 }}>
          01 — Upload Transcript (Skip Audio)
        </h3>
        <span className="tag tag-gold">SINGLE STEP</span>
      </div>

      <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 16, lineHeight: 1.6 }}>
        Use this when you <strong>already have a transcript</strong> (for example downloaded from Rev or another tool) and want to skip audio upload and processing. Paste or upload the raw timestamped transcript JSON, tweak the prompt, pick a model, and generate the cut sheet in one step.
      </p>

      {/* Transcript JSON */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <label style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.8px", textTransform: "uppercase" }}>
            Transcript JSON
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              onChange={(e) => handleFile(e.target.files?.[0])}
              style={{ display: "none" }}
              disabled={disabled}
            />
            <button className="btn btn-sm btn-outline" onClick={() => fileInputRef.current?.click()} disabled={disabled}>
              Upload JSON
            </button>
            <button
              className="btn btn-sm btn-outline"
              onClick={() => {
                try {
                  const cleaned = extractJsonArray(jsonText);
                  const parsed = validateTranscriptArray(JSON.parse(cleaned));
                  setJsonText(JSON.stringify(parsed, null, 2));
                  setError(null);
                } catch (e) {
                  setError(e?.message || "Clean JSON failed");
                }
              }}
              disabled={disabled || !jsonText.trim()}
              title="Extract and normalize the JSON array"
            >
              Clean JSON
            </button>
          </div>
        </div>
        <textarea
          value={jsonText}
          onChange={(e) => {
            setJsonText(e.target.value);
            setError(null);
          }}
          placeholder='[\n  { "speaker": 0, "text": "Hello", "start_ts": 0.0, "end_ts": 1.2 }\n]'
          rows={10}
        />
      </div>

      {/* Provider */}
      <div style={{ marginBottom: 18 }}>
        <label style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.8px", textTransform: "uppercase", display: "block", marginBottom: 8 }}>
          AI Provider
        </label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {Object.entries(models).map(([key, val]) => (
            <button
              key={key}
              className={`btn btn-sm ${provider === key ? "btn-gold" : "btn-outline"}`}
              onClick={() => handleProviderChange(key)}
              disabled={disabled}
            >
              {val.name}
            </button>
          ))}
        </div>
      </div>

      {/* Model */}
      <div style={{ marginBottom: 18 }}>
        <label style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.8px", textTransform: "uppercase", display: "block", marginBottom: 8 }}>
          Model
        </label>
        <select value={model} onChange={(e) => setModel(e.target.value)} style={{ width: "100%" }} disabled={disabled}>
          {models[provider]?.models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
              {m.recommended ? " ★" : ""}
            </option>
          ))}
        </select>
      </div>

      {/* Cost estimate (rough) */}
      {est && est.estCost !== null && (
        <div
          style={{
            background: "var(--bg-secondary)",
            borderRadius: 10,
            padding: "14px 16px",
            marginBottom: 18,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <span style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.5px", textTransform: "uppercase" }}>
              Est. Input Tokens
            </span>
            <p style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>
              ~{est.estInputTokens.toLocaleString()}
            </p>
          </div>
          <div style={{ textAlign: "right" }}>
            <span style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.5px", textTransform: "uppercase" }}>
              Est. Cost
            </span>
            <p style={{ fontSize: 15, fontWeight: 700, color: "var(--gold)" }}>
              ~${(est.estCost || 0).toFixed(4)}
            </p>
          </div>
        </div>
      )}

      {/* Prompt */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <label style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.8px", textTransform: "uppercase" }}>
            Prompt
          </label>
          <button className="btn btn-sm btn-outline" onClick={() => setShowPrompt(!showPrompt)} disabled={disabled}>
            {showPrompt ? "Hide" : "Show"} Prompt
          </button>
        </div>
        {showPrompt && (
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={10} disabled={disabled} />
        )}
      </div>

      {/* Error */}
      {error && (
        <div
          style={{
            marginBottom: 16,
            padding: "12px 16px",
            background: "rgba(239,68,68,0.06)",
            border: "1px solid rgba(239,68,68,0.25)",
            borderRadius: 8,
          }}
        >
          <p style={{ color: "var(--error)", fontSize: 13, whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
            {error}
          </p>
        </div>
      )}

      <button
        className="btn btn-gold"
        onClick={handleRun}
        disabled={disabled || !jsonText.trim()}
        style={{ width: "100%", justifyContent: "center" }}
      >
        Generate Cut Sheet (One‑shot)
      </button>
    </div>
  );
}

