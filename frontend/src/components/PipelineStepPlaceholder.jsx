export default function PipelineStepPlaceholder({ title, body, actionLabel, onAction }) {
  return (
    <div className="card fade-in" style={{ marginBottom: 16, textAlign: "center", padding: "28px 22px" }}>
      <p style={{ color: "var(--text-primary)", fontWeight: 600, marginBottom: 10, fontSize: 15 }}>{title}</p>
      <p
        style={{
          color: "var(--text-muted)",
          fontSize: 14,
          lineHeight: 1.6,
          marginBottom: 20,
          maxWidth: 420,
          marginLeft: "auto",
          marginRight: "auto",
        }}
      >
        {body}
      </p>
      {onAction && actionLabel && (
        <button type="button" className="btn btn-outline" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}
