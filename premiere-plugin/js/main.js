/**
 * main.js — Panel logic for the Inside Success TV Cut Sheet plugin.
 * Runs inside Premiere Pro's CEP panel (Chromium-based browser).
 */

/* global CSInterface, SystemPath, API */

var cs = new CSInterface();

/* ─────────────────────────────────────────
   State
───────────────────────────────────────── */
var state = {
  fileId: null,
  jobId: null,
  transcript: null,
  cutSheet: null,
  xmlDownloadUrl: null,
  xmlFilename: null,
  models: [],
  selectedModel: null,
  stage: "idle",          // idle | uploading | compressing | transcribing | ready | generating | done
  pollInterval: null,
  uploadProgress: 0
};

/* ─────────────────────────────────────────
   Boot
───────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", function () {
  // Restore saved backend URL
  var savedUrl = localStorage.getItem("istv_backend_url");
  if (savedUrl) {
    document.getElementById("backend-url").value = savedUrl;
    API.setBaseUrl(savedUrl);
  }

  loadModels();
  bindEvents();
  bindMulticamEvents();
  bindCutSheetApplyEvents();
  bindSemiAssistedEvents();
  applyTheme();
  cs.addEventListener(CSInterface.THEME_COLOR_CHANGED_EVENT, applyTheme);
  // Check for plugin updates in the background after a short delay
  setTimeout(checkForUpdates, 3000);
});

/* ─────────────────────────────────────────
   Theme (match Premiere Pro dark/light UI)
───────────────────────────────────────── */
function applyTheme() {
  var hostEnv = cs.getHostEnvironment();
  var skinInfo = JSON.parse(hostEnv).appSkinInfo;
  var bg = skinInfo.panelBackgroundColor.color;
  var r = bg.red, g = bg.green, b = bg.blue;
  var brightness = (r * 299 + g * 587 + b * 114) / 1000;
  document.body.style.backgroundColor = "rgb(" + r + "," + g + "," + b + ")";
  document.body.classList.toggle("light-theme", brightness > 128);
}

/* ─────────────────────────────────────────
   Events
───────────────────────────────────────── */
function bindEvents() {
  document.getElementById("btn-save-url").addEventListener("click", onSaveUrl);
  document.getElementById("btn-check-health").addEventListener("click", onCheckHealth);
  document.getElementById("btn-browse").addEventListener("click", onBrowseFile);
  document.getElementById("btn-upload").addEventListener("click", onUpload);
  document.getElementById("btn-generate").addEventListener("click", onGenerate);
  document.getElementById("btn-import-xml").addEventListener("click", onImportXML);
  document.getElementById("btn-save-cutsheet").addEventListener("click", onSaveCutSheet);
  document.getElementById("btn-reset").addEventListener("click", onReset);
  document.getElementById("model-select").addEventListener("change", function () {
    state.selectedModel = this.value;
  });
  document.getElementById("file-input").addEventListener("change", function () {
    if (this.files && this.files[0]) {
      document.getElementById("file-name").textContent = this.files[0].name;
      document.getElementById("btn-upload").disabled = false;
    }
  });
}

/* ─────────────────────────────────────────
   URL / Health
───────────────────────────────────────── */
function onSaveUrl() {
  var url = document.getElementById("backend-url").value.trim();
  if (!url) return showNotice("Enter a backend URL first.", "error");
  API.setBaseUrl(url);
  showNotice("Backend URL saved.", "success");
}

function onCheckHealth() {
  showNotice("Checking backend…", "info");
  API.health()
    .then(function (r) { showNotice("Backend online: " + (r.status || "ok"), "success"); })
    .catch(function (e) { showNotice("Backend unreachable: " + e.message, "error"); });
}

/* ─────────────────────────────────────────
   Model loading
───────────────────────────────────────── */
function loadModels() {
  API.getModels()
    .then(function (data) {
      // Backend returns nested: {anthropic: {models: [...]}, openai: {...}, gemini: {...}}
      var flat = [];
      ["anthropic", "openai", "gemini"].forEach(function (provider) {
        if (data[provider] && data[provider].models) {
          data[provider].models.forEach(function (m) {
            flat.push({ id: m.id, name: m.name, provider: provider, recommended: m.recommended });
          });
        }
      });
      state.models = flat;
      var sel = document.getElementById("model-select");
      sel.innerHTML = "";
      flat.forEach(function (m) {
        var opt = document.createElement("option");
        opt.value = m.id;
        opt.textContent = m.name + " (" + m.provider + ")" + (m.recommended ? " ★" : "");
        sel.appendChild(opt);
      });
      // Default to recommended model
      var rec = flat.filter(function (m) { return m.recommended; })[0] || flat[0];
      if (rec) { sel.value = rec.id; state.selectedModel = rec.id; }
    })
    .catch(function () {
      // Backend not yet available — use defaults
      var defaults = [
        { id: "claude-opus-4-6", name: "Claude Opus 4.6 (Most Intelligent)", provider: "anthropic" },
        { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5 (Balanced)", provider: "anthropic" },
        { id: "gpt-4o", name: "GPT-4o", provider: "openai" }
      ];
      var sel = document.getElementById("model-select");
      sel.innerHTML = "";
      defaults.forEach(function (m) {
        var opt = document.createElement("option");
        opt.value = m.id;
        opt.textContent = m.name + " (" + m.provider + ")";
        sel.appendChild(opt);
      });
      state.models = defaults;
      state.selectedModel = defaults[0].id;
    });
}

/* ─────────────────────────────────────────
   Browse (via ExtendScript dialog)
───────────────────────────────────────── */
function onBrowseFile() {
  cs.evalScript("browseForAudioFile()", function (result) {
    try {
      var r = JSON.parse(result);
      if (r.success) {
        document.getElementById("file-name").textContent = r.path.split(/[\/\\]/).pop();
        // Store path so we can use it with a virtual File object
        document.getElementById("file-path-hidden").value = r.path;
        document.getElementById("btn-upload").disabled = false;
      } else {
        showNotice(r.error || "No file selected.", "info");
      }
    } catch (e) {
      // Fallback — just trigger the HTML file picker
      document.getElementById("file-input").click();
    }
  });
}

/* ─────────────────────────────────────────
   Upload
───────────────────────────────────────── */
function onUpload() {
  var fileInput = document.getElementById("file-input");
  var hiddenPath = document.getElementById("file-path-hidden").value;

  if (!fileInput.files[0] && !hiddenPath) {
    return showNotice("Select a file first.", "error");
  }

  setStage("uploading");
  updateProgress(0, "Uploading…");

  // Prefer the HTML file picker file (has the actual blob), fall back to path
  var file = fileInput.files[0];

  if (!file && hiddenPath) {
    showNotice("Please use the file picker button to select the file for upload.", "info");
    fileInput.click();
    setStage("idle");
    return;
  }

  API.uploadFile(file, function (pct) {
    updateProgress(pct, "Uploading… " + pct + "%");
  })
    .then(function (r) {
      state.fileId = r.file_id;
      updateProgress(100, "Upload complete. Compressing audio…");
      setStage("compressing");
      return API.compressAudio(state.fileId);
    })
    .then(function () {
      updateProgress(100, "Compression done. Starting transcription…");
      setStage("transcribing");
      return API.startTranscription(state.fileId);
    })
    .then(function (r) {
      state.jobId = r.job_id;
      updateProgress(0, "Transcribing… (this may take a few minutes)");
      startPolling();
    })
    .catch(function (e) {
      showNotice("Error: " + e.message, "error");
      setStage("idle");
    });
}

/* ─────────────────────────────────────────
   Transcription polling
───────────────────────────────────────── */
function startPolling() {
  if (state.pollInterval) clearInterval(state.pollInterval);
  state.pollInterval = setInterval(pollStatus, 5000);
}

function stopPolling() {
  if (state.pollInterval) {
    clearInterval(state.pollInterval);
    state.pollInterval = null;
  }
}

function pollStatus() {
  API.getTranscriptionStatus(state.jobId)
    .then(function (r) {
      var status = r.status || r.job_status;
      if (status === "transcribed" || status === "completed") {
        stopPolling();
        updateProgress(100, "Transcription complete. Fetching results…");
        return API.getTranscriptionResult(state.jobId).then(onTranscriptReady);
      } else if (status === "failed") {
        stopPolling();
        showNotice("Transcription failed: " + (r.failure_detail || "unknown error"), "error");
        setStage("idle");
      } else {
        updateProgress(-1, "Transcribing… status: " + status);
      }
    })
    .catch(function (e) {
      showNotice("Poll error: " + e.message, "error");
    });
}

function onTranscriptReady(r) {
  state.transcript = r;
  // Show a summary of the transcript
  var monologues = r.monologues || [];
  var totalWords = monologues.reduce(function (acc, m) {
    return acc + (m.elements || []).filter(function (e) { return e.type === "text"; }).length;
  }, 0);
  var speakers = [];
  monologues.forEach(function (m) {
    if (speakers.indexOf(m.speaker) === -1) speakers.push(m.speaker);
  });
  document.getElementById("transcript-summary").textContent =
    "Transcript ready — " + totalWords + " words, " + speakers.length + " speaker(s).";
  setStage("ready");
  showNotice("Transcription complete. Ready to generate cut sheet.", "success");
}

/* ─────────────────────────────────────────
   Generate Cut Sheet
───────────────────────────────────────── */
function onGenerate() {
  if (!state.transcript) {
    return showNotice("No transcript available. Complete upload & transcription first.", "error");
  }

  var customPrompt = document.getElementById("custom-prompt").value.trim();
  // Derive provider from selected model ID
  var modelId = state.selectedModel || "claude-opus-4-6";
  var provider = modelId.startsWith("claude") ? "anthropic"
               : modelId.startsWith("gpt") ? "openai"
               : modelId.startsWith("gemini") ? "gemini"
               : "anthropic";
  var payload = {
    transcript_job_id: state.jobId,
    provider: provider,
    model: modelId,
    custom_prompt: customPrompt || undefined,
    documentary_format: document.getElementById("doc-format-select").value || "20_25min_vip"
  };

  setStage("generating");
  updateProgress(-1, "Generating cut sheet with AI…");

  API.generateCutSheet(payload)
    .then(function (r) {
      state.cutSheet = r.cutsheet || r.cut_sheet || r.content || r;
      document.getElementById("cutsheet-output").textContent = state.cutSheet;
      document.getElementById("cutsheet-section").style.display = "block";

      // Cost info
      if (r.cost_usd != null) {
        document.getElementById("cost-info").textContent =
          "Cost: $" + r.cost_usd.toFixed(4) +
          " | Tokens: " + (r.input_tokens || 0) + " in / " + (r.output_tokens || 0) + " out";
      }

      setStage("done");
      updateProgress(100, "Cut sheet generated!");

      // Also generate Premiere XML (cutsheet_id comes back in response)
      if (r.cutsheet_id) { generateXML(r.cutsheet_id); }
    })
    .catch(function (e) {
      showNotice("Generation failed: " + e.message, "error");
      setStage("ready");
    });
}

function generateXML(cutsheetId) {
  API.generatePremiereXML(cutsheetId, {})
    .then(function (r) {
      if (r.download_url || r.xml_url) {
        state.xmlDownloadUrl = r.download_url || r.xml_url;
        state.xmlFilename = r.filename || (cutsheetId + "_premiere.xml");
        document.getElementById("btn-import-xml").disabled = false;
        document.getElementById("xml-status").textContent = "Premiere XML ready: " + state.xmlFilename;
      }
    })
    .catch(function () {
      // XML generation is optional — don't show an error
      document.getElementById("xml-status").textContent = "XML generation not available.";
    });
}

/* ─────────────────────────────────────────
   Import XML into Premiere Pro
───────────────────────────────────────── */
function onImportXML() {
  if (!state.xmlDownloadUrl) {
    return showNotice("No XML available to import.", "error");
  }

  // First get the project path via ExtendScript
  cs.evalScript("getProjectPath()", function (result) {
    try {
      var r = JSON.parse(result);
      var savePath;
      if (r.success && r.path) {
        savePath = r.path.replace(/\\/g, "/") + state.xmlFilename;
      } else {
        savePath = null;
      }

      // Download the XML from the backend and save it, then import
      downloadAndImportXML(API.getBaseUrl() + state.xmlDownloadUrl, savePath);
    } catch (e) {
      showNotice("Could not determine project path: " + e.message, "error");
    }
  });
}

function downloadAndImportXML(url, savePath) {
  var xhr = new XMLHttpRequest();
  xhr.open("GET", url, true);
  xhr.responseType = "text";
  xhr.onload = function () {
    if (xhr.status >= 200 && xhr.status < 300) {
      if (!savePath) {
        showNotice("Could not determine save path. Open your project first.", "error");
        return;
      }
      // Write via ExtendScript
      var escaped = xhr.responseText.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "");
      cs.evalScript(
        'writeTextFile("' + savePath + '", "' + escaped + '")',
        function (writeResult) {
          try {
            var wr = JSON.parse(writeResult);
            if (wr.success) {
              var nativePath = savePath.replace(/\//g, "\\");
              cs.evalScript('importXMLToProject("' + nativePath + '")', function (importResult) {
                try {
                  var ir = JSON.parse(importResult);
                  if (ir.success) {
                    showNotice("XML imported into project successfully!", "success");
                  } else {
                    showNotice("Import failed: " + ir.error, "error");
                  }
                } catch (e2) {
                  showNotice("Import parse error: " + e2.message, "error");
                }
              });
            } else {
              showNotice("Write failed: " + wr.error, "error");
            }
          } catch (e) {
            showNotice("Write result parse error: " + e.message, "error");
          }
        }
      );
    } else {
      showNotice("Failed to download XML: HTTP " + xhr.status, "error");
    }
  };
  xhr.onerror = function () { showNotice("Network error downloading XML.", "error"); };
  xhr.send();
}

/* ─────────────────────────────────────────
   Save Cut Sheet to disk
───────────────────────────────────────── */
function onSaveCutSheet() {
  if (!state.cutSheet) return showNotice("No cut sheet to save.", "error");

  cs.evalScript("getProjectPath()", function (result) {
    try {
      var r = JSON.parse(result);
      var savePath = (r.success && r.path)
        ? r.path.replace(/\\/g, "/") + "cutsheet_" + state.jobId + ".txt"
        : null;

      if (!savePath) {
        showNotice("Open a project first to save the cut sheet.", "error");
        return;
      }

      var escaped = state.cutSheet
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\n/g, "\\n")
        .replace(/\r/g, "");

      cs.evalScript('writeTextFile("' + savePath + '", "' + escaped + '")', function (wr) {
        try {
          var w = JSON.parse(wr);
          if (w.success) showNotice("Cut sheet saved to: " + savePath, "success");
          else showNotice("Save failed: " + w.error, "error");
        } catch (e) { showNotice("Save error.", "error"); }
      });
    } catch (e) {
      showNotice("Could not get project path.", "error");
    }
  });
}

/* ─────────────────────────────────────────
   Reset
───────────────────────────────────────── */
function onReset() {
  stopPolling();
  state.fileId = null;
  state.jobId = null;
  state.transcript = null;
  state.cutSheet = null;
  state.xmlDownloadUrl = null;
  state.xmlFilename = null;
  document.getElementById("file-name").textContent = "No file selected";
  document.getElementById("file-input").value = "";
  document.getElementById("file-path-hidden").value = "";
  document.getElementById("btn-upload").disabled = true;
  document.getElementById("transcript-summary").textContent = "";
  document.getElementById("cutsheet-output").textContent = "";
  document.getElementById("cutsheet-section").style.display = "none";
  document.getElementById("cost-info").textContent = "";
  document.getElementById("xml-status").textContent = "";
  document.getElementById("btn-import-xml").disabled = true;
  resetMulticam();
  setStage("idle");
  updateProgress(0, "");
}

/* ─────────────────────────────────────────
   Multicam AI Edit
───────────────────────────────────────── */

var multicamState = {
  sequenceInfo: null,
  suggestions: [],
  approved: {}  // id → true/false
};

function bindMulticamEvents() {
  document.getElementById("btn-scan-multicam").addEventListener("click", onScanMulticam);
  document.getElementById("btn-analyze-multicam").addEventListener("click", onAnalyzeMulticam);
  document.getElementById("btn-apply-cuts").addEventListener("click", onApplyCuts);
  document.getElementById("btn-markers-only").addEventListener("click", onMarkersOnly);
  document.getElementById("select-all-btn").addEventListener("click", function () {
    multicamState.suggestions.forEach(function (s) { multicamState.approved[s.id] = true; });
    renderSuggestions(multicamState.suggestions);
  });
  document.getElementById("select-none-btn").addEventListener("click", function () {
    multicamState.suggestions.forEach(function (s) { multicamState.approved[s.id] = false; });
    renderSuggestions(multicamState.suggestions);
  });
}

/* ── Step 1: Scan the active Premiere Pro sequence ── */
function onScanMulticam() {
  var btn = document.getElementById("btn-scan-multicam");
  btn.disabled = true;
  btn.textContent = "Scanning…";
  document.getElementById("multicam-seq-info").textContent = "Reading sequence…";
  document.getElementById("btn-analyze-multicam").disabled = true;

  cs.evalScript("getMulticamSequenceInfo()", function (result) {
    btn.disabled = false;
    btn.textContent = "\uD83D\uDD0D Scan Active Sequence";
    try {
      var r = JSON.parse(result);
      if (!r.success) {
        document.getElementById("multicam-seq-info").innerHTML =
          '<span style="color:var(--error)">' + (r.error || "Could not read sequence.") + "</span>";
        return;
      }
      multicamState.sequenceInfo = r;

      var vTracks = r.video_tracks || [];
      var aTracks = r.audio_tracks || [];
      var totalClips = vTracks.reduce(function (n, t) { return n + (t.clip_count || 0); }, 0);
      var durMin = Math.floor((r.duration_seconds || 0) / 60);
      var durSec = Math.floor((r.duration_seconds || 0) % 60);

      var html = '<strong style="color:var(--text)">' + r.sequence_name + "</strong><br>";
      html += durMin + "m " + durSec + "s &nbsp;|&nbsp; " + vTracks.length + " video track(s), " + aTracks.length + " audio track(s), " + totalClips + " clips";
      html += "<br>";
      vTracks.forEach(function (t) {
        html += '<span style="color:var(--text-muted)">V' + (t.index + 1) + ": " + t.clip_count + " clips</span>&nbsp; ";
      });

      document.getElementById("multicam-seq-info").innerHTML = html;
      document.getElementById("btn-analyze-multicam").disabled = false;
      showNotice("Sequence scanned: " + totalClips + " clips across " + vTracks.length + " tracks.", "success");
    } catch (e) {
      document.getElementById("multicam-seq-info").innerHTML =
        '<span style="color:var(--error)">Parse error: ' + e.message + "</span>";
    }
  });
}

/* ── Step 2: Send to Claude for analysis ── */
function onAnalyzeMulticam() {
  if (!multicamState.sequenceInfo) {
    return showNotice("Scan the sequence first.", "error");
  }

  var model = document.getElementById("multicam-model-select").value;
  var instructions = document.getElementById("multicam-instructions").value.trim();

  document.getElementById("btn-analyze-multicam").disabled = true;
  document.getElementById("btn-analyze-multicam").textContent = "Analyzing…";
  document.getElementById("suggestions-section").style.display = "none";
  document.getElementById("multicam-cost-info").textContent = "";
  updateProgress(-1, "Claude is analyzing your multicam sequence…");

  API.analyzeMulticam(multicamState.sequenceInfo, model, instructions)
    .then(function (r) {
      document.getElementById("btn-analyze-multicam").disabled = false;
      document.getElementById("btn-analyze-multicam").textContent = "\u26A1 Analyze with Claude";
      updateProgress(100, "Analysis complete!");

      var suggestions = r.suggestions || [];
      multicamState.suggestions = suggestions;
      multicamState.approved = {};
      suggestions.forEach(function (s) {
        multicamState.approved[s.id] = (s.confidence === "high" || s.confidence === "medium");
      });

      // Show summary
      var summaryEl = document.getElementById("multicam-summary");
      if (r.summary) {
        summaryEl.textContent = r.summary;
        summaryEl.style.display = "block";
      } else {
        summaryEl.style.display = "none";
      }

      // Cost info
      if (r.cost_usd != null) {
        document.getElementById("multicam-cost-info").textContent =
          "Cost: $" + r.cost_usd.toFixed(4) + " | " + (r.input_tokens || 0) + " in / " + (r.output_tokens || 0) + " out tokens";
      }

      renderSuggestions(suggestions);
      document.getElementById("suggestions-section").style.display = "block";

      if (suggestions.length === 0) {
        showNotice("Claude found no cut suggestions for this sequence.", "info");
      } else {
        showNotice(suggestions.length + " edit suggestions ready. Review and apply.", "success");
      }
    })
    .catch(function (e) {
      document.getElementById("btn-analyze-multicam").disabled = false;
      document.getElementById("btn-analyze-multicam").textContent = "\u26A1 Analyze with Claude";
      updateProgress(0, "");
      showNotice("Analysis failed: " + e.message, "error");
    });
}

/* ── Render suggestion list ── */
function renderSuggestions(suggestions) {
  var list = document.getElementById("suggestions-list");
  var countEl = document.getElementById("suggestions-count");
  var applyBtn = document.getElementById("btn-apply-cuts");
  var markersBtn = document.getElementById("btn-markers-only");

  list.innerHTML = "";

  if (!suggestions || suggestions.length === 0) {
    list.innerHTML = '<div style="padding:12px;color:var(--text-muted);font-size:11px;text-align:center">No suggestions</div>';
    applyBtn.disabled = true;
    markersBtn.disabled = true;
    countEl.textContent = "0 suggestions";
    return;
  }

  var approvedCount = suggestions.filter(function (s) { return multicamState.approved[s.id]; }).length;
  countEl.textContent = suggestions.length + " suggestions — " + approvedCount + " selected";
  applyBtn.disabled = (approvedCount === 0);
  markersBtn.disabled = false;

  suggestions.forEach(function (s) {
    var isApproved = !!multicamState.approved[s.id];
    var item = document.createElement("div");
    item.className = "suggestion-item" + (isApproved ? " approved" : "");
    item.dataset.id = s.id;

    var confidenceClass = "confidence-" + (s.confidence || "medium");

    var actionIcon = s.action === "razor_cut" ? "\u2702\uFE0F" :
                     s.action === "camera_note" ? "\uD83C\uDFA5" : "\uD83D\uDCCC";

    item.innerHTML =
      '<input type="checkbox" class="suggestion-check" ' + (isApproved ? "checked" : "") + ' data-id="' + s.id + '">' +
      '<div class="suggestion-body">' +
        '<div class="suggestion-tc">' + actionIcon + " " + (s.timecode || formatSeconds(s.time_seconds || 0)) + "</div>" +
        '<div class="suggestion-reason">' + escapeHtml(s.reason || "") + "</div>" +
        '<div class="suggestion-meta">' +
          '<span class="' + confidenceClass + '">' + (s.confidence || "?") + " confidence</span>" +
          (s.track_label ? " &nbsp;|&nbsp; " + escapeHtml(s.track_label) : "") +
          (s.cut_type ? " &nbsp;|&nbsp; " + escapeHtml(s.cut_type) : "") +
        "</div>" +
      "</div>";

    // Toggle approval on click
    item.addEventListener("click", function (e) {
      var id = parseInt(item.dataset.id, 10);
      var chk = item.querySelector(".suggestion-check");
      if (e.target !== chk) {
        multicamState.approved[id] = !multicamState.approved[id];
        chk.checked = multicamState.approved[id];
      } else {
        multicamState.approved[id] = chk.checked;
      }
      item.classList.toggle("approved", multicamState.approved[id]);
      // Update count and button state
      var approved = multicamState.suggestions.filter(function (sg) { return multicamState.approved[sg.id]; }).length;
      countEl.textContent = multicamState.suggestions.length + " suggestions — " + approved + " selected";
      applyBtn.disabled = (approved === 0);
    });

    list.appendChild(item);
  });
}

/* ── Step 3a: Apply selected cuts (with confirmation) ── */
function onApplyCuts() {
  var approved = multicamState.suggestions.filter(function (s) { return multicamState.approved[s.id]; });
  if (approved.length === 0) {
    return showNotice("Select at least one suggestion to apply.", "error");
  }

  // Show confirmation notice before cutting
  var msg = "Apply " + approved.length + " razor cut(s) to the timeline? This cannot be easily undone.\n\nClick OK to proceed, or Cancel to add markers only instead.";
  // Use cs.evalScript to show a native Premiere dialog for confirmation
  var escapedMsg = msg.replace(/"/g, '\\"').replace(/\n/g, "\\n");
  cs.evalScript('confirm("' + escapedMsg + '")', function (result) {
    var confirmed = (result === "true" || result === true);
    if (confirmed) {
      _applyApprovedSuggestions(approved, false);
    } else {
      // User cancelled — offer to add markers only
      showNotice("Cuts cancelled. Use Markers Only to mark the suggestions without cutting.", "info");
    }
  });
}

/* ── Step 3b: Add markers only (safe preview) ── */
function onMarkersOnly() {
  if (multicamState.suggestions.length === 0) {
    return showNotice("No suggestions to add as markers.", "error");
  }
  _applyApprovedSuggestions(multicamState.suggestions, true);
}

function _applyApprovedSuggestions(suggestions, markersOnly) {
  var jsonStr = JSON.stringify(suggestions)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');

  var applyStatus = document.getElementById("apply-status");
  applyStatus.textContent = markersOnly ? "Adding markers…" : "Applying cuts…";

  var fn = markersOnly ? "addSuggestionsAsMarkersOnly" : "applyEditSuggestions";
  cs.evalScript(fn + '("' + jsonStr + '")', function (result) {
    try {
      var r = JSON.parse(result);
      if (r.success) {
        var msg = markersOnly
          ? (r.markers_added || 0) + " markers added to timeline."
          : (r.applied || 0) + " cuts applied, " + (r.markers_added || 0) + " markers added.";
        if (r.errors && r.errors.length) {
          msg += " (" + r.errors.length + " error(s): " + r.errors[0] + ")";
        }
        applyStatus.textContent = msg;
        applyStatus.style.color = "var(--success)";
        showNotice(msg, "success");
      } else {
        applyStatus.textContent = "Error: " + (r.error || "unknown");
        applyStatus.style.color = "var(--error)";
        showNotice("Apply failed: " + r.error, "error");
      }
    } catch (e) {
      applyStatus.textContent = "Parse error: " + e.message;
      showNotice("Apply error: " + e.message, "error");
    }
  });
}

function resetMulticam() {
  multicamState.sequenceInfo = null;
  multicamState.suggestions = [];
  multicamState.approved = {};
  document.getElementById("multicam-seq-info").textContent = "Open a sequence in Premiere Pro, then click Scan.";
  document.getElementById("btn-analyze-multicam").disabled = true;
  document.getElementById("suggestions-section").style.display = "none";
  document.getElementById("multicam-cost-info").textContent = "";
  document.getElementById("apply-status").textContent = "";
  var summaryEl = document.getElementById("multicam-summary");
  if (summaryEl) summaryEl.style.display = "none";
}

/* ─────────────────────────────────────────
   Cut Sheet → Timeline (Auto Cuts)
───────────────────────────────────────── */

var cutSheetState = {
  clips: [],
  approved: {}
};

function bindCutSheetApplyEvents() {
  document.getElementById("btn-parse-cutsheet").addEventListener("click", onParseCutSheet);
  document.getElementById("btn-apply-cutsheet-cuts").addEventListener("click", onApplyCutSheetCuts);
  document.getElementById("btn-cutsheet-markers-only").addEventListener("click", onCutSheetMarkersOnly);
  document.getElementById("cs-select-all-btn").addEventListener("click", function () {
    cutSheetState.clips.forEach(function (c) { cutSheetState.approved[c.id] = true; });
    renderCutSheetClips(cutSheetState.clips);
  });
  document.getElementById("cs-select-none-btn").addEventListener("click", function () {
    cutSheetState.clips.forEach(function (c) { cutSheetState.approved[c.id] = false; });
    renderCutSheetClips(cutSheetState.clips);
  });
}

function onParseCutSheet() {
  var text = document.getElementById("cutsheet-paste-input").value.trim();
  if (!text) return showNotice("Paste a cut sheet first.", "error");

  var btn = document.getElementById("btn-parse-cutsheet");
  btn.disabled = true;
  btn.textContent = "Parsing\u2026";

  API.parseCutSheet(text)
    .then(function (r) {
      btn.disabled = false;
      btn.textContent = "\uD83D\uDD0D Parse Cut Sheet";

      if (!r.clips || r.clips.length === 0) {
        showNotice("No clips found. The cut sheet must contain [IP @ HH:MM:SS\u2013HH:MM:SS] timestamps.", "warning");
        return;
      }

      cutSheetState.clips = r.clips;
      cutSheetState.approved = {};
      r.clips.forEach(function (c) { cutSheetState.approved[c.id] = true; });

      var durMin = Math.floor((r.estimated_duration_seconds || 0) / 60);
      var durSec = Math.round((r.estimated_duration_seconds || 0) % 60);
      document.getElementById("cs-clips-summary").textContent =
        r.total_clips + " clips found \u2014 ~" + durMin + "m " + durSec + "s estimated runtime";

      renderCutSheetClips(r.clips);
      document.getElementById("cs-parse-result").style.display = "block";
      showNotice(r.total_clips + " clips parsed. Review and apply to timeline.", "success");
    })
    .catch(function (e) {
      btn.disabled = false;
      btn.textContent = "\uD83D\uDD0D Parse Cut Sheet";
      showNotice("Parse failed: " + e.message, "error");
    });
}

function renderCutSheetClips(clips) {
  var list = document.getElementById("cs-clips-list");
  var countEl = document.getElementById("cs-clips-count");
  list.innerHTML = "";

  if (!clips || clips.length === 0) {
    list.innerHTML = '<div style="padding:10px;color:var(--text-muted);font-size:11px;text-align:center">No clips</div>';
    countEl.textContent = "0 clips";
    return;
  }

  var approvedCount = clips.filter(function (c) { return cutSheetState.approved[c.id]; }).length;
  countEl.textContent = clips.length + " clips \u2014 " + approvedCount + " selected";

  clips.forEach(function (c) {
    var isApproved = !!cutSheetState.approved[c.id];
    var item = document.createElement("div");
    item.className = "cs-clip-item" + (isApproved ? " approved" : "");
    item.dataset.id = c.id;

    var durStr = (c.duration_seconds || 0).toFixed(1);
    var rawQuote = c.quote || "";
    var quote = rawQuote.length > 70 ? rawQuote.substring(0, 70) + "\u2026" : rawQuote;

    item.innerHTML =
      '<input type="checkbox" class="suggestion-check" ' + (isApproved ? "checked" : "") + ' data-id="' + c.id + '">' +
      '<div style="flex:1;min-width:0">' +
        '<div style="display:flex;gap:8px;align-items:center;margin-bottom:2px">' +
          '<span class="cs-clip-tc">' + (c.in_tc || formatSeconds(c.in_seconds || 0)) + ' - ' + (c.out_tc || formatSeconds(c.out_seconds || 0)) + '</span>' +
          '<span class="cs-clip-section">' + escapeHtml(c.section || "") + '</span>' +
          '<span style="font-size:10px;color:var(--text-muted)">' + durStr + 's</span>' +
        '</div>' +
        (quote ? '<div class="cs-clip-quote">\u201c' + escapeHtml(quote) + '\u201d</div>' : '') +
      '</div>';

    item.addEventListener("click", function (e) {
      var id = parseInt(item.dataset.id, 10);
      var chk = item.querySelector(".suggestion-check");
      if (e.target !== chk) {
        cutSheetState.approved[id] = !cutSheetState.approved[id];
        chk.checked = cutSheetState.approved[id];
      } else {
        cutSheetState.approved[id] = chk.checked;
      }
      item.classList.toggle("approved", cutSheetState.approved[id]);
      var approved = cutSheetState.clips.filter(function (cl) { return cutSheetState.approved[cl.id]; }).length;
      countEl.textContent = cutSheetState.clips.length + " clips \u2014 " + approved + " selected";
    });

    list.appendChild(item);
  });
}

function onApplyCutSheetCuts() {
  var approved = cutSheetState.clips.filter(function (c) { return cutSheetState.approved[c.id]; });
  if (approved.length === 0) return showNotice("Select at least one clip to apply.", "error");

  var msg = "Apply " + approved.length + " cut(s) from the cut sheet to the timeline?\\n\\n" +
    "This makes razor cuts at each clip's IN and OUT points on all video/audio tracks.\\n" +
    "This cannot be easily undone.\\n\\nClick OK to proceed.";
  cs.evalScript('confirm("' + msg + '")', function (result) {
    if (result === "true" || result === true) {
      _applyCutSheetToTimeline(approved, false);
    } else {
      showNotice("Cancelled. Use Markers Only to preview without cutting.", "info");
    }
  });
}

function onCutSheetMarkersOnly() {
  var clips = cutSheetState.clips;
  if (!clips || clips.length === 0) return showNotice("Parse a cut sheet first.", "error");
  _applyCutSheetToTimeline(clips, true);
}

function _applyCutSheetToTimeline(clips, markersOnly) {
  var statusEl = document.getElementById("cs-apply-status");
  statusEl.textContent = markersOnly ? "Adding markers\u2026" : "Applying cuts\u2026";
  statusEl.style.color = "var(--text-muted)";

  var jsonStr = JSON.stringify(clips)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');

  var fn = markersOnly ? "addCutSheetMarkersOnly" : "applyCutSheetClips";
  cs.evalScript(fn + '("' + jsonStr + '")', function (result) {
    try {
      var r = JSON.parse(result);
      if (r.success) {
        var msg = markersOnly
          ? (r.markers_added || 0) + " markers added to timeline."
          : (r.cuts_applied || 0) + " cuts applied, " + (r.markers_added || 0) + " markers added.";
        if (r.errors && r.errors.length) {
          msg += " (" + r.errors.length + " warning(s))";
        }
        statusEl.textContent = msg;
        statusEl.style.color = "var(--success)";
        showNotice(msg, "success");
      } else {
        statusEl.textContent = "Error: " + (r.error || "unknown");
        statusEl.style.color = "var(--error)";
        showNotice("Apply failed: " + r.error, "error");
      }
    } catch (e) {
      statusEl.textContent = "Parse error: " + e.message;
    }
  });
}

/* ─────────────────────────────────────────
   Edit Selected Clip (Semi-Assisted)
───────────────────────────────────────── */

var selectedClipState = {
  info: null,
  silences: [],
  approvedSilences: {}
};

function bindSemiAssistedEvents() {
  document.getElementById("btn-get-selected-clip").addEventListener("click", onGetSelectedClip);
  document.getElementById("btn-detect-silences").addEventListener("click", onDetectSilences);
  document.getElementById("btn-remove-silences").addEventListener("click", onRemoveSilences);
  document.getElementById("btn-mark-silences").addEventListener("click", onMarkSilencesOnly);
}

function onGetSelectedClip() {
  var btn = document.getElementById("btn-get-selected-clip");
  btn.disabled = true;
  btn.textContent = "Reading\u2026";

  cs.evalScript("getSelectedClipInfo()", function (result) {
    btn.disabled = false;
    btn.textContent = "\uD83D\uDCC4 Get Selected Clip";
    try {
      var r = JSON.parse(result);
      if (!r.success) {
        showNotice(r.error || "No clip selected.", "error");
        return;
      }

      selectedClipState.info = r;
      selectedClipState.silences = [];
      selectedClipState.approvedSilences = {};

      document.getElementById("selected-clip-name").textContent = r.name;
      document.getElementById("selected-clip-tc").textContent =
        formatSeconds(r.start_seconds || 0) + " \u2014 " + formatSeconds(r.end_seconds || 0) +
        " (" + (r.duration_seconds || 0).toFixed(1) + "s)";

      // Pre-fill job ID from current session if available
      if (state.jobId) {
        document.getElementById("silence-job-id").value = state.jobId;
      }

      document.getElementById("selected-clip-info").style.display = "block";
      document.getElementById("silence-result").style.display = "none";
      showNotice("Clip loaded: " + r.name, "success");
    } catch (e) {
      showNotice("Error reading clip: " + e.message, "error");
    }
  });
}

function onDetectSilences() {
  if (!selectedClipState.info) return showNotice("Get a selected clip first.", "error");

  var jobId = document.getElementById("silence-job-id").value.trim() || state.jobId;
  if (!jobId) return showNotice("Enter a Transcript Job ID (run transcription first).", "error");

  var clipIn = selectedClipState.info.start_seconds;
  var clipOut = selectedClipState.info.end_seconds;

  var btn = document.getElementById("btn-detect-silences");
  btn.disabled = true;
  btn.textContent = "Detecting\u2026";

  API.detectSilences(jobId, clipIn, clipOut, 0.4)
    .then(function (r) {
      btn.disabled = false;
      btn.textContent = "\uD83D\uDD0A Detect Silences in Clip";

      selectedClipState.silences = r.silences || [];
      selectedClipState.approvedSilences = {};
      (r.silences || []).forEach(function (_s, idx) { selectedClipState.approvedSilences[idx] = true; });

      if (!r.total_silences) {
        showNotice("No silences found in this clip (threshold: 0.4s).", "info");
        document.getElementById("silence-result").style.display = "none";
        return;
      }

      document.getElementById("silence-summary").textContent =
        r.total_silences + " silence(s) found \u2014 " + (r.total_silence_duration_seconds || 0).toFixed(1) + "s total";

      renderSilenceList(r.silences);
      document.getElementById("silence-result").style.display = "block";
      showNotice(r.total_silences + " silences detected.", "success");
    })
    .catch(function (e) {
      btn.disabled = false;
      btn.textContent = "\uD83D\uDD0A Detect Silences in Clip";
      showNotice("Detection failed: " + e.message, "error");
    });
}

function renderSilenceList(silences) {
  var list = document.getElementById("silence-list");
  list.innerHTML = "";

  silences.forEach(function (s, idx) {
    var item = document.createElement("div");
    item.className = "silence-item";
    item.innerHTML =
      '<input type="checkbox" checked data-idx="' + idx + '">' +
      '<div style="flex:1">' +
        '<span class="silence-tc">' + formatSeconds(s.in_seconds) + ' \u2014 ' + formatSeconds(s.out_seconds) + '</span>' +
        ' <span style="font-size:10px;color:var(--text-muted)">' + (s.duration_seconds || 0).toFixed(2) + 's</span>' +
      '</div>';

    item.querySelector("input").addEventListener("change", function () {
      selectedClipState.approvedSilences[idx] = this.checked;
    });

    list.appendChild(item);
  });
}

function onRemoveSilences() {
  var approved = selectedClipState.silences.filter(function (_s, idx) {
    return !!selectedClipState.approvedSilences[idx];
  });
  if (approved.length === 0) return showNotice("Select at least one silence to cut.", "error");

  var statusEl = document.getElementById("silence-apply-status");
  statusEl.textContent = "Cutting silences\u2026";
  statusEl.style.color = "var(--text-muted)";

  var jsonStr = JSON.stringify(approved)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');

  cs.evalScript('removeClipSilences("' + jsonStr + '")', function (result) {
    try {
      var r = JSON.parse(result);
      if (r.success) {
        var msg = (r.applied || 0) + " silence cut(s) applied. " + (r.markers_added || 0) + " marker(s) added.";
        if (r.errors && r.errors.length) msg += " (" + r.errors.length + " warning(s))";
        statusEl.textContent = msg;
        statusEl.style.color = "var(--success)";
        showNotice(msg, "success");
      } else {
        statusEl.textContent = "Error: " + (r.error || "unknown");
        statusEl.style.color = "var(--error)";
      }
    } catch (e) {
      statusEl.textContent = "Parse error: " + e.message;
    }
  });
}

function onMarkSilencesOnly() {
  var silences = selectedClipState.silences;
  if (!silences || silences.length === 0) return showNotice("Detect silences first.", "error");

  var statusEl = document.getElementById("silence-apply-status");
  statusEl.textContent = "Adding silence markers\u2026";
  statusEl.style.color = "var(--text-muted)";

  // Use removeClipSilences but the cuts will just add markers (silences are short, tolerated)
  var jsonStr = JSON.stringify(silences)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');

  // Only add markers — pass an empty array for cuts, add markers manually via the same function
  // (removeClipSilences always adds orange markers regardless of cut success)
  cs.evalScript('removeClipSilences("' + jsonStr + '")', function (result) {
    try {
      var r = JSON.parse(result);
      var msg = (r.markers_added || 0) + " silence marker(s) added to timeline.";
      statusEl.textContent = msg;
      statusEl.style.color = "var(--success)";
      showNotice(msg, "success");
    } catch (e) {
      statusEl.textContent = "Error: " + e.message;
    }
  });
}

/* ─────────────────────────────────────────
   Auto-update
───────────────────────────────────────── */

function checkForUpdates() {
  API.health()
    .then(function (r) {
      var backendVersion = r.version;
      if (!backendVersion) return;

      var installedVersion = localStorage.getItem("istv_installed_version");
      if (!installedVersion) {
        // First run — record what's installed now, no banner
        localStorage.setItem("istv_installed_version", backendVersion);
        return;
      }
      if (backendVersion !== installedVersion) {
        _showUpdateBanner(backendVersion);
      }
    })
    .catch(function () { /* backend not reachable — silently ignore */ });
}

function _showUpdateBanner(newVersion) {
  var banner = document.getElementById("update-banner");
  document.getElementById("update-banner-text").textContent =
    "\u2B06\uFE0F Plugin update available (v" + newVersion + ") \u2014 click to install";
  banner.style.display = "flex";

  document.getElementById("btn-update-now").onclick = function () { onUpdatePlugin(); };
  document.getElementById("btn-update-dismiss").onclick = function () {
    // Dismiss until the next version
    localStorage.setItem("istv_installed_version", newVersion);
    banner.style.display = "none";
  };
}

function onUpdatePlugin() {
  var btn = document.getElementById("btn-update-now");
  btn.disabled = true;
  btn.textContent = "Updating\u2026";

  cs.evalScript("getPluginPath()", function (result) {
    try {
      var r = JSON.parse(result);
      if (!r.success) {
        showNotice("Cannot locate plugin folder: " + r.error, "error");
        btn.disabled = false;
        btn.textContent = "\u2191 Update Now";
        return;
      }
      var pluginPath = r.path;

      var xhr = new XMLHttpRequest();
      xhr.open("GET", API.getBaseUrl() + "/api/plugin/update", true);
      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            var data = JSON.parse(xhr.responseText);
            _applyPluginUpdate(pluginPath, data.files, data.version, btn);
          } catch (e) {
            showNotice("Update data error: " + e.message, "error");
            btn.disabled = false;
            btn.textContent = "\u2191 Update Now";
          }
        } else {
          showNotice("Update download failed (HTTP " + xhr.status + ")", "error");
          btn.disabled = false;
          btn.textContent = "\u2191 Update Now";
        }
      };
      xhr.onerror = function () {
        showNotice("Update failed — backend unreachable.", "error");
        btn.disabled = false;
        btn.textContent = "\u2191 Update Now";
      };
      xhr.send();
    } catch (e) {
      showNotice("Update error: " + e.message, "error");
      btn.disabled = false;
      btn.textContent = "\u2191 Update Now";
    }
  });
}

function _applyPluginUpdate(pluginPath, files, newVersion, btn) {
  var basePath = pluginPath.replace(/\\/g, "/").replace(/\/$/, "");
  var fileList = Object.keys(files);
  var errors = [];

  function writeNext(idx) {
    if (idx >= fileList.length) {
      localStorage.setItem("istv_installed_version", newVersion);
      document.getElementById("update-banner").style.display = "none";
      var msg = errors.length
        ? "Update applied (" + errors.length + " warning(s)). Reload the panel to activate."
        : "Update installed! Close and reopen the panel (or press F5) to activate.";
      showNotice(msg, errors.length ? "warning" : "success");
      btn.disabled = false;
      btn.textContent = "\u2191 Update Now";
      return;
    }

    var relPath = fileList[idx];
    var nativePath = (basePath + "/" + relPath).replace(/\//g, "\\");
    var content = files[relPath];

    // Escape for embedding in an evalScript string argument
    var escaped = content
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\r/g, "")
      .replace(/\n/g, "\\n");

    cs.evalScript('writeTextFile("' + nativePath + '", "' + escaped + '")', function (res) {
      try {
        var wr = JSON.parse(res);
        if (!wr.success) errors.push(relPath + ": " + wr.error);
      } catch (e) {
        errors.push(relPath + ": parse error");
      }
      writeNext(idx + 1);
    });
  }

  writeNext(0);
}

/* ─────────────────────────────────────────
   Utility helpers
───────────────────────────────────────── */
function formatSeconds(sec) {
  var h = Math.floor(sec / 3600);
  var m = Math.floor((sec % 3600) / 60);
  var s = Math.floor(sec % 60);
  return (h > 0 ? pad2(h) + ":" : "") + pad2(m) + ":" + pad2(s);
}

function pad2(n) { return n < 10 ? "0" + n : "" + n; }

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ─────────────────────────────────────────
   UI helpers
───────────────────────────────────────── */
function setStage(stage) {
  state.stage = stage;
  var stages = ["idle", "uploading", "compressing", "transcribing", "ready", "generating", "done"];
  stages.forEach(function (s) {
    document.body.classList.toggle("stage-" + s, s === stage);
  });

  document.getElementById("btn-upload").disabled = (stage !== "idle");
  document.getElementById("btn-generate").disabled = (stage !== "ready" && stage !== "done");

  var stageLabels = {
    idle: "Idle — select a file",
    uploading: "Uploading…",
    compressing: "Compressing audio…",
    transcribing: "Transcribing…",
    ready: "Ready to generate",
    generating: "Generating…",
    done: "Done"
  };
  document.getElementById("stage-label").textContent = stageLabels[stage] || stage;
}

function updateProgress(pct, label) {
  var bar = document.getElementById("progress-bar");
  var lbl = document.getElementById("progress-label");
  if (pct >= 0) {
    bar.style.width = pct + "%";
    bar.style.transition = "width 0.3s";
  } else {
    // Indeterminate — animate via CSS class
    bar.style.width = "100%";
  }
  bar.classList.toggle("indeterminate", pct < 0);
  if (lbl && label) lbl.textContent = label;
}

function showNotice(msg, type) {
  var el = document.getElementById("notice");
  el.textContent = msg;
  el.className = "notice notice-" + (type || "info");
  el.style.display = "block";
  if (type !== "error") {
    setTimeout(function () { el.style.display = "none"; }, 5000);
  }
}
