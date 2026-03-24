export default function PipelineSelector({ onSelect }) {
  const cardBase = {
    padding: 32,
    textAlign: "center",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 12,
    border: "2px solid var(--border-color)",
    borderRadius: 14,
    background: "#000000",
    cursor: "pointer",
    transition: "all 0.25s ease",
    fontFamily: "inherit",
    color: "inherit",
  };

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 20,
        marginTop: 24,
      }}
    >
      <button
        type="button"
        className="pipeline-select-card"
        onClick={() => onSelect("cutsheet")}
        style={cardBase}
        onMouseEnter={(e) => {
          e.currentTarget.style.border = "2px solid rgba(255, 255, 255, 0.35)";
          e.currentTarget.style.background = "rgba(255, 255, 255, 0.04)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.border = "2px solid var(--border-color)";
          e.currentTarget.style.background = "#000000";
        }}
      >
        <h3
          className="pipeline-choice-title"
          style={{
            color: "var(--text-primary)",
            fontSize: 24,
            margin: 0,
            letterSpacing: "0.04em",
          }}
        >
          Editor cut sheet
        </h3>
        <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, margin: 0 }}>
          Upload audio → Transcribe → AI generates full documentary cut sheet with IPs, VO, tone tags, and B-roll notes.
        </p>
      </button>

      <button
        type="button"
        className="pipeline-select-card"
        onClick={() => onSelect("broll")}
        style={cardBase}
        onMouseEnter={(e) => {
          e.currentTarget.style.border = "2px solid rgba(255, 255, 255, 0.35)";
          e.currentTarget.style.background = "rgba(255, 255, 255, 0.04)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.border = "2px solid var(--border-color)";
          e.currentTarget.style.background = "#000000";
        }}
      >
        <h3
          className="pipeline-choice-title"
          style={{
            color: "var(--text-primary)",
            fontSize: 24,
            margin: 0,
            letterSpacing: "0.04em",
          }}
        >
          B-roll suggestion
        </h3>
        <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, margin: 0 }}>
          Post-edit audio → Rev.ai transcript → B-Roll Cut Sheet Master Prompt → Detailed B-roll placements, stock/AI/client lists.
        </p>
      </button>
    </div>
  );
}
