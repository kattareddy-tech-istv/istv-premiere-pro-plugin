import { useState } from "react";

const SPEAKER_COLORS = [
  "#d4a944", "#4ade80", "#3b82f6", "#ef4444",
  "#a855f7", "#f97316", "#06b6d4", "#ec4899",
];

function fmtTime(sec) {
  if (!sec && sec !== 0) return "00:00:00";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = (sec % 60).toFixed(2);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${s.padStart(5, "0")}`;
}

export default function TranscriptViewer({ transcript, jobId, onContinue }) {
  const [filter, setFilter] = useState("all");

  if (!transcript) return null;
  const { sentences, speakers, duration, word_count } = transcript;

  const filtered =
    filter === "all"
      ? sentences
      : sentences.filter((s) => s.speaker === parseInt(filter));

  const handleDownload = () => {
    const blob = new Blob([JSON.stringify(transcript, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `transcript_${jobId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="card fade-in">
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h3 style={{ color: "var(--gold)", fontSize: 16, fontWeight: 600 }}>
          04 — Transcript Review
        </h3>
        <span className="tag tag-success">TRANSCRIBED</span>
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 18 }}>
        {[
          { label: "Duration", value: fmtTime(duration) },
          { label: "Sentences", value: sentences.length.toLocaleString() },
          { label: "Words", value: word_count.toLocaleString() },
          { label: "Speakers", value: speakers.length },
        ].map((s) => (
          <div
            key={s.label}
            style={{
              background: "var(--bg-secondary)",
              borderRadius: 8,
              padding: "10px 12px",
              textAlign: "center",
            }}
          >
            <p style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 2, textTransform: "uppercase", letterSpacing: "0.5px" }}>
              {s.label}
            </p>
            <p style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)" }}>
              {s.value}
            </p>
          </div>
        ))}
      </div>

      {/* Speaker Filter */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
        <button
          className={`btn btn-sm ${filter === "all" ? "btn-gold" : "btn-outline"}`}
          onClick={() => setFilter("all")}
        >
          All Speakers
        </button>
        {speakers.map((sp) => (
          <button
            key={sp.id}
            className={`btn btn-sm ${filter === String(sp.id) ? "btn-gold" : "btn-outline"}`}
            onClick={() => setFilter(String(sp.id))}
            style={
              filter !== String(sp.id)
                ? {
                    borderColor: SPEAKER_COLORS[sp.id % SPEAKER_COLORS.length] + "50",
                    color: SPEAKER_COLORS[sp.id % SPEAKER_COLORS.length],
                  }
                : undefined
            }
          >
            {sp.name}
          </button>
        ))}
      </div>

      {/* Transcript Body */}
      <div
        style={{
          maxHeight: 420,
          overflowY: "auto",
          background: "var(--bg-secondary)",
          borderRadius: 10,
          padding: 16,
          marginBottom: 20,
        }}
      >
        {filtered.map((s, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              gap: 12,
              padding: "7px 0",
              borderBottom: "1px solid var(--border-color)",
            }}
          >
            <span
              style={{
                fontSize: 11,
                color: "var(--text-muted)",
                fontFamily: "monospace",
                minWidth: 85,
                flexShrink: 0,
              }}
            >
              {fmtTime(s.start)}
            </span>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: SPEAKER_COLORS[(s.speaker || 0) % SPEAKER_COLORS.length],
                minWidth: 80,
                flexShrink: 0,
              }}
            >
              {s.speaker_name || `Speaker ${s.speaker}`}
            </span>
            <span style={{ fontSize: 13, color: "var(--text-primary)", lineHeight: 1.6 }}>
              {s.text}
            </span>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 12 }}>
        <button className="btn btn-outline" onClick={handleDownload}>
          Download Transcript (JSON)
        </button>
        <button className="btn btn-gold" onClick={onContinue} style={{ marginLeft: "auto" }}>
          Continue to Cut Sheet →
        </button>
      </div>
    </div>
  );
}
