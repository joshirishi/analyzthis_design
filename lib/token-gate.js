'use strict';

/**
 * Output token / size enforcement for persona + host (Devi) responses.
 * ~4 chars per token (estimate). Preserves deliberation JSON fence when truncating.
 */

const CHARS_PER_TOKEN = 4;

function maxCharsForTokens(maxTokens) {
  return Math.max(200, Math.floor(Number(maxTokens) * CHARS_PER_TOKEN));
}

/**
 * Truncate persona output to max token budget. Keeps ```json deliberation block intact.
 */
function enforceOutputCap(text, maxTokens) {
  if (!text || maxTokens == null) return text || '';
  const maxChars = maxCharsForTokens(maxTokens);
  if (text.length <= maxChars) return text;

  const fenceRe = /```json\s*deliberation\s*[\s\S]*?```/i;
  const fenceMatch = text.match(fenceRe);
  if (fenceMatch) {
    const fence = fenceMatch[0];
    const fenceStart = text.indexOf(fence);
    const body = text.slice(0, fenceStart).trim();
    const bodyBudget = maxChars - fence.length - 16;
    if (bodyBudget > 80) {
      return `${body.slice(0, bodyBudget)}\n…\n${fence}`;
    }
    return fence;
  }

  return `${text.slice(0, maxChars - 20)}\n… [output capped at ~${maxTokens} tokens]`;
}

/**
 * Trim system prompt on objection rounds — cards only, hard ceiling.
 */
function enforceSystemCap(system, maxChars = 5500) {
  if (!system || system.length <= maxChars) return system;
  return `${system.slice(0, maxChars - 24)}\n… [system prompt capped]`;
}

module.exports = { enforceOutputCap, enforceSystemCap, maxCharsForTokens, CHARS_PER_TOKEN };
