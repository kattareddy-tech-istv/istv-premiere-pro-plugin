/**
 * Estimate cost for a given provider/model based on estimated input tokens.
 * Assumes output ≈ 50% of input, capped at 8000 tokens.
 */
export function estimateCost(provider, model, inputTokens, pricing) {
  const p = pricing?.[provider]?.[model];
  if (!p) return 0;

  const estOutput = Math.min(Math.round(inputTokens * 0.5), 8000);
  return (inputTokens * p.input + estOutput * p.output) / 1_000_000;
}

export function formatCost(cost) {
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  if (cost < 1) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(2)}`;
}
