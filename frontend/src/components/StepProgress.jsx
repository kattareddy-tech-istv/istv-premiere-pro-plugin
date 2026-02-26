const STEPS = [
  { id: "upload", label: "Upload", icon: "↑" },
  { id: "compress", label: "Compress", icon: "◆" },
  { id: "transcribe", label: "Transcribe", icon: "¶" },
  { id: "review", label: "Review", icon: "◎" },
  { id: "generate", label: "Cut Sheet", icon: "✂" },
  { id: "complete", label: "Done", icon: "✓" },
];

export default function StepProgress({ currentStep, completedSteps, onStepClick }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px 0 24px",
      }}
    >
      {STEPS.map((step, i) => {
        const done = completedSteps.includes(step.id);
        const active = step.id === currentStep;
        const clickable = typeof onStepClick === "function";

        return (
          <div key={step.id} style={{ display: "flex", alignItems: "center" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
              <button
                type="button"
                onClick={clickable ? () => onStepClick(step.id) : undefined}
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 13,
                  fontWeight: 700,
                  border: `2px solid ${
                    done ? "var(--success)" : active ? "var(--gold)" : "var(--border-color)"
                  }`,
                  background: done
                    ? "var(--success)"
                    : active
                    ? "var(--gold-glow-soft)"
                    : "transparent",
                  color: done
                    ? "#0a0a0a"
                    : active
                    ? "var(--gold)"
                    : "var(--text-muted)",
                  transition: "all 0.35s ease",
                  cursor: clickable ? "pointer" : "default",
                  outline: "none",
                }}
              >
                {done ? "✓" : step.icon}
              </button>
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 600,
                  color: active ? "var(--gold)" : done ? "var(--success)" : "var(--text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.6px",
                }}
              >
                {step.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                style={{
                  width: 32,
                  height: 2,
                  background: done ? "var(--success)" : "var(--border-color)",
                  margin: "0 6px",
                  marginBottom: 18,
                  transition: "background 0.35s ease",
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

