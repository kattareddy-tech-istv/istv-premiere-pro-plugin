import { useState, useEffect } from "react";
import { getModels, getBRollPrompt } from "../utils/api";

export default function BRollModelSelector({
  onGenerate,
  disabled,
  showGenerate = true,
  value,
  onChange,
  showPrompt = true,
  prompt: promptProp,
  onPromptChange,
}) {
  const [models, setModels] = useState(null);
  const [provider, setProvider] = useState(value?.provider || "anthropic");
  const [model, setModel] = useState(value?.model || "claude-opus-4-6");
  const [localPrompt, setLocalPrompt] = useState("");
  const [promptLoaded, setPromptLoaded] = useState(false);
  const [loading, setLoading] = useState(true);

  const prompt = promptProp ?? localPrompt;
  const setPrompt = typeof onPromptChange === "function" ? onPromptChange : setLocalPrompt;

  useEffect(() => {
    getModels()
      .then((m) => { if (m) setModels(m); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (showPrompt && !promptLoaded && !prompt) {
      getBRollPrompt()
        .then((r) => {
          if (r?.prompt) setPrompt(r.prompt);
        })
        .catch(() => {})
        .finally(() => setPromptLoaded(true));
    }
  }, [showPrompt, promptLoaded, prompt]);

  const handleProviderChange = (newProvider) => {
    setProvider(newProvider);
    const providerModels = models?.[newProvider]?.models;
    if (providerModels?.length) {
      const rec = providerModels.find((m) => m.recommended);
      setModel(rec?.id || providerModels[0].id);
    }
  };

  useEffect(() => {
    if (typeof onChange === "function") onChange({ provider, model });
  }, [provider, model]);

  if (loading) {
    return (
      <div className="card fade-in" style={{ textAlign: "center", padding: 30 }}>
        <span className="spinner" /> Loading models...
      </div>
    );
  }

  return (
    <div className="card fade-in">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h3 style={{ color: "var(--gold)", fontSize: 16, fontWeight: 600 }}>
          B-Roll AI Model
        </h3>
        <span className="tag tag-gold">SELECT MODEL</span>
      </div>

      <p style={{ color: "var(--text-muted)", fontSize: 12, marginBottom: 16, lineHeight: 1.6 }}>
        Choose the AI model. The B-Roll Cut Sheet Master Prompt v2 will produce a detailed cut sheet with Section 1 (chronological blocks), Section 2 (stock + AI search list), and Section 3 (client B-roll requests).
      </p>

      {/* Provider tabs */}
      {models && (
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          {Object.entries(models).map(([key, val]) => (
            <button
              key={key}
              className={`btn btn-sm ${provider === key ? "btn-gold" : "btn-outline"}`}
              onClick={() => handleProviderChange(key)}
            >
              {val.name}
            </button>
          ))}
        </div>
      )}

      {/* Model select */}
      {models?.[provider] && (
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          style={{ width: "100%", marginBottom: 16 }}
        >
          {models[provider].models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} {m.recommended ? "(Recommended)" : ""}
            </option>
          ))}
        </select>
      )}

      {showPrompt && (
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.8px", textTransform: "uppercase", display: "block", marginBottom: 8 }}>
            B-Roll Master Prompt v2 (editable)
          </label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={8}
            placeholder="Loading default prompt..."
            disabled={disabled}
            style={{
              width: "100%",
              background: "var(--bg-secondary)",
              border: "1px solid var(--border-color)",
              borderRadius: 8,
              padding: 12,
              color: "var(--text-primary)",
              fontFamily: "monospace",
              fontSize: 12,
              resize: "vertical",
              outline: "none",
            }}
          />
        </div>
      )}

      {showGenerate && (
        <button
          className="btn btn-gold"
          onClick={() => onGenerate?.({ provider, model })}
          disabled={disabled}
          style={{ width: "100%", justifyContent: "center" }}
        >
          {disabled ? (
            <>
              <span className="spinner" /> Generating B-Roll Suggestions...
            </>
          ) : (
            "Generate B-Roll Suggestions"
          )}
        </button>
      )}
    </div>
  );
}
