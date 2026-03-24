import { getPipelineShortName, getPipelineStepLabel } from "../utils/pipelineLabels";

export default function PipelineStageBadge({ pipeline, step, status, processing, topOffset = 12 }) {
  if (!pipeline) return null;

  const label = getPipelineStepLabel(pipeline, step);
  const short = getPipelineShortName(pipeline);
  const sub = processing && status ? (status.length > 72 ? `${status.slice(0, 70)}…` : status) : null;

  return (
    <div
      style={{
        position: "fixed",
        top: topOffset,
        right: 16,
        zIndex: 9000,
        maxWidth: 240,
        padding: "12px 16px",
        background: "#000000",
        border: "1px solid rgba(255,215,0,0.28)",
        borderRadius: 12,
        boxShadow: "0 12px 40px rgba(0,0,0,0.65)",
      }}
    >
      <p
        style={{
          fontSize: 9,
          color: "var(--text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.14em",
          marginBottom: 6,
          fontFamily: "var(--font-pipeline)",
          fontWeight: 600,
        }}
      >
        {short} pipeline
      </p>
      <p style={{ fontSize: 13, fontWeight: 700, color: "var(--gold-bright)", lineHeight: 1.3, fontFamily: "var(--font-ui)" }}>
        {label}
      </p>
      {sub && (
        <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6, lineHeight: 1.4 }}>
          {sub}
        </p>
      )}
    </div>
  );
}
