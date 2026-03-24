/** Human-readable step labels — shared by PipelineStageBadge and kept in sync with StepProgress order. */

const CUTSHEET = {
  upload: "Upload",
  compress: "Compress",
  transcribe: "Transcribing",
  review: "Review transcript",
  generate: "Generating cut sheet",
  complete: "Done",
};

const BROLL = {
  upload: "Upload",
  compress: "Compress",
  transcribe: "Transcribing",
  review: "Review transcript",
  broll_generate: "Generating B-roll",
  broll_complete: "Done",
};

export function getPipelineStepLabel(pipeline, step) {
  const map = pipeline === "broll" ? BROLL : CUTSHEET;
  return map[step] || step;
}

export function getPipelineShortName(pipeline) {
  if (pipeline === "broll") return "B-Roll";
  if (pipeline === "cutsheet") return "Cut Sheet";
  return "";
}
