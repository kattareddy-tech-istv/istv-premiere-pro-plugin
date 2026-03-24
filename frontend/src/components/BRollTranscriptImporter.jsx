import { useState, useRef, useEffect } from "react";
import { importTranscript, getBRollPrompt } from "../utils/api";

/**
 * Parse any text/JSON into transcript format for B-Roll.
 * Handles: JSON, malformed JSON, unclosed brackets, plain text.
 * Output: [{ speaker, text, start_ts, end_ts }, ...]
 */
function parseFlexibleTranscript(raw) {
  const text = String(raw || "").trim();
  if (!text) throw new Error("Empty input");

  // ── Strategy 1: Try strict JSON parse ────────────────────────────────────
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return normalizeToTranscriptFormat(parsed);
    }
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.transcript)) {
      return normalizeToTranscriptFormat(parsed.transcript);
    }
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.sentences)) {
      return normalizeToTranscriptFormat(parsed.sentences);
    }
  } catch (_) {}

  // ── Strategy 2: Try to extract/fix JSON array ────────────────────────────
  const fixed = tryFixAndExtractJson(text);
  if (fixed) return normalizeToTranscriptFormat(fixed);

  // ── Strategy 3: Plain text — split by lines/paragraphs ────────────────────
  return parsePlainText(text);
}

function tryFixAndExtractJson(text) {
  const startIdx = text.indexOf("[");
  if (startIdx === -1) return null;

  let depth = 0;
  let inString = false;
  let escapeNext = false;
  let endIdx = -1;
  let strChar = null;

  for (let i = startIdx; i < text.length; i++) {
    const char = text[i];
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (char === "\\" && inString) {
      escapeNext = true;
      continue;
    }
    if ((char === '"' || char === "'") && !escapeNext) {
      if (!inString) {
        inString = true;
        strChar = char;
      } else if (char === strChar) {
        inString = false;
      }
      continue;
    }
    if (inString) continue;
    if (char === "[") depth++;
    else if (char === "]") {
      depth--;
      if (depth === 0) {
        endIdx = i;
        break;
      }
    }
  }

  let extracted = endIdx >= 0 ? text.substring(startIdx, endIdx + 1) : text.substring(startIdx);

  // Unclosed brackets: add missing ] and }
  if (endIdx === -1) {
    const openB = (extracted.match(/\{/g) || []).length;
    const closeB = (extracted.match(/\}/g) || []).length;
    const openA = (extracted.match(/\[/g) || []).length;
    const closeA = (extracted.match(/\]/g) || []).length;
    extracted += "}".repeat(Math.max(0, openB - closeB));
    extracted += "]".repeat(Math.max(0, openA - closeA));
  }

  // Fix trailing commas
  extracted = extracted.replace(/,(\s*[}\]])/g, "$1");

  try {
    const parsed = JSON.parse(extracted);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch (_) {}

  // Salvage: find "text":"..." patterns (handles malformed JSON, unclosed brackets)
  const items = [];
  const textPattern = /["']?text["']?\s*:\s*["']((?:[^"\\]|\\.)*)["']/g;
  let m;
  while ((m = textPattern.exec(extracted)) !== null) {
    const text = m[1].replace(/\\"/g, '"').trim();
    if (!text) continue;
    const context = extracted.substring(Math.max(0, m.index - 150), m.index + m[0].length + 150);
    const speakerM = context.match(/["']?speaker["']?\s*:\s*(\d+)/);
    const startM = context.match(/["']?start_ts["']?\s*:\s*([\d.]+)/);
    const endM = context.match(/["']?end_ts["']?\s*:\s*([\d.]+)/);
    const i = items.length;
    items.push({
      text,
      speaker: speakerM ? parseInt(speakerM[1], 10) : 0,
      start_ts: startM ? parseFloat(startM[1]) : i * 5,
      end_ts: endM ? parseFloat(endM[1]) : (i + 1) * 5,
    });
  }
  if (items.length > 0) return items;

  return null;
}

function normalizeToTranscriptFormat(arr) {
  return arr.map((item, i) => {
    if (typeof item === "string") {
      return { speaker: 0, text: item.trim(), start_ts: i * 5, end_ts: (i + 1) * 5 };
    }
    const obj = item && typeof item === "object" ? item : {};
    const text = String(obj.text ?? obj.content ?? obj.value ?? obj.dialogue ?? "").trim();
    if (!text) return null;
    return {
      speaker: parseInt(obj.speaker ?? obj.speaker_id ?? 0, 10) || 0,
      text,
      start_ts: parseFloat(obj.start_ts ?? obj.start ?? obj.start_time ?? i * 5) || 0,
      end_ts: parseFloat(obj.end_ts ?? obj.end ?? obj.end_time ?? (i + 1) * 5) || 0,
    };
  }).filter(Boolean);
}

function parsePlainText(text) {
  // Split by double newlines (paragraphs) or single newlines
  const blocks = text.split(/\n\s*\n/).filter((b) => b.trim());
  const segments = [];
  let time = 0;

  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      // Skip timestamps-only lines like [00:01:23] or 00:01:23.000
      const tsOnly = /^[\[\s]*\d{1,2}:\d{2}(:\d{2})?(\.\d+)?[\]\s]*$/;
      if (tsOnly.test(line)) continue;

      // Try to extract timestamp prefix: [00:01:23] or 00:01:23 - text
      const withTs = line.match(/^[\[\s]*(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.(\d+))?[\]\s]*[-–—:]\s*(.+)$/);
      if (withTs) {
        const [, h, m, s = "0", ms = "0"] = withTs;
        const startSec = parseInt(h, 10) * 3600 + parseInt(m, 10) * 60 + parseInt(s, 10) + parseInt(ms, 10) / 1000;
        const content = withTs[5].trim();
        if (content) {
          segments.push({ speaker: 0, text: content, start_ts: startSec, end_ts: startSec + 5 });
          time = startSec + 5;
        }
        continue;
      }

      // Plain line
      if (line.length > 0) {
        segments.push({ speaker: 0, text: line, start_ts: time, end_ts: time + 5 });
        time += 5;
      }
    }
  }

  if (segments.length === 0) {
    // Fallback: every non-empty line
    const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
    return lines.map((line, i) => ({
      speaker: 0,
      text: line,
      start_ts: i * 5,
      end_ts: (i + 1) * 5,
    }));
  }

  return segments;
}

export default function BRollTranscriptImporter({ onImportComplete, disabled, prompt, onPromptChange }) {
  const [inputText, setInputText] = useState("");
  const [error, setError] = useState(null);
  const [importing, setImporting] = useState(false);
  const [parseMode, setParseMode] = useState("auto"); // "auto" | "json" | "text"
  const [promptLoaded, setPromptLoaded] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (typeof onPromptChange === "function" && !promptLoaded) {
      getBRollPrompt()
        .then((r) => {
          if (r?.prompt && typeof onPromptChange === "function") onPromptChange(r.prompt);
        })
        .catch(() => {})
        .finally(() => setPromptLoaded(true));
    }
  }, [onPromptChange, promptLoaded]);

  const handleParse = () => {
    try {
      let parsed;
      if (parseMode === "text") {
        parsed = parsePlainText(inputText);
      } else if (parseMode === "json") {
        const fixed = tryFixAndExtractJson(inputText);
        if (!fixed) throw new Error("Could not extract valid JSON array");
        parsed = normalizeToTranscriptFormat(fixed);
      } else {
        parsed = parseFlexibleTranscript(inputText);
      }
      if (!parsed || parsed.length === 0) throw new Error("No transcript segments found");
      return parsed;
    } catch (err) {
      throw new Error(err.message || "Parse failed");
    }
  };

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    try {
      const text = await file.text();
      setInputText(text);
    } catch (err) {
      setError(`Could not read file: ${err.message}`);
    }
    e.target.value = "";
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    setError(null);
    try {
      const text = await file.text();
      setInputText(text);
    } catch (err) {
      setError(`Could not read file: ${err.message}`);
    }
  };

  const handleImport = async () => {
    if (!inputText.trim()) {
      setError("Please paste or upload transcript content");
      return;
    }
    setImporting(true);
    setError(null);
    try {
      const parsed = handleParse();
      const result = await importTranscript(parsed);
      onImportComplete(result);
    } catch (err) {
      setError(err.message || "Import failed");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="card fade-in">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h3 style={{ color: "var(--gold)", fontSize: 16, fontWeight: 600 }}>
          B-Roll — Import Transcript
        </h3>
        <span className="tag tag-gold">SKIP TO B-ROLL</span>
      </div>

      <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 16, lineHeight: 1.6 }}>
        Paste or upload transcript in <strong>any format</strong>: JSON (valid or with errors), plain text, JSON with unclosed brackets.
        Auto-detects and parses. Accepts .json, .txt, or any text file.
      </p>

      {/* Parse mode */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        {["auto", "json", "text"].map((m) => (
          <button
            key={m}
            className={`btn btn-sm ${parseMode === m ? "btn-gold" : "btn-outline"}`}
            onClick={() => setParseMode(m)}
          >
            {m === "auto" ? "Auto" : m === "json" ? "JSON" : "Plain Text"}
          </button>
        ))}
        <span style={{ fontSize: 11, color: "var(--text-muted)", alignSelf: "center", marginLeft: 8 }}>
          {parseMode === "auto" && "Tries JSON first, then plain text"}
          {parseMode === "json" && "Extract/fix JSON array"}
          {parseMode === "text" && "Split by lines/paragraphs"}
        </span>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json,.txt,text/plain,application/json"
        onChange={handleFileSelect}
        style={{ display: "none" }}
        disabled={importing || disabled}
      />

      <div
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => !importing && !disabled && fileInputRef.current?.click()}
        style={{
          border: "2px dashed var(--border-color)",
          borderRadius: 12,
          padding: 20,
          marginBottom: 16,
          cursor: importing || disabled ? "default" : "pointer",
          minHeight: 240,
        }}
      >
        <textarea
          value={inputText}
          onChange={(e) => {
            setInputText(e.target.value);
            setError(null);
          }}
          placeholder={`Paste JSON, plain text, or malformed transcript here.

Examples:
- JSON array with text, start_ts, end_ts
- Plain lines of dialogue
- JSON with unclosed brackets`}
          disabled={importing || disabled}
          style={{
            width: "100%",
            minHeight: 220,
            background: "var(--bg-secondary)",
            border: "none",
            borderRadius: 8,
            padding: 12,
            color: "var(--text-primary)",
            fontFamily: "monospace",
            fontSize: 12,
            resize: "vertical",
            outline: "none",
          }}
        />
      </div>

      {/* Editable prompt — after transcript, before Import */}
      {typeof onPromptChange === "function" && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 8 }}>
            <label style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.8px", textTransform: "uppercase" }}>
              B-Roll Master Prompt v2 (default)
            </label>
            <button
              className="btn btn-sm btn-outline"
              type="button"
              onClick={() => {
                setError(null);
                getBRollPrompt()
                  .then((r) => {
                    if (r?.prompt) onPromptChange(r.prompt);
                  })
                  .catch(() => setError("Could not load default prompt from server"));
              }}
              disabled={disabled || importing}
            >
              Reset to Default
            </button>
          </div>
          <p style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>
            Edit the prompt below if needed. Use <code style={{ background: "var(--bg-secondary)", padding: "2px 4px", borderRadius: 4 }}>{`{transcript}`}</code> where the transcript will be inserted.
          </p>
          <textarea
            value={prompt ?? ""}
            onChange={(e) => onPromptChange(e.target.value)}
            rows={10}
            placeholder="Loading default prompt..."
            disabled={disabled || importing}
            style={{
              width: "100%",
              background: "var(--bg-secondary)",
              border: "1px solid var(--border-color)",
              borderRadius: 8,
              padding: 12,
              color: "var(--text-primary)",
              fontFamily: "monospace",
              fontSize: 12,
              resize: "vertical",
              outline: "none",
            }}
          />
        </div>
      )}

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
          <p style={{ color: "var(--error)", fontSize: 13, whiteSpace: "pre-wrap" }}>{error}</p>
        </div>
      )}

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <button
          className="btn btn-outline"
          onClick={() => fileInputRef.current?.click()}
          disabled={importing || disabled}
        >
          Upload File (.json or .txt)
        </button>
        <button
          className="btn btn-gold"
          onClick={handleImport}
          disabled={!inputText.trim() || importing || disabled}
          style={{ marginLeft: "auto" }}
        >
          {importing ? <><span className="spinner" /> Importing...</> : "Import & Continue"}
        </button>
      </div>
    </div>
  );
}
