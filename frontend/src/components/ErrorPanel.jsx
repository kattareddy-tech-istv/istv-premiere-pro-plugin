import { useState } from "react";
import { parseApiError } from "../utils/errorMessages";

export default function ErrorPanel({ error, onDismiss }) {
  const [open, setOpen] = useState(false);
  if (!error) return null;

  const { title, message, hint, raw } = parseApiError(error);

  return (
    <div
      className="fade-in"
      style={{
        marginBottom: 20,
        padding: "16px 18px",
        background: "rgba(239,68,68,0.08)",
        border: "1px solid rgba(239,68,68,0.35)",
        borderRadius: 12,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <p
            style={{
              color: "#fca5a5",
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: 6,
            }}
          >
            {title}
          </p>
          <p style={{ color: "var(--error)", fontSize: 14, fontWeight: 600, lineHeight: 1.5, marginBottom: 10 }}>
            {message}
          </p>
          <p style={{ color: "var(--text-muted)", fontSize: 12, lineHeight: 1.55 }}>{hint}</p>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="btn btn-sm btn-outline"
            style={{ marginTop: 12, fontSize: 11 }}
          >
            {open ? "Hide technical details" : "Show technical details"}
          </button>
          {open && (
            <pre
              style={{
                marginTop: 10,
                padding: 12,
                background: "var(--bg-secondary)",
                borderRadius: 8,
                fontSize: 11,
                color: "var(--text-muted)",
                overflow: "auto",
                maxHeight: 160,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {raw}
            </pre>
          )}
        </div>
        {typeof onDismiss === "function" && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss error"
            style={{
              background: "transparent",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 18,
              lineHeight: 1,
              padding: 4,
            }}
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}
