/**
 * api.js — Backend API client for the Premiere Pro panel.
 * Mirrors the logic in frontend/src/utils/api.js but as plain ES5-compatible JS.
 */

var API = (function () {
  "use strict";

  var _baseUrl = "http://localhost:8000";

  function setBaseUrl(url) {
    _baseUrl = url.replace(/\/$/, "");
    localStorage.setItem("istv_backend_url", _baseUrl);
  }

  function getBaseUrl() {
    var saved = localStorage.getItem("istv_backend_url");
    if (saved) _baseUrl = saved;
    return _baseUrl;
  }

  /* ── Helpers ── */

  function request(method, path, body, onProgress) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open(method, getBaseUrl() + path, true);

      if (onProgress && xhr.upload) {
        xhr.upload.onprogress = function (e) {
          if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
        };
      }

      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText));
          } catch (e) {
            resolve(xhr.responseText);
          }
        } else {
          var msg = xhr.responseText || ("HTTP " + xhr.status);
          try {
            var err = JSON.parse(msg);
            reject(new Error(err.detail || err.message || msg));
          } catch (_) {
            reject(new Error(msg));
          }
        }
      };

      xhr.onerror = function () { reject(new Error("Network error — is the backend running?")); };
      xhr.ontimeout = function () { reject(new Error("Request timed out.")); };
      xhr.timeout = 0; // No timeout for long uploads/generation

      if (body instanceof FormData) {
        xhr.send(body);
      } else if (body) {
        xhr.setRequestHeader("Content-Type", "application/json");
        xhr.send(JSON.stringify(body));
      } else {
        xhr.send();
      }
    });
  }

  /* ── Health ── */

  function health() {
    return request("GET", "/api/health");
  }

  /* ── Upload ── */

  function uploadFile(file, onProgress) {
    var fd = new FormData();
    fd.append("file", file);
    return request("POST", "/api/upload", fd, onProgress);
  }

  /* ── Transcription ── */

  function compressAudio(fileId) {
    return request("POST", "/api/transcribe/compress/" + fileId);
  }

  function startTranscription(fileId) {
    return request("POST", "/api/transcribe/start/" + fileId);
  }

  function getTranscriptionStatus(jobId) {
    return request("GET", "/api/transcribe/status/" + jobId);
  }

  function getTranscriptionResult(jobId) {
    return request("GET", "/api/transcribe/result/" + jobId);
  }

  /* ── Models ── */

  function getModels() {
    return request("GET", "/api/generate/models");
  }

  /* ── Cut Sheet ── */

  function generateCutSheet(payload) {
    return request("POST", "/api/generate/cutsheet", payload);
  }

  /* ── Premiere XML ── */

  function generatePremiereXML(payload) {
    return request("POST", "/api/generate/premiere-xml", payload);
  }

  /* ── B-Roll ── */

  function generateBroll(payload) {
    return request("POST", "/api/broll/generate", payload);
  }

  /* ── Multicam AI ── */

  function analyzeMulticam(sequenceInfo, model, customInstructions) {
    return request("POST", "/api/multicam/analyze", {
      sequence_info: sequenceInfo,
      model: model || "claude-opus-4-6",
      custom_instructions: customInstructions || ""
    });
  }

  /* ── Cut Sheet Parser ── */

  function parseCutSheet(cutsheetText, includeAlt) {
    return request("POST", "/api/generate/parse-cutsheet", {
      cutsheet_text: cutsheetText,
      include_alt: (includeAlt !== false)
    });
  }

  /* ── Silence Detection ── */

  function detectSilences(jobId, clipInSeconds, clipOutSeconds, minSilenceDuration) {
    return request("POST", "/api/multicam/detect-silences", {
      job_id: jobId,
      clip_in_seconds: clipInSeconds,
      clip_out_seconds: clipOutSeconds,
      min_silence_duration_seconds: minSilenceDuration || 0.4
    });
  }

  /* ── Documentary Formats ── */

  function getDocumentaryFormats() {
    return request("GET", "/api/generate/formats");
  }

  return {
    setBaseUrl: setBaseUrl,
    getBaseUrl: getBaseUrl,
    health: health,
    uploadFile: uploadFile,
    compressAudio: compressAudio,
    startTranscription: startTranscription,
    getTranscriptionStatus: getTranscriptionStatus,
    getTranscriptionResult: getTranscriptionResult,
    getModels: getModels,
    generateCutSheet: generateCutSheet,
    generatePremiereXML: generatePremiereXML,
    generateBroll: generateBroll,
    analyzeMulticam: analyzeMulticam,
    parseCutSheet: parseCutSheet,
    detectSilences: detectSilences,
    getDocumentaryFormats: getDocumentaryFormats
  };
})();
