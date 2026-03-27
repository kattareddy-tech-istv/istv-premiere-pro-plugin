import { useState, useEffect, useRef } from "react";
import PipelineSelector from "./components/PipelineSelector";
import FileUpload from "./components/FileUpload";
import OneShotCutSheet from "./components/OneShotCutSheet";
import StepProgress from "./components/StepProgress";
import TranscriptViewer from "./components/TranscriptViewer";
import ModelSelector from "./components/ModelSelector";
import CutSheetViewer from "./components/CutSheetViewer";
import CostTracker from "./components/CostTracker";
import BRollModelSelector from "./components/BRollModelSelector";
import BRollViewer from "./components/BRollViewer";
import BRollTranscriptImporter from "./components/BRollTranscriptImporter";
import PipelineStageBadge from "./components/PipelineStageBadge";
import ErrorPanel from "./components/ErrorPanel";
import PipelineStepPlaceholder from "./components/PipelineStepPlaceholder";
import {
  compressAudio,
  startTranscription,
  checkTranscriptionStatus,
  waitForTranscriptionSSE,
  getTranscriptResult,
  generateCutSheet,
  importTranscript,
  generateBRoll,
  checkBackendVersion,
  FRONTEND_VERSION,
  getCutSheetAutoDefaults,
} from "./utils/api";
import WindowsToggle from "./components/WindowsToggle";
import {
  notifyPipelineStep,
  getNotificationPermission,
  ensureNotificationPermissionOnce,
} from "./utils/notifications";

export default function App() {
  const [pipeline, setPipeline] = useState(null); // null | "cutsheet" | "broll"
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
  const [brollData, setBrollData] = useState(null);
  const [brollSelection, setBrollSelection] = useState({ provider: "anthropic", model: "claude-opus-4-6" });
  const [brollPrompt, setBrollPrompt] = useState("");
  const [premiereXmlData, setPremiereXmlData] = useState(null);
  const [newVersionAvailable, setNewVersionAvailable] = useState(false);
  /** When true, stop after transcript so the user can edit the prompt and click Continue / Generate. Default off (auto-continue). */
  const [pauseAfterTranscript, setPauseAfterTranscript] = useState(false);
  /** 'denied' | 'unsupported' | null — show banner so user fixes or is aware */
  const [notificationIssue, setNotificationIssue] = useState(null);
  const [runStartedAt, setRunStartedAt] = useState(null);
  const [lastRunMs, setLastRunMs] = useState(null);

  const brollSelectionRef = useRef(brollSelection);
  const brollPromptRef = useRef(brollPrompt);
  useEffect(() => {
    brollSelectionRef.current = brollSelection;
  }, [brollSelection]);
  useEffect(() => {
    brollPromptRef.current = brollPrompt;
  }, [brollPrompt]);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      const backendVersion = await checkBackendVersion();
      if (!cancelled && backendVersion && backendVersion !== FRONTEND_VERSION) {
        setNewVersionAvailable(true);
      }
    };
    poll();
    const id = setInterval(poll, 5 * 60 * 1000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  /* Pipeline step alerts — permission requested on load (required). */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await ensureNotificationPermissionOnce();
      if (cancelled) return;
      const p = getNotificationPermission();
      if (p === "denied") setNotificationIssue("denied");
      else if (p === "unsupported") setNotificationIssue("unsupported");
      else setNotificationIssue(null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const cutsheetStepOrder = ["upload", "compress", "transcribe", "review", "generate", "complete"];
  const brollStepOrder = ["upload", "compress", "transcribe", "review", "broll_generate", "broll_complete"];
  const stepOrder = pipeline === "broll" ? brollStepOrder : cutsheetStepOrder;

  const overallProgress = (() => {
    const idx = stepOrder.indexOf(step);
    if (idx <= 0) return 0;
    const total = stepOrder.length - 1;
    return Math.round((idx / total) * 100);
  })();

  const done = (id) => setCompletedSteps((p) => [...new Set([...p, id])]);
  const formatDuration = (ms) => {
    if (!ms || ms < 0) return "";
    const total = Math.round(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };
  const beginRunClock = () => setRunStartedAt(Date.now());
  const endRunClock = () => {
    if (!runStartedAt) return null;
    const elapsed = Date.now() - runStartedAt;
    setLastRunMs(elapsed);
    return elapsed;
  };

  // ── URL ?pipeline=broll: land directly on B-Roll pipeline ─────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const p = params.get("pipeline");
    if (p === "broll" || p === "cutsheet") {
      setPipeline(p);
      setStep("upload");
      setCompletedSteps([]);
      setUploadData(null);
      setCompressData(null);
      setTranscriptData(null);
      setCutsheetData(null);
      setBrollData(null);
    setBrollPrompt("");
      setJobId(null);
      setError(null);
      setStatus("");
      setPremiereXmlData(null);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

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

      notifyPipelineStep("Transcript imported", "Generating your cut sheet…");
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
      notifyPipelineStep("Cut sheet ready", "Your editor cut sheet is ready to review or export.");
    } catch (err) {
      setError(err.message || "One-shot generation failed");
      setStatus("");
    } finally {
      setProcessing(false);
    }
  };

  const handleStepClick = (target) => {
    if (processing) return;
    setStep(target);
    setError(null);
    setStatus("");
  };

  // ── Upload → Compress → Transcribe (automated pipeline) ─────────────────
  const handleUploadComplete = async (data) => {
    const currentPipeline = pipeline;
    beginRunClock();
    setUploadData(data);
    done("upload");
    setStep("compress");
    setProcessing(true);
    setError(null);

    try {
      setStatus("Preparing audio for transcription…");
      const compressed = await compressAudio(data.file_id);
      setCompressData(compressed);
      done("compress");
      if (compressed.compression_skipped) {
        notifyPipelineStep("Audio ready", "Original file sent to Rev (under size limit — FFmpeg skipped).");
      } else {
        notifyPipelineStep("Compression complete", "Audio is ready for transcription.");
      }

      setStep("transcribe");
      setStatus("Submitting to Rev AI for transcription...");
      const { job_id } = await startTranscription(compressed.file_id);
      setJobId(job_id);

      try {
        await waitForTranscriptionSSE(job_id, (s) => setStatus(`Transcription: ${s}...`));
      } catch (sseErr) {
        if (sseErr.message === "SSE_CONNECTION_FAILED" || sseErr.message === "SSE_UNSUPPORTED") {
          // Fallback: original polling at 5 s interval
          let jobStatus = "in_progress";
          while (jobStatus === "in_progress") {
            await new Promise((r) => setTimeout(r, 5000));
            const check = await checkTranscriptionStatus(job_id);
            jobStatus = check.status;
            setStatus(`Transcription: ${jobStatus}...`);
            if (jobStatus === "transcribed" || jobStatus === "completed") break;
            if (jobStatus === "failed") throw new Error("Rev AI transcription failed");
          }
        } else {
          throw sseErr;
        }
      }

      setStatus("Fetching transcript...");
      const transcript = await getTranscriptResult(job_id);
      setTranscriptData(transcript);
      done("transcribe");
      done("review");
      notifyPipelineStep("Transcription complete", "Your transcript is ready.");

      if (pauseAfterTranscript) {
        setStep("review");
        setProcessing(false);
        setStatus("");
        return;
      }

      if (currentPipeline === "cutsheet") {
        setStep("generate");
        setStatus("Starting cut sheet generation…");
        setProcessing(true);
        try {
          const defaults = await getCutSheetAutoDefaults();
          const result = await generateCutSheet({
            transcriptJobId: transcript.job_id,
            provider: defaults.provider,
            model: defaults.model,
            prompt: defaults.prompt,
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
          const elapsed = endRunClock();
          const durationText = formatDuration(elapsed);
          notifyPipelineStep(
            "Cut sheet ready",
            durationText
              ? `Your editor cut sheet is ready. Total time: ${durationText} (upload → cut sheet).`
              : "Your editor cut sheet is ready."
          );
        } catch (genErr) {
          setError(genErr?.message ?? String(genErr));
          setStep("review");
          setStatus("");
        } finally {
          setProcessing(false);
        }
        return;
      }

      if (currentPipeline === "broll") {
        setStep("broll_generate");
        setStatus("Starting B-roll generation…");
        setProcessing(true);
        try {
          const sel = brollSelectionRef.current;
          const bp = brollPromptRef.current;
          const result = await generateBRoll({
            transcriptJobId: transcript.job_id,
            provider: sel.provider,
            model: sel.model,
            customPrompt: bp || undefined,
          });
          setBrollData(result);
          setCosts((p) => [
            ...p,
            {
              label: `B-Roll Cut Sheet (${result.provider} / ${result.model})`,
              provider: result.provider,
              model: result.model,
              input_tokens: result.input_tokens,
              output_tokens: result.output_tokens,
              cost_usd: result.cost_usd ?? 0,
            },
          ]);
          done("broll_generate");
          done("broll_complete");
          setStep("broll_complete");
          setStatus("");
          notifyPipelineStep("B-roll cut sheet ready", "Your B-roll suggestions are ready.");
        } catch (genErr) {
          setError(genErr?.message ?? String(genErr));
          setStep("review");
          setStatus("");
        } finally {
          setProcessing(false);
        }
        return;
      }

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
  const handleGenerate = async ({ provider, model, prompt, transcriptJobId: tidOverride }) => {
    const transcriptJobId = tidOverride ?? jobId ?? transcriptData?.job_id;
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
      const elapsed = endRunClock();
      const durationText = formatDuration(elapsed);
      notifyPipelineStep(
        "Cut sheet ready",
        durationText
          ? `Your editor cut sheet is ready. Total time: ${durationText} (upload → cut sheet).`
          : "Your editor cut sheet is ready."
      );
    } catch (err) {
      setError(err?.message ?? String(err));
      setStatus("");
    } finally {
      setProcessing(false);
    }
  };

  // ── B-Roll: Import transcript (skip audio) ──────────────────────────────
  const handleBrollTranscriptImport = (data) => {
    setTranscriptData(data);
    setJobId(data.job_id);
    done("upload");
    done("compress");
    done("transcribe");
    done("review");
    setStep("broll_generate");
    setError(null);
    setStatus("");
  };

  // ── Generate B-Roll Cut Sheet (B-Roll pipeline) ─────────────────────────
  const handleBRollGenerate = async ({ provider, model, prompt, transcriptJobId: tidOverride }) => {
    const brollJobId = tidOverride ?? jobId ?? transcriptData?.job_id;
    if (!brollJobId) {
      setError("No transcript. Upload audio and transcribe first.");
      return;
    }
    setProcessing(true);
    setError(null);
    setStatus("Generating B-roll cut sheet (Master Prompt v2)...");

    try {
      const result = await generateBRoll({
        transcriptJobId: brollJobId,
        provider,
        model,
        customPrompt: (prompt ?? brollPrompt) || undefined,
      });
      setBrollData(result);
      setCosts((p) => [
        ...p,
        {
          label: `B-Roll Cut Sheet (${result.provider} / ${result.model})`,
          provider: result.provider,
          model: result.model,
          input_tokens: result.input_tokens,
          output_tokens: result.output_tokens,
          cost_usd: result.cost_usd ?? 0,
        },
      ]);
      done("broll_generate");
      done("broll_complete");
      setStep("broll_complete");
      setStatus("");
      notifyPipelineStep("B-roll cut sheet ready", "Your B-roll suggestions are ready.");
    } catch (err) {
      setError(err?.message ?? String(err));
      setStatus("");
    } finally {
      setProcessing(false);
    }
  };

  const handleBRollGenerateFromSelection = async () => {
    await handleBRollGenerate({ ...brollSelection, prompt: brollPrompt });
  };

  // ── Reset ───────────────────────────────────────────────────────────────
  const handleReset = () => {
    setPipeline(null);
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
    setBrollData(null);
    setBrollPrompt("");
    setPremiereXmlData(null);
    setRunStartedAt(null);
    setLastRunMs(null);
  };

  // ── Pipeline selection handler ───────────────────────────────────────────
  const handlePipelineSelect = (selected) => {
    ensureNotificationPermissionOnce().then(() => {
      const p = getNotificationPermission();
      if (p === "denied") setNotificationIssue("denied");
      else if (p === "unsupported") setNotificationIssue("unsupported");
      else setNotificationIssue(null);
    });
    setPipeline(selected);
    setStep("upload");
    setCompletedSteps([]);
    setUploadData(null);
    setCompressData(null);
    setTranscriptData(null);
    setCutsheetData(null);
    setBrollData(null);
    setBrollPrompt("");
    setJobId(null);
    setError(null);
    setStatus("");
    setPremiereXmlData(null);
    setRunStartedAt(null);
    setLastRunMs(null);
  };
  const switchPipeline = () => {
    if (processing) return;
    handlePipelineSelect(pipeline === "cutsheet" ? "broll" : "cutsheet");
  };

  const badgeTop = newVersionAvailable ? 52 : 12;

  return (
    <div style={{ position: "relative", minHeight: "100vh", background: "#000000" }}>
      {pipeline && (
        <PipelineStageBadge
          pipeline={pipeline}
          step={step}
          status={status}
          processing={processing}
          topOffset={badgeTop}
        />
      )}

      {newVersionAvailable && (
        <div
          role="button"
          tabIndex={0}
          onClick={() => window.location.reload()}
          onKeyDown={(e) => e.key === "Enter" && window.location.reload()}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            zIndex: 9999,
            padding: "10px 16px",
            background: "#000000",
            color: "var(--text-secondary)",
            textAlign: "center",
            fontSize: 13,
            cursor: "pointer",
            borderBottom: "1px solid rgba(255,215,0,0.35)",
            fontFamily: "var(--font-ui)",
          }}
        >
          A new version is available.{" "}
          <span style={{ textDecoration: "underline", color: "var(--gold-bright)", fontWeight: 700 }}>
            Refresh
          </span>
        </div>
      )}

      {notificationIssue === "denied" && (
        <div className="notification-banner" role="status">
          <strong style={{ color: "var(--gold-bright)" }}>Notifications blocked.</strong> Turn them on for this site in
          your browser (address bar lock → Site settings → Notifications) so you get alerts when each pipeline step
          finishes.
        </div>
      )}
      {notificationIssue === "unsupported" && (
        <div className="notification-banner" role="status">
          <strong style={{ color: "var(--gold-bright)" }}>Notifications not available</strong> in this browser or context.
          Keep this tab visible to follow progress in the app.
        </div>
      )}

      <div
        style={{
          position: "relative",
          zIndex: 1,
          maxWidth: 960,
          margin: "0 auto",
          padding: newVersionAvailable ? "88px 24px 48px" : "48px 24px",
          paddingBottom: notificationIssue ? 100 : 48,
        }}
      >
        {/* ── Header (brand logo + type) ─────────────────────────────── */}
        <header className="app-header" style={{ textAlign: "center" }}>
          <img
            src="/brand/inside-success-logo.png"
            alt="Inside Success"
            className="app-header-logo"
            width={280}
            height={120}
          />
          <p
            style={{
              color: "var(--text-muted)",
              fontSize: 12,
              letterSpacing: "0.28em",
              textTransform: "uppercase",
              fontFamily: "var(--font-ui)",
              fontWeight: 500,
            }}
          >
            Production pipeline
            {pipeline === "cutsheet" && " — Editor cut sheet"}
            {pipeline === "broll" && " — B-roll suggestion"}
          </p>
          {pipeline && (
            <div style={{ marginTop: 14, display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => handleReset()}
                disabled={processing}
              >
                Back to pipeline chooser
              </button>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={switchPipeline}
                disabled={processing}
              >
                Switch to {pipeline === "cutsheet" ? "B-roll suggestion" : "Editor cut sheet"}
              </button>
            </div>
          )}
        </header>

        {/* ── Pipeline selection (first screen) ───────────────────────────── */}
        {!pipeline && (
          <>
            <p
              style={{
                color: "var(--text-secondary)",
                fontSize: 14,
                marginBottom: 8,
                textAlign: "center",
                lineHeight: 1.6,
                maxWidth: 520,
                marginLeft: "auto",
                marginRight: "auto",
              }}
            >
              Choose a pipeline to get started
            </p>
            <PipelineSelector onSelect={handlePipelineSelect} />
          </>
        )}

        {/* ── Step Progress (when pipeline selected) ────────────────────── */}
        {pipeline && (
          <>
            {lastRunMs && (
              <div className="fade-in" style={{ marginBottom: 14, textAlign: "center" }}>
                <span className="tag tag-success">Last run: {formatDuration(lastRunMs)} (upload → cut sheet)</span>
              </div>
            )}
            <StepProgress
              currentStep={step}
              completedSteps={completedSteps}
              onStepClick={handleStepClick}
              pipeline={pipeline}
              navigationDisabled={processing}
            />

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

        {/* ── Error (human-readable panel) ─────────────────────────────── */}
        <ErrorPanel error={error} onDismiss={() => setError(null)} />

        {/* ── Jump to any step: placeholders when data not ready yet ───── */}
        {pipeline && step === "compress" && !compressData && (
          <PipelineStepPlaceholder
            title="Compression"
            body="Upload an audio file first. Compression runs automatically right after upload."
            actionLabel="Go to Upload"
            onAction={() => setStep("upload")}
          />
        )}
        {pipeline && step === "transcribe" && !compressData && (
          <PipelineStepPlaceholder
            title="Transcription"
            body="Upload and compress audio first. Transcription starts automatically after compression."
            actionLabel="Go to Upload"
            onAction={() => setStep("upload")}
          />
        )}
        {pipeline && step === "review" && !transcriptData && (
          <PipelineStepPlaceholder
            title="Review"
            body="You need a transcript first. Upload audio or import a transcript from the Upload step."
            actionLabel="Go to Upload"
            onAction={() => setStep("upload")}
          />
        )}
        {pipeline === "cutsheet" && step === "generate" && !transcriptData && (
          <PipelineStepPlaceholder
            title="Cut sheet"
            body="Generate a cut sheet after you have a transcript. Start from Upload or Review."
            actionLabel="Go to Upload"
            onAction={() => setStep("upload")}
          />
        )}
        {pipeline === "broll" && step === "broll_generate" && !transcriptData && (
          <PipelineStepPlaceholder
            title="B-roll"
            body="Generate B-roll suggestions after you have a transcript. Start from Upload or Review."
            actionLabel="Go to Upload"
            onAction={() => setStep("upload")}
          />
        )}
        {pipeline === "cutsheet" && step === "complete" && !cutsheetData && (
          <PipelineStepPlaceholder
            title="Done"
            body="Your cut sheet will appear here after generation finishes."
            actionLabel="Go to Cut Sheet step"
            onAction={() => setStep(transcriptData ? "generate" : "upload")}
          />
        )}
        {pipeline === "broll" && step === "broll_complete" && !brollData && (
          <PipelineStepPlaceholder
            title="Done"
            body="Your B-roll sheet will appear here after generation finishes."
            actionLabel="Go to B-Roll step"
            onAction={() => setStep(transcriptData ? "broll_generate" : "upload")}
          />
        )}

        {/* ── Step 1: Upload ───────────────────────────────────────────────── */}
        {pipeline && step === "upload" && (
          <>
            {(pipeline === "cutsheet" || pipeline === "broll") && (
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
                  {pipeline === "cutsheet" ? "Upload Transcript (Skip Audio)" : "Upload Transcript"}
                </button>
              </div>
            )}
            {uploadMode === "upload" && (pipeline === "cutsheet" || pipeline === "broll") && (
              <div
                className="card fade-in"
                style={{
                  marginBottom: 16,
                  padding: "14px 16px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 16,
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                    <p
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: "var(--text-primary)",
                        marginBottom: 6,
                        letterSpacing: "0.02em",
                      }}
                    >
                      Pause after transcription
                    </p>
                    <p style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.55, margin: 0 }}>
                      <span style={{ color: "var(--text-secondary)" }}>{pauseAfterTranscript ? "On" : "Off"}</span>
                      {" — "}
                      {pauseAfterTranscript
                        ? "Stops after the transcript so you can review and edit prompts before generating."
                        : `Automatically continues to ${pipeline === "broll" ? "B-roll" : "cut sheet"} generation when Rev AI finishes.`}
                    </p>
                    <p style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5, margin: "8px 0 0", opacity: 0.9 }}>
                      Starts <strong style={{ color: "var(--text-secondary)" }}>off</strong> by default. Turn the switch on only if you want to pause after transcription.
                    </p>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <WindowsToggle
                      checked={pauseAfterTranscript}
                      onChange={setPauseAfterTranscript}
                      disabled={processing}
                      aria-label="Pause after transcription"
                    />
                  </div>
                </div>
                <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 12, lineHeight: 1.5 }}>
                  Step notifications are enabled when your browser allows them — we request permission when you open
                  this tool.
                </p>
              </div>
            )}
            {uploadMode === "upload" && (
              <FileUpload
                onUploadComplete={handleUploadComplete}
                disabled={processing}
                onPremiereXml={pipeline === "cutsheet" ? setPremiereXmlData : undefined}
              />
            )}
            {pipeline === "cutsheet" && uploadMode === "oneshot" && (
              <OneShotCutSheet disabled={processing} onRun={handleOneShot} />
            )}
            {pipeline === "broll" && uploadMode === "oneshot" && (
              <>
                <BRollModelSelector
                  showGenerate={false}
                  showPrompt={false}
                  value={brollSelection}
                  onChange={setBrollSelection}
                  disabled={processing}
                />
                <div style={{ marginTop: 16 }}>
                  <BRollTranscriptImporter
                    onImportComplete={handleBrollTranscriptImport}
                    disabled={processing}
                    prompt={brollPrompt}
                    onPromptChange={setBrollPrompt}
                  />
                </div>
              </>
            )}
          </>
        )}

        {/* ── Step 2-3: Compression info ─────────────────────────────────── */}
        {pipeline && (step === "compress" || step === "transcribe") && compressData && (
          <div className="card fade-in" style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <h3 style={{ color: "var(--gold)", fontSize: 16, fontWeight: 600 }}>
                {compressData.compression_skipped
                  ? "02 — Original file (FFmpeg skipped)"
                  : "02 — Compression complete"}
              </h3>
              <span className={`tag ${compressData.compression_skipped ? "tag-gold" : "tag-success"}`}>
                {compressData.compression_skipped ? "UNDER LIMIT" : "COMPRESSED"}
              </span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              {[
                { label: "Original", value: compressData.original_size_human },
                {
                  label: compressData.compression_skipped ? "Sent to Rev" : "Compressed",
                  value: compressData.compressed_size_human,
                  color: "var(--success)",
                },
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

        {/* ── Step 4: Transcript Review (hidden during auto cut-sheet generation) ─ */}
        {pipeline &&
          ["review", "generate", "broll_generate"].includes(step) &&
          transcriptData &&
          !(pipeline === "cutsheet" && !pauseAfterTranscript && step === "generate") && (
            <TranscriptViewer
              transcript={transcriptData}
              jobId={jobId}
              onContinue={() => setStep(pipeline === "broll" ? "broll_generate" : "generate")}
              continueLabel={pipeline === "broll" ? "Continue to B-Roll →" : "Continue to Cut Sheet →"}
            />
          )}

        {/* ── Step 5a: Cut Sheet Model Selector ───────────────────────────── */}
        {pipeline === "cutsheet" && ["review", "generate"].includes(step) && step !== "complete" && transcriptData && (
          <div style={{ marginTop: 16 }}>
            <ModelSelector
              transcript={transcriptData}
              onGenerate={handleGenerate}
              disabled={processing}
            />
          </div>
        )}

        {/* ── Step 5b: B-Roll Model Selector ─────────────────────────────── */}
        {pipeline === "broll" && (step === "review" || step === "broll_generate") && transcriptData && (
          <div style={{ marginTop: 16 }}>
            <BRollModelSelector
              value={brollSelection}
              onChange={setBrollSelection}
              onGenerate={handleBRollGenerateFromSelection}
              disabled={processing}
              showPrompt={true}
              prompt={brollPrompt}
              onPromptChange={setBrollPrompt}
            />
          </div>
        )}

        {/* ── Step 6: Cut Sheet Result ────────────────────────────────── */}
        {pipeline === "cutsheet" && step === "complete" && cutsheetData && (
          <div style={{ marginTop: 16 }}>
            <CutSheetViewer cutsheet={cutsheetData} onReset={handleReset} premiereXmlData={premiereXmlData} />
          </div>
        )}

        {/* ── Step 6: B-Roll Cut Sheet Result ──────────────────────────── */}
        {pipeline === "broll" && step === "broll_complete" && brollData && (
          <div style={{ marginTop: 16 }}>
            <BRollViewer brollData={brollData} onReset={handleReset} />
          </div>
        )}

        {/* ── Cost Tracker ────────────────────────────────────────────── */}
        {pipeline && <CostTracker costs={costs} />}

          </>
        )}

        {/* ── Footer ──────────────────────────────────────────────────── */}
        <footer
          style={{
            textAlign: "center",
            marginTop: 64,
            paddingTop: 20,
            borderTop: "1px solid var(--border-color)",
          }}
        >
          <p style={{ color: "var(--text-muted)", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase" }}>
            Inside Success — production pipeline
          </p>
        </footer>
      </div>
    </div>
  );
}
