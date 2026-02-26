export default function CostTracker({ costs }) {
  if (!costs || costs.length === 0) return null;

  const totalCost = costs.reduce((s, c) => s + (c.cost_usd || 0), 0);
  const totalIn = costs.reduce((s, c) => s + (c.input_tokens || 0), 0);
  const totalOut = costs.reduce((s, c) => s + (c.output_tokens || 0), 0);

  return (
    <div className="card fade-in" style={{ marginTop: 20 }}>
      <h4 style={{ color: "var(--gold)", fontSize: 14, fontWeight: 600, marginBottom: 14 }}>
        Token & Cost Tracker
      </h4>

      <div style={{ display: "flex", gap: 24, marginBottom: 14 }}>
        <div>
          <span style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
            Input Tokens
          </span>
          <p style={{ fontSize: 17, fontWeight: 700 }}>{totalIn.toLocaleString()}</p>
        </div>
        <div>
          <span style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
            Output Tokens
          </span>
          <p style={{ fontSize: 17, fontWeight: 700 }}>{totalOut.toLocaleString()}</p>
        </div>
        <div style={{ marginLeft: "auto", textAlign: "right" }}>
          <span style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
            Total Cost
          </span>
          <p style={{ fontSize: 20, fontWeight: 800, color: "var(--gold)" }}>
            ${totalCost.toFixed(4)}
          </p>
        </div>
      </div>

      {/* Line items */}
      <div style={{ borderTop: "1px solid var(--border-color)", paddingTop: 10 }}>
        {costs.map((c, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "5px 0",
              fontSize: 12,
              color: "var(--text-secondary)",
            }}
          >
            <span>{c.label || `${c.provider} / ${c.model}`}</span>
            <span style={{ fontWeight: 600, color: "var(--gold)" }}>
              ${(c.cost_usd || 0).toFixed(4)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
