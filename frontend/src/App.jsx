import { useState } from "react";
import FloatingCanvas from "./components/FloatingCanvas";
import FileUpload from "./components/FileUpload";
import OneShotCutSheet from "./components/OneShotCutSheet";
import StepProgress from "./components/StepProgress";
import TranscriptViewer from "./components/TranscriptViewer";
import ModelSelector from "./components/ModelSelector";
import CutSheetViewer from "./components/CutSheetViewer";
import CostTracker from "./components/CostTracker";
import {
  compressAudio,
  startTranscription,
  checkTranscriptionStatus,
  getTranscriptResult,
  generateCutSheet,
  importTranscript,
} from "./utils/api";

export default function App() {
  const [step, setStep] = useState("upload");
  const [completedSteps, setCompletedSteps] = useState([]);
  const [uploadData, setUploadData] = useState(null);
  const [compressData, setCompressData] = useState(null);
  const [transcriptData, setTranscriptData] = useState(null);
  const [cutsheetData, setCutsheetData] = useState(null);
  const [jobId, setJobId] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState(null);
  const [costs, setCosts] = useState([]);
  const [uploadMode, setUploadMode] = useState("upload"); // "upload" | "oneshot"

  const stepOrder = ["upload", "compress", "transcribe", "review", "generate", "complete"];

  const overallProgress = (() => {
    const idx = stepOrder.indexOf(step);
    if (idx <= 0) return 0;
    const total = stepOrder.length - 1;
    return Math.round((idx / total) * 100);
  })();

  const done = (id) => setCompletedSteps((p) => [...new Set([...p, id])]);

  const canGoToStep = (target) => {
    switch (target) {
      case "upload":
        return true;
      case "compress":
        return !!uploadData;
      case "transcribe":
        return !!compressData;
      case "review":
      case "generate":
        return !!transcriptData;
      case "complete":
        return !!cutsheetData;
      default:
        return false;
    }
  };

  // ── One-shot: Import transcript + generate cut sheet ───────────────────────
  const handleOneShot = async ({ transcriptArray, provider, model, prompt }) => {
    setProcessing(true);
    setError(null);
    setStatus("Importing transcript...");

    try {
      const imported = await importTranscript(transcriptArray);
      setTranscriptData(imported);
      setJobId(imported.job_id);

      done("upload");
      done("compress");
      done("transcribe");
      done("review");

      setStatus("Generating editor cut sheet...");
      const result = await generateCutSheet({
        transcriptJobId: imported.job_id,
        provider,
        model,
        prompt,
      });

      setCutsheetData(result);
      setCosts((p) => [
        ...p,
        {
          label: `Cut Sheet (${result.provider} / ${result.model})`,
          provider: result.provider,
          model: result.model,
          input_tokens: result.input_tokens,
          output_tokens: result.output_tokens,
          cost_usd: result.cost_usd,
        },
      ]);

      done("generate");
      done("complete");
      setStep("complete");
      setStatus("");
    } catch (err) {
      setError(err.message || "One-shot generation failed");
      setStatus("");
    } finally {
      setProcessing(false);
    }
  };

  const handleStepClick = (target) => {
    if (processing) return;
    if (!canGoToStep(target)) {
      return;
    }
    setStep(target);
    setStatus("");
  };

  // ── Upload → Compress → Transcribe (automated pipeline) ─────────────────
  const handleUploadComplete = async (data) => {
    setUploadData(data);
    done("upload");
    setStep("compress");
    setProcessing(true);
    setError(null);

    try {
      // Compress
      setStatus("Compressing audio with FFmpeg (mono 16 kHz 64 kbps)...");
      const compressed = await compressAudio(data.file_id);
      setCompressData(compressed);
      done("compress");

      // Submit to Rev AI
      setStep("transcribe");
      setStatus("Submitting to Rev AI for transcription...");
      const { job_id } = await startTranscription(compressed.file_id);
      setJobId(job_id);

      // Poll until complete
      let jobStatus = "in_progress";
      while (jobStatus === "in_progress") {
        await new Promise((r) => setTimeout(r, 3000));
        const check = await checkTranscriptionStatus(job_id);
        jobStatus = check.status;
        setStatus(`Transcription: ${jobStatus}...`);
        if (jobStatus === "transcribed" || jobStatus === "completed") break;
        if (jobStatus === "failed") throw new Error("Rev AI transcription failed");
      }

      // Fetch result
      setStatus("Fetching transcript...");
      const transcript = await getTranscriptResult(job_id);
      setTranscriptData(transcript);
      done("transcribe");
      done("review");
      setStep("review");
      setProcessing(false);
      setStatus("");
    } catch (err) {
      setError(err.message);
      setProcessing(false);
      setStatus("");
    }
  };

  // ── Generate Cut Sheet ──────────────────────────────────────────────────
  const handleGenerate = async ({ provider, model, prompt }) => {
    const transcriptJobId = jobId ?? transcriptData?.job_id;
    if (!transcriptJobId) {
      setError("No transcript job. Go back and import or transcribe first.");
      return;
    }
    setProcessing(true);
    setError(null);
    setStep("generate");
    setStatus("Generating editor cut sheet...");

    try {
      const result = await generateCutSheet({
        transcriptJobId,
        provider,
        model,
        prompt,
      });
      setCutsheetData(result);
      setCosts((p) => [
        ...p,
        {
          label: `Cut Sheet (${result.provider} / ${result.model})`,
          provider: result.provider,
          model: result.model,
          input_tokens: result.input_tokens,
          output_tokens: result.output_tokens,
          cost_usd: result.cost_usd,
        },
      ]);
      done("generate");
      done("complete");
      setStep("complete");
      setStatus("");
    } catch (err) {
      setError(err?.message ?? String(err));
      setStatus("");
    } finally {
      setProcessing(false);
    }
  };

  // ── Reset ───────────────────────────────────────────────────────────────
  const handleReset = () => {
    setStep("upload");
    setCompletedSteps([]);
    setUploadData(null);
    setCompressData(null);
    setTranscriptData(null);
    setCutsheetData(null);
    setJobId(null);
    setProcessing(false);
    setStatus("");
    setError(null);
    setCosts([]);
    setUploadMode("upload");
  };

  return (
    <div style={{ position: "relative", minHeight: "100vh" }}>
      <FloatingCanvas />

      <div
        style={{
          position: "relative",
          zIndex: 1,
          maxWidth: 820,
          margin: "0 auto",
          padding: "48px 20px",
        }}
      >
        {/* ── Header ──────────────────────────────────────────────────── */}
        <header style={{ textAlign: "center", marginBottom: 44 }}>
          <h1
            style={{
              fontFamily: "'Playfair Display', serif",
              fontSize: 38,
              fontWeight: 700,
              color: "var(--gold)",
              letterSpacing: "3px",
              marginBottom: 6,
            }}
          >
            INSIDE SUCCESS TV
          </h1>
          <p
            style={{
              color: "var(--text-muted)",
              fontSize: 12,
              letterSpacing: "4px",
              textTransform: "uppercase",
            }}
          >
            Production Pipeline
          </p>
        </header>

        {/* ── Step Progress ───────────────────────────────────────────── */}
        <StepProgress currentStep={step} completedSteps={completedSteps} onStepClick={handleStepClick} />

        {/* ── Overall Pipeline Progress ───────────────────────────────── */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.6px" }}>
              Pipeline progress
            </span>
            <span style={{ fontSize: 11, color: "var(--gold)", fontWeight: 600 }}>
              {overallProgress}%
            </span>
          </div>
          <div className="progress-bar">
            <div className="progress-bar-fill" style={{ width: `${overallProgress}%` }} />
          </div>
        </div>

        {/* ── Status Bar ──────────────────────────────────────────────── */}
        {status && (
          <div
            className="fade-in"
            style={{
              textAlign: "center",
              marginBottom: 20,
              padding: "12px 20px",
              background: "var(--bg-card)",
              borderRadius: 10,
              border: "1px solid var(--border-color)",
            }}
          >
            <span style={{ color: "var(--gold)", fontSize: 13 }}>
              {processing && <span className="spinner" style={{ marginRight: 8, verticalAlign: "middle" }} />}
              {status}
            </span>
          </div>
        )}

        {/* ── Error ───────────────────────────────────────────────────── */}
        {error && (
          <div
            className="fade-in"
            style={{
              marginBottom: 20,
              padding: "14px 20px",
              background: "rgba(239,68,68,0.06)",
              border: "1px solid rgba(239,68,68,0.25)",
              borderRadius: 10,
            }}
          >
            <p style={{ color: "var(--error)", fontSize: 13, fontWeight: 500 }}>{error}</p>
          </div>
        )}

        {/* ── Step 1: Upload or Transcript ───────────────────────────────────── */}
        {step === "upload" && (
          <>
            {/* Mode Toggle */}
            <div
              style={{
                display: "flex",
                gap: 12,
                marginBottom: 20,
                background: "var(--bg-card)",
                padding: 8,
                borderRadius: 10,
                border: "1px solid var(--border-color)",
              }}
            >
              <button
                className={`btn ${uploadMode === "upload" ? "btn-gold" : "btn-outline"}`}
                onClick={() => setUploadMode("upload")}
                style={{ flex: 1 }}
              >
                Upload Audio
              </button>
              <button
                className={`btn ${uploadMode === "oneshot" ? "btn-gold" : "btn-outline"}`}
                onClick={() => setUploadMode("oneshot")}
                style={{ flex: 1 }}
              >
                Upload Transcript (Skip Audio)
              </button>
            </div>

            {uploadMode === "upload" && (
              <FileUpload onUploadComplete={handleUploadComplete} disabled={processing} />
            )}
            {uploadMode === "oneshot" && (
              <OneShotCutSheet disabled={processing} onRun={handleOneShot} />
            )}
          </>
        )}

        {/* ── Step 2-3: Compression info (shown during transcribe) ───── */}
        {(step === "compress" || step === "transcribe") && compressData && (
          <div className="card fade-in" style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <h3 style={{ color: "var(--gold)", fontSize: 16, fontWeight: 600 }}>
                02 — Compression Complete
              </h3>
              <span className="tag tag-success">COMPRESSED</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              {[
                { label: "Original", value: compressData.original_size_human },
                { label: "Compressed", value: compressData.compressed_size_human, color: "var(--success)" },
                { label: "Ratio", value: `${compressData.compression_ratio}x`, color: "var(--gold)" },
              ].map((s) => (
                <div key={s.label} style={{ background: "var(--bg-secondary)", borderRadius: 8, padding: "10px 12px", textAlign: "center" }}>
                  <p style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>{s.label}</p>
                  <p style={{ fontSize: 15, fontWeight: 700, color: s.color || "var(--text-primary)" }}>{s.value}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Step 4: Transcript Review ───────────────────────────────── */}
        {["review", "generate"].includes(step) && transcriptData && (
          <TranscriptViewer
            transcript={transcriptData}
            jobId={jobId}
            onContinue={() => setStep("generate")}
          />
        )}

        {/* ── Step 5: Model Selector ──────────────────────────────────── */}
        {["review", "generate"].includes(step) && step !== "complete" && transcriptData && (
          <div style={{ marginTop: 16 }}>
            <ModelSelector
              transcript={transcriptData}
              onGenerate={handleGenerate}
              disabled={processing}
            />
          </div>
        )}

        {/* ── Step 6: Cut Sheet Result ────────────────────────────────── */}
        {step === "complete" && cutsheetData && (
          <div style={{ marginTop: 16 }}>
            <CutSheetViewer cutsheet={cutsheetData} onReset={handleReset} />
          </div>
        )}

        {/* ── Cost Tracker ────────────────────────────────────────────── */}
        <CostTracker costs={costs} />

        {/* ── Footer ──────────────────────────────────────────────────── */}
        <footer
          style={{
            textAlign: "center",
            marginTop: 64,
            paddingTop: 20,
            borderTop: "1px solid var(--border-color)",
          }}
        >
          <p style={{ color: "var(--text-muted)", fontSize: 11, letterSpacing: "1px" }}>
            Inside Success TV Production Pipeline v1.0
          </p>
        </footer>
      </div>
    </div>
  );
}
