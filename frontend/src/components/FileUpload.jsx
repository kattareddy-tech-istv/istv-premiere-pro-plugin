import { useState, useRef } from "react";
import { uploadFile } from "../utils/api";

const MAX_SIZE = 2 * 1024 * 1024 * 1024; // 2 GB

export default function FileUpload({ onUploadComplete, disabled }) {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  const validate = (f) => {
    if (f.size > MAX_SIZE) {
      setError(`File too large (${(f.size / 1024 ** 3).toFixed(2)} GB). Max: 2 GB.`);
      return false;
    }
    setError(null);
    return true;
  };

  const handleSelect = (e) => {
    const f = e.target.files?.[0];
    if (f && validate(f)) setFile(f);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f && validate(f)) setFile(f);
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const result = await uploadFile(file, (p) => setProgress(p));
      onUploadComplete(result);
    } catch (err) {
      setError(err.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const fmtSize = (b) =>
    b >= 1024 ** 3
      ? `${(b / 1024 ** 3).toFixed(2)} GB`
      : `${(b / 1024 ** 2).toFixed(1)} MB`;

  return (
    <div className="card fade-in">
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h3 style={{ color: "var(--gold)", fontSize: 16, fontWeight: 600 }}>
          01 — Upload Audio
        </h3>
        <span className="tag tag-gold">STEP 1</span>
      </div>

      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => !uploading && inputRef.current?.click()}
        style={{
          border: "2px dashed var(--border-color)",
          borderRadius: 12,
          padding: "44px 20px",
          textAlign: "center",
          cursor: uploading ? "default" : "pointer",
          transition: "border-color 0.2s",
          marginBottom: 20,
        }}
        onMouseEnter={(e) => {
          if (!uploading) e.currentTarget.style.borderColor = "var(--gold)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = "var(--border-color)";
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept="audio/*,.wav,.mp3,.flac,.aac,.ogg,.m4a,.wma,.aiff"
          onChange={handleSelect}
          style={{ display: "none" }}
          disabled={uploading}
        />
        {file ? (
          <>
            <p style={{ color: "var(--text-primary)", fontWeight: 600, marginBottom: 4 }}>
              {file.name}
            </p>
            <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
              {fmtSize(file.size)}
            </p>
          </>
        ) : (
          <>
            <p style={{ color: "var(--text-secondary)", marginBottom: 6, fontSize: 14 }}>
              Drop audio file here or click to browse
            </p>
            <p style={{ color: "var(--text-muted)", fontSize: 12 }}>
              WAV · MP3 · FLAC · AAC · OGG · M4A — up to 2 GB
            </p>
          </>
        )}
      </div>

      {/* Progress */}
      {uploading && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              Uploading...
            </span>
            <span style={{ fontSize: 12, color: "var(--gold)", fontWeight: 600 }}>
              {Math.round(progress)}%
            </span>
          </div>
          <div className="progress-bar">
            <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <p style={{ color: "var(--error)", fontSize: 13, marginBottom: 14 }}>{error}</p>
      )}

      {/* Submit */}
      <button
        className="btn btn-gold"
        onClick={handleUpload}
        disabled={!file || uploading || disabled}
        style={{ width: "100%", justifyContent: "center" }}
      >
        {uploading ? (
          <>
            <span className="spinner" /> Uploading...
          </>
        ) : (
          "Upload & Continue"
        )}
      </button>
    </div>
  );
}
