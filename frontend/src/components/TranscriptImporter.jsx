import { useState, useRef } from "react";
import { importTranscript } from "../utils/api";

export default function TranscriptImporter({ onImportComplete, disabled }) {
  const [jsonText, setJsonText] = useState("");
  const [error, setError] = useState(null);
  const [importing, setImporting] = useState(false);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);

  const validateArrayStructure = (parsed) => {
    if (!Array.isArray(parsed)) {
      throw new Error("Transcript must be an array of objects");
    }
    if (parsed.length === 0) {
      throw new Error("Transcript array cannot be empty");
    }
    
    // Validate structure
    for (let i = 0; i < parsed.length; i++) {
      const item = parsed[i];
      if (typeof item !== "object" || item === null) {
        throw new Error(`Item at index ${i} must be an object`);
      }
      if (!("text" in item)) {
        throw new Error(`Item at index ${i} must have a 'text' field`);
      }
    }
    return parsed;
  };

  const extractJsonArray = (text) => {
    // Remove leading/trailing whitespace
    text = text.trim();
    
    // Find the first '[' and try to match it with the closing ']'
    const startIdx = text.indexOf('[');
    if (startIdx === -1) {
      throw new Error("No JSON array found. Expected an array starting with '['");
    }
    
    // Try to find the matching closing bracket by tracking bracket depth
    let depth = 0;
    let inString = false;
    let escapeNext = false;
    let endIdx = -1;
    
    for (let i = startIdx; i < text.length; i++) {
      const char = text[i];
      
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      
      if (char === '\\') {
        escapeNext = true;
        continue;
      }
      
      if (char === '"') {
        inString = !inString;
        continue;
      }
      
      if (inString) continue;
      
      if (char === '[') {
        depth++;
      } else if (char === ']') {
        depth--;
        if (depth === 0) {
          endIdx = i;
          break;
        }
      }
    }
    
    if (endIdx === -1) {
      throw new Error("Unclosed JSON array. Missing closing ']'");
    }
    
    // Extract just the array portion
    const jsonArray = text.substring(startIdx, endIdx + 1);
    
    // Validate it parses correctly
    try {
      JSON.parse(jsonArray);
    } catch (err) {
      throw new Error(`Extracted JSON array is still invalid: ${err.message}`);
    }
    
    return jsonArray;
  };

  const findJsonArrays = (text) => {
    const arrays = [];
    let startIdx = 0;
    
    while (true) {
      const idx = text.indexOf('[', startIdx);
      if (idx === -1) break;
      
      try {
        const extracted = extractJsonArray(text.substring(idx));
        arrays.push(extracted);
        startIdx = idx + extracted.length;
      } catch {
        startIdx = idx + 1;
      }
    }
    
    return arrays;
  };

  const validateJson = (text) => {
    const originalText = text;
    let lastError = null;
    
    // Strategy 1: Try parsing as-is
    try {
      const parsed = JSON.parse(text.trim());
      if (Array.isArray(parsed)) {
        return validateArrayStructure(parsed);
      }
      throw new Error("JSON is not an array");
    } catch (err) {
      lastError = err;
    }
    
    // Strategy 2: Try extracting the array
    try {
      const extracted = extractJsonArray(originalText);
      const parsed = JSON.parse(extracted);
      if (Array.isArray(parsed)) {
        return validateArrayStructure(parsed);
      }
      throw new Error("Extracted JSON is not an array");
    } catch (err) {
      lastError = err;
    }
    
    // Strategy 3: Try to find and extract multiple potential arrays
    try {
      const arrays = findJsonArrays(originalText);
      if (arrays.length === 0) {
        throw new Error("No valid JSON arrays found");
      }
      // Use the largest array
      const largest = arrays.reduce((a, b) => (b.length > a.length ? b : a));
      const parsed = JSON.parse(largest);
      return validateArrayStructure(parsed);
    } catch (err) {
      lastError = err;
    }
    
    // Strategy 4: Try removing common issues (trailing commas, comments, etc.)
    try {
      let cleaned = originalText.trim();
      // Remove trailing commas before closing brackets/braces
      cleaned = cleaned.replace(/,(\s*[}\]])/g, '$1');
      // Remove single-line comments (not standard JSON but sometimes present)
      cleaned = cleaned.replace(/\/\/.*$/gm, '');
      // Remove multi-line comments
      cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, '');
      
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) {
        return validateArrayStructure(parsed);
      }
    } catch (err) {
      // Ignore, use lastError
    }
    
    // If all strategies fail, provide detailed error
    const errorMsg = lastError?.message || "Unknown JSON parsing error";
    const positionMatch = errorMsg.match(/position (\d+)/);
    
    if (positionMatch) {
      const pos = parseInt(positionMatch[1]);
      const lines = originalText.split('\n');
      let charCount = 0;
      let lineNum = 1;
      let colNum = 1;
      
      for (let i = 0; i < lines.length; i++) {
        const lineLength = lines[i].length + 1; // +1 for newline
        if (charCount + lineLength > pos) {
          lineNum = i + 1;
          colNum = pos - charCount + 1;
          break;
        }
        charCount += lineLength;
      }
      
      throw new Error(
        `JSON parse error at line ${lineNum}, column ${colNum}.\n` +
        `Error: ${errorMsg}\n\n` +
        `Tip: Try clicking "Clean JSON" to extract just the array portion, or check for:\n` +
        `- Extra content after the closing bracket\n` +
        `- Trailing commas\n` +
        `- Comments or invalid characters`
      );
    }
    
    throw new Error(`Invalid JSON: ${errorMsg}`);
  };


  const handlePaste = (e) => {
    const text = e.clipboardData.getData("text");
    if (text.trim().startsWith("[")) {
      setJsonText(text);
      setError(null);
    }
  };

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".json")) {
      setError("Please select a JSON file");
      return;
    }

    try {
      const text = await file.text();
      const parsed = validateJson(text);
      setJsonText(JSON.stringify(parsed, null, 2));
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".json")) {
      setError("Please drop a JSON file");
      return;
    }

    try {
      const text = await file.text();
      const parsed = validateJson(text);
      setJsonText(JSON.stringify(parsed, null, 2));
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleImport = async () => {
    if (!jsonText.trim()) {
      setError("Please paste or upload a transcript JSON");
      return;
    }

    setImporting(true);
    setError(null);

    try {
      const parsed = validateJson(jsonText);
      console.log("Parsed transcript:", { itemCount: parsed.length, firstItem: parsed[0] });
      const result = await importTranscript(parsed);
      console.log("Import successful:", result);
      onImportComplete(result);
    } catch (err) {
      // Provide detailed error message
      let errorMsg = "Import failed";
      
      if (err.message) {
        errorMsg = err.message;
      } else if (err.response) {
        // Handle API error response
        try {
          const errorData = await err.response.json();
          errorMsg = errorData.detail || errorData.message || "Import failed";
        } catch {
          errorMsg = `Server error: ${err.response.status} ${err.response.statusText}`;
        }
      } else if (err.name === "TypeError" && err.message.includes("fetch")) {
        errorMsg = "Network error: Could not connect to server. Make sure the backend is running.";
      }
      
      setError(errorMsg);
      console.error("Import error:", err);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="card fade-in">
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h3 style={{ color: "var(--gold)", fontSize: 16, fontWeight: 600 }}>
          01 — Import Transcript
        </h3>
        <span className="tag tag-gold">SKIP TO REVIEW</span>
      </div>

      {/* Instructions */}
      <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 16, lineHeight: 1.6 }}>
        Paste your transcript JSON below or drag & drop a JSON file. Use the same format: an array of objects with{" "}
        <code style={{ background: "var(--bg-secondary)", padding: "2px 6px", borderRadius: 4, fontSize: 12 }}>speaker</code>
        , <code style={{ background: "var(--bg-secondary)", padding: "2px 6px", borderRadius: 4, fontSize: 12 }}>text</code>
        , <code style={{ background: "var(--bg-secondary)", padding: "2px 6px", borderRadius: 4, fontSize: 12 }}>start_ts</code>
        , and <code style={{ background: "var(--bg-secondary)", padding: "2px 6px", borderRadius: 4, fontSize: 12 }}>end_ts</code>.
        Large transcripts (thousands of segments) are supported; for very large files, use <strong>Upload JSON File</strong>.
      </p>

      {/* File input (hidden) */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        onChange={handleFileSelect}
        style={{ display: "none" }}
        disabled={importing || disabled}
      />

      {/* Drop zone / Text area */}
      <div
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => !importing && !disabled && fileInputRef.current?.click()}
        style={{
          border: "2px dashed var(--border-color)",
          borderRadius: 12,
          padding: "20px",
          marginBottom: 16,
          cursor: importing || disabled ? "default" : "pointer",
          transition: "border-color 0.2s",
          minHeight: 280,
        }}
        onMouseEnter={(e) => {
          if (!importing && !disabled) e.currentTarget.style.borderColor = "var(--gold)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = "var(--border-color)";
        }}
      >
        <textarea
          ref={textareaRef}
          value={jsonText}
          onChange={(e) => {
            setJsonText(e.target.value);
            setError(null);
          }}
          onPaste={handlePaste}
          placeholder='Paste JSON here or click to upload file...\n\nExample:\n[\n  {\n    "speaker": 0,\n    "text": "Hello world",\n    "start_ts": 0.0,\n    "end_ts": 1.5\n  }\n]'
          disabled={importing || disabled}
          style={{
            width: "100%",
            minHeight: 260,
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

      {/* Actions */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <button
          className="btn btn-outline"
          onClick={() => fileInputRef.current?.click()}
          disabled={importing || disabled}
        >
          Upload JSON File
        </button>
        <button
          className="btn btn-outline"
          onClick={() => {
            try {
              let cleaned;
              try {
                cleaned = extractJsonArray(jsonText);
              } catch {
                // Try finding all arrays and using the largest
                const arrays = findJsonArrays(jsonText);
                if (arrays.length > 0) {
                  cleaned = arrays.reduce((a, b) => (b.length > a.length ? b : a));
                } else {
                  throw new Error("Could not find a valid JSON array");
                }
              }
              // Pretty print it
              const parsed = JSON.parse(cleaned);
              setJsonText(JSON.stringify(parsed, null, 2));
              setError(null);
            } catch (err) {
              setError(`Could not extract JSON array: ${err.message}`);
            }
          }}
          disabled={!jsonText.trim() || importing || disabled}
          title="Try to extract and clean the JSON array from the text"
        >
          Clean JSON
        </button>
        <button
          className="btn btn-gold"
          onClick={handleImport}
          disabled={!jsonText.trim() || importing || disabled}
          style={{ marginLeft: "auto" }}
        >
          {importing ? (
            <>
              <span className="spinner" /> Importing...
            </>
          ) : (
            "Import & Continue to Review"
          )}
        </button>
      </div>
    </div>
  );
}
