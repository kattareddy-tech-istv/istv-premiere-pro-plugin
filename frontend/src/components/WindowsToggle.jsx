/**
 * Windows Settings–style enable/disable switch (pill track + sliding thumb).
 */
export default function WindowsToggle({
  checked,
  onChange,
  disabled = false,
  id,
  "aria-label": ariaLabel,
}) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`win-toggle ${checked ? "win-toggle--on" : ""}`}
    >
      <span className="win-toggle__track" aria-hidden />
      <span className="win-toggle__thumb" aria-hidden />
    </button>
  );
}
