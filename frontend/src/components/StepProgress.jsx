const CUTSHEET_STEPS = [
  { id: "upload", label: "Upload", icon: "\u2191" },
  { id: "compress", label: "Compress", icon: "\u25C6" },
  { id: "transcribe", label: "Transcribe", icon: "\u00B6" },
  { id: "review", label: "Review", icon: "\u25CE" },
  { id: "generate", label: "Cut Sheet", icon: "\u2702" },
  { id: "complete", label: "Done", icon: "\u2713" },
];

const BROLL_STEPS = [
  { id: "upload", label: "Upload", icon: "\u2191" },
  { id: "compress", label: "Compress", icon: "\u25C6" },
  { id: "transcribe", label: "Transcribe", icon: "\u00B6" },
  { id: "review", label: "Review", icon: "\u25CE" },
  { id: "broll_generate", label: "B-Roll", icon: "\u266A" },
  { id: "broll_complete", label: "Done", icon: "\u2713" },
];

export default function StepProgress({ currentStep, completedSteps, onStepClick, pipeline, navigationDisabled }) {
  const STEPS = pipeline === "broll" ? BROLL_STEPS : CUTSHEET_STEPS;
  const clickable = typeof onStepClick === "function" && !navigationDisabled;

  return (
    <div className="pipeline-rail fade-in">
      <div className="pipeline-rail__scroll">
        {STEPS.map((step, i) => {
          const done = completedSteps.includes(step.id);
          const active = step.id === currentStep;
          const showAsActive = active;
          const connectorDone = done && i < STEPS.length - 1;

          return (
            <div key={step.id} className="pipeline-rail__segment">
              <div className="pipeline-rail__nodeCol">
                <button
                  type="button"
                  title={navigationDisabled ? "Wait for the current task to finish" : `Open ${step.label}`}
                  onClick={() => {
                    if (!clickable) return;
                    onStepClick(step.id);
                  }}
                  disabled={!clickable}
                  className={`pipeline-node ${showAsActive ? "pipeline-node--active" : ""} ${done ? "pipeline-node--done" : ""} ${!clickable ? "pipeline-node--locked" : ""}`}
                >
                  <span className="pipeline-node__ring" aria-hidden />
                  <span className="pipeline-node__inner">{done && !active ? "\u2713" : step.icon}</span>
                </button>
                <span
                  className={`pipeline-node__label ${showAsActive ? "pipeline-node__label--active" : ""} ${done ? "pipeline-node__label--done" : ""}`}
                >
                  {step.label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div
                  className={`pipeline-rail__connector ${connectorDone ? "pipeline-rail__connector--done" : ""}`}
                  aria-hidden
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
