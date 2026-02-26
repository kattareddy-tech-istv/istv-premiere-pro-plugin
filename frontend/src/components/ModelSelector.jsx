import { useState, useEffect } from "react";
import { getModels, getPricing, getDefaultPrompt } from "../utils/api";
import { estimateCost } from "../utils/costs";

const GENERATE_MODE = { MULTI_PASS: "multipass", SINGLE_PROMPT: "single" };

export default function ModelSelector({ transcript, onGenerate, disabled }) {
  const [mode, setMode] = useState(GENERATE_MODE.SINGLE_PROMPT);
  const [models, setModels] = useState(null);
  const [pricing, setPricing] = useState(null);
  const [provider, setProvider] = useState("anthropic");
  const [model, setModel] = useState("claude-opus-4-6");
  const [prompt, setPrompt] = useState("");
  const [showPrompt, setShowPrompt] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fallbackModels = {
      anthropic: {
        name: "Anthropic (Claude)",
        models: [
          { id: "claude-opus-4-6", name: "Claude Opus 4.6 (Most Intelligent)", recommended: true },
          { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5 (Balanced)", recommended: false },
          { id: "claude-haiku-4-5", name: "Claude Haiku 4.5 (Fastest)", recommended: false },
        ],
      },
      openai: { name: "OpenAI", models: [{ id: "gpt-4o", name: "GPT-4o", recommended: true }] },
      gemini: { name: "Google (Gemini)", models: [{ id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", recommended: true }] },
    };
    Promise.all([getModels(), getPricing(), getDefaultPrompt()])
      .then(([m, p, d]) => {
        setModels(m);
        setPricing(p);
        setPrompt(d?.prompt ?? "");

        const anthModels = m?.anthropic?.models;
        if (anthModels && anthModels.length > 0) {
          const rec = anthModels.find((mm) => mm.recommended);
          setModel(rec?.id || anthModels[0].id);
        }
      })
      .catch((err) => {
        console.error("ModelSelector init:", err);
        setModels(fallbackModels);
        setPrompt("");
        setProvider("anthropic");
        setModel("claude-opus-4-6");
      });
  }, []);

  const handleProviderChange = (p) => {
    setProvider(p);
    if (models?.[p]?.models) {
      const rec = models[p].models.find((mm) => mm.recommended);
      setModel(rec?.id || models[p].models[0].id);
    }
  };

  const handleGenerate = async () => {
    if (typeof onGenerate !== "function") return;
    setLoading(true);
    try {
      await onGenerate({ provider, model, prompt });
    } finally {
      setLoading(false);
    }
  };

  const wordCount = transcript?.word_count || 0;
  const estInputTokens = Math.round(wordCount * 1.35);
  const est = pricing ? estimateCost(provider, model, estInputTokens, pricing) : null;

  const modelsReady = !!models;

  const passes = [
    { id: 1, title: "Clean & Catalog", desc: "Initial processing and organization of the raw transcript." },
    { id: 2, title: "Select & Sequence", desc: "Select segments and establish order." },
    { id: 3, title: "Write Cut Sheet", desc: "Generate the final cut sheet from selected segments." },
    { id: 4, title: "Finalize", desc: "Review and finalize output." },
  ];

  if (!modelsReady) {
    return (
      <div className="card fade-in">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ color: "var(--gold)", fontSize: 16, fontWeight: 600 }}>
            05 — Generate Cut Sheet
          </h3>
          <span className="tag tag-gold">STEP 5</span>
        </div>
        <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
          <span className="spinner" style={{ marginRight: 8, verticalAlign: "middle" }} />
          Loading models…
        </p>
      </div>
    );
  }

  return (
    <div className="card fade-in">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h3 style={{ color: "var(--gold)", fontSize: 16, fontWeight: 600 }}>
          05 — Generate Cut Sheet
        </h3>
        <span className={`tag ${mode === GENERATE_MODE.MULTI_PASS ? "tag-gold" : ""}`} style={mode === GENERATE_MODE.SINGLE_PROMPT ? { background: "var(--bg-secondary)", color: "var(--text-primary)" } : {}}>
          {mode === GENERATE_MODE.MULTI_PASS ? "MULTI-PASS" : "SINGLE PROMPT"}
        </span>
      </div>

      {/* Mode toggle: Multi-Pass vs Single Prompt */}
      <div
        style={{
          display: "flex",
          gap: 8,
          marginBottom: 20,
          background: "var(--bg-secondary)",
          padding: 6,
          borderRadius: 10,
          border: "1px solid var(--border-color)",
        }}
      >
        <button
          className={`btn btn-sm ${mode === GENERATE_MODE.MULTI_PASS ? "btn-gold" : "btn-outline"}`}
          onClick={() => setMode(GENERATE_MODE.MULTI_PASS)}
          style={{ flex: 1 }}
        >
          Multi-Pass (4 Passes)
        </button>
        <button
          className={`btn btn-sm ${mode === GENERATE_MODE.SINGLE_PROMPT ? "btn-gold" : "btn-outline"}`}
          onClick={() => setMode(GENERATE_MODE.SINGLE_PROMPT)}
          style={{ flex: 1 }}
        >
          Single Prompt
        </button>
      </div>

      {/* Multi-Pass: placeholder passes */}
      {mode === GENERATE_MODE.MULTI_PASS && (
        <div style={{ marginBottom: 20 }}>
          {passes.map((p, i) => (
            <div
              key={p.id}
              style={{
                padding: "14px 16px",
                marginBottom: 10,
                background: "var(--bg-secondary)",
                borderRadius: 10,
                border: "1px solid var(--border-color)",
                opacity: i === 0 ? 1 : 0.7,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                <div>
                  <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>{p.id} Pass {p.id} — {p.title}</span>
                  <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>{p.desc}</p>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn btn-sm btn-outline" disabled style={{ opacity: 0.6 }}>Edit Prompt</button>
                  <button className="btn btn-sm btn-gold" disabled style={{ opacity: 0.6 }}>Run Pass {p.id}</button>
                </div>
              </div>
            </div>
          ))}
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 12 }}>
            Multi-pass workflow will run the raw timestamped transcript through each pass in sequence. Coming soon.
          </p>
        </div>
      )}

      {/* Single Prompt: one prompt over raw timestamped transcript */}
      {mode === GENERATE_MODE.SINGLE_PROMPT && (
        <>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>
            One prompt over the <strong>raw timestamped transcript</strong> from the review step. No multi-pass; one call to generate the cut sheet.
          </p>

          {/* Provider */}
          <div style={{ marginBottom: 18 }}>
            <label style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.8px", textTransform: "uppercase", display: "block", marginBottom: 8 }}>
              AI Provider
            </label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
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
          </div>

          {/* Model */}
          <div style={{ marginBottom: 18 }}>
            <label style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.8px", textTransform: "uppercase", display: "block", marginBottom: 8 }}>
              Model
            </label>
            <select value={model} onChange={(e) => setModel(e.target.value)} style={{ width: "100%" }}>
              {models[provider]?.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.recommended ? " ★" : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Cost Estimate */}
          {est !== null && (
            <div
              style={{
                background: "var(--bg-secondary)",
                borderRadius: 10,
                padding: "14px 16px",
                marginBottom: 18,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <span style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.5px", textTransform: "uppercase" }}>
                  Est. Input Tokens
                </span>
                <p style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>
                  ~{estInputTokens.toLocaleString()}
                </p>
              </div>
              <div style={{ textAlign: "right" }}>
                <span style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.5px", textTransform: "uppercase" }}>
                  Est. Cost
                </span>
                <p style={{ fontSize: 15, fontWeight: 700, color: "var(--gold)" }}>
                  ~${est.toFixed(4)}
                </p>
              </div>
            </div>
          )}

          {/* Prompt */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <label style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.8px", textTransform: "uppercase" }}>
                Single Prompt
              </label>
              <button className="btn btn-sm btn-outline" onClick={() => setShowPrompt(!showPrompt)}>
                {showPrompt ? "Hide" : "Edit"} Prompt
              </button>
            </div>
            {showPrompt && (
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={12}
                style={{ marginTop: 6 }}
              />
            )}
          </div>

          {/* Generate */}
          <button
            type="button"
            className="btn btn-gold"
            onClick={(e) => {
              e.preventDefault();
              handleGenerate();
            }}
            disabled={loading || disabled}
            style={{ width: "100%", justifyContent: "center" }}
          >
            {loading ? (
              <>
                <span className="spinner" /> Generating Cut Sheet...
              </>
            ) : (
              "Generate Cut Sheet (Single Prompt)"
            )}
          </button>
        </>
      )}
    </div>
  );
}
