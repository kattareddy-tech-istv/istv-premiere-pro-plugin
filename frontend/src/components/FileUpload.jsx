import { useState, useRef } from "react";
import { uploadFile, uploadPremiereXML } from "../utils/api";

const MAX_SIZE = 10 * 1024 * 1024 * 1024; // 10 GB

export default function FileUpload({ onUploadComplete, disabled, onPremiereXml }) {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  const [xmlFile, setXmlFile] = useState(null);
  const [xmlUploading, setXmlUploading] = useState(false);
  const [xmlResult, setXmlResult] = useState(null);
  const [xmlError, setXmlError] = useState(null);
  const xmlInputRef = useRef(null);

  const validate = (f) => {
    if (f.size > MAX_SIZE) {
      setError(`File too large (${(f.size / 1024 ** 3).toFixed(2)} GB). Max: 10 GB.`);
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

  const handleXmlSelect = (e) => {
    const f = e.target.files?.[0];
    if (f) {
      if (!f.name.toLowerCase().endsWith(".xml")) {
        setXmlError("Please select an XML file");
        return;
      }
      setXmlFile(f);
      setXmlError(null);
      handleXmlUpload(f);
    }
  };

  const handleXmlDrop = (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) {
      if (!f.name.toLowerCase().endsWith(".xml")) {
        setXmlError("Please drop an XML file");
        return;
      }
      setXmlFile(f);
      setXmlError(null);
      handleXmlUpload(f);
    }
  };

  const handleXmlUpload = async (xmlFileToUpload) => {
    setXmlUploading(true);
    setXmlError(null);
    try {
      const result = await uploadPremiereXML(xmlFileToUpload);
      setXmlResult(result);
      if (onPremiereXml) onPremiereXml(result);
    } catch (err) {
      setXmlError(err.message || "XML upload failed");
      setXmlResult(null);
      if (onPremiereXml) onPremiereXml(null);
    } finally {
      setXmlUploading(false);
    }
  };

  const handleRemoveXml = () => {
    setXmlFile(null);
    setXmlResult(null);
    setXmlError(null);
    if (onPremiereXml) onPremiereXml(null);
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

      {/* Audio drop zone */}
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
          marginBottom: 16,
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
              WAV · MP3 · FLAC · AAC · OGG · M4A — up to 10 GB
            </p>
          </>
        )}
      </div>

      {/* ── Premiere XML drop zone (optional) ───────────────────────────── */}
      {onPremiereXml && (
        <div style={{ marginBottom: 16 }}>
          <p style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>
            Premiere Pro XML (optional — for auto-linked timeline export)
          </p>

          {!xmlResult ? (
            <div
              onDrop={handleXmlDrop}
              onDragOver={(e) => e.preventDefault()}
              onClick={() => !xmlUploading && xmlInputRef.current?.click()}
              style={{
                border: "1px dashed var(--border-color)",
                borderRadius: 8,
                padding: "18px 16px",
                textAlign: "center",
                cursor: xmlUploading ? "default" : "pointer",
                transition: "border-color 0.2s",
                background: "var(--bg-secondary)",
              }}
              onMouseEnter={(e) => {
                if (!xmlUploading) e.currentTarget.style.borderColor = "var(--gold)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "var(--border-color)";
              }}
            >
              <input
                ref={xmlInputRef}
                type="file"
                accept=".xml"
                onChange={handleXmlSelect}
                style={{ display: "none" }}
                disabled={xmlUploading}
              />
              {xmlUploading ? (
                <p style={{ color: "var(--gold)", fontSize: 13 }}>
                  <span className="spinner" style={{ marginRight: 8, verticalAlign: "middle" }} />
                  Parsing XML...
                </p>
              ) : xmlFile ? (
                <p style={{ color: "var(--text-primary)", fontSize: 13 }}>{xmlFile.name}</p>
              ) : (
                <p style={{ color: "var(--text-muted)", fontSize: 12 }}>
                  Drop your synced master timeline XML here or click to browse
                </p>
              )}
            </div>
          ) : (
            <div
              style={{
                border: "1px solid rgba(212,175,55,0.3)",
                borderRadius: 8,
                padding: "14px 16px",
                background: "rgba(212,175,55,0.04)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                <div>
                  <p style={{ fontSize: 13, fontWeight: 600, color: "var(--gold)", marginBottom: 2 }}>
                    {xmlResult.sequence_name}
                  </p>
                  <p style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    {xmlResult.filename} — {xmlResult.timebase} fps, {xmlResult.width}x{xmlResult.height}
                  </p>
                </div>
                <button
                  onClick={handleRemoveXml}
                  style={{
                    background: "none",
                    border: "1px solid var(--border-color)",
                    borderRadius: 4,
                    color: "var(--text-muted)",
                    cursor: "pointer",
                    fontSize: 11,
                    padding: "2px 8px",
                  }}
                >
                  Remove
                </button>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {xmlResult.tracks.map((t, i) => (
                  <div
                    key={i}
                    style={{
                      background: "var(--bg-secondary)",
                      borderRadius: 6,
                      padding: "6px 10px",
                      fontSize: 11,
                    }}
                  >
                    <span style={{ color: "var(--gold)", fontWeight: 600 }}>{t.label}</span>
                    <span style={{ color: "var(--text-muted)", marginLeft: 6 }}>{t.file_name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {xmlError && (
            <p style={{ color: "var(--error)", fontSize: 12, marginTop: 6 }}>{xmlError}</p>
          )}
        </div>
      )}

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
