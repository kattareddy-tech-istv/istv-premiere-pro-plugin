function lower(s) {
  return (s || "").toLowerCase();
}

export function parseApiError(raw) {
  const text =
    raw instanceof Error ? raw.message : typeof raw === "string" ? raw : raw == null ? "" : String(raw);
  const t = text.trim() || "Something went wrong.";
  const l = lower(t);

  let title = "Error";
  let hint =
    "If this keeps happening, check that the backend is running and your network connection is stable.";

  if (l.includes("network") || l.includes("fetch") || l.includes("failed to fetch")) {
    title = "Connection problem";
    hint =
      "The app could not reach the server. Confirm the API URL (VITE_API_URL on Vercel) and that the Render backend is up.";
  } else if (l.includes("404") || l.includes("not found")) {
    title = "Not found";
    hint = "The resource may have expired, or the backend path is wrong. Try re-uploading or refreshing.";
  } else if (l.includes("401") || l.includes("403")) {
    title = "Access denied";
    hint = "Check API keys and backend environment variables on the server.";
  } else if (l.includes("422")) {
    title = "Invalid request";
    hint = "The server could not process the input. Check file format and required fields.";
  } else if (l.includes("500") || l.includes("compression failed") || l.includes("ai generation")) {
    title = "Server error";
    hint = "Check Render logs and environment variables (Rev AI, Anthropic, etc.).";
  } else if (l.includes("rev") || l.includes("transcription")) {
    title = "Transcription issue";
    hint = "Verify REV_AI_TOKEN on the backend and Rev AI account status.";
  } else if (l.includes("rate") || l.includes("429") || l.includes("quota")) {
    title = "Rate limit";
    hint = "Too many requests at once. Wait a moment or try a smaller model; consider raising API tier limits.";
  } else if (l.includes("ffmpeg")) {
    title = "Audio processing";
    hint = "FFmpeg could not process this file. Try a supported format (WAV/MP3) or a shorter clip.";
  }

  return { title, message: t, hint, raw: t };
}
