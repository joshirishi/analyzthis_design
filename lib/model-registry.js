'use strict';

/**
 * Canonical model metadata. Prices are USD per one million tokens.
 * User-defined pool entries remain supported through normalizeSpec().
 */

var MODELS = [
  { provider: 'groq', model: 'llama-3.1-8b-instant', input_per_m: 0.05, output_per_m: 0.08, effort: ['trivial', 'standard'], context: 131072, key_env: 'GROQ_API_KEY' },
  { provider: 'groq', model: 'mixtral-8x7b-32768', input_per_m: 0.24, output_per_m: 0.24, effort: ['trivial', 'standard', 'hard'], context: 32768, key_env: 'GROQ_API_KEY' },
  { provider: 'google', model: 'gemini-1.5-flash', input_per_m: 0.075, output_per_m: 0.30, effort: ['trivial', 'standard', 'hard'], context: 128000, key_env: 'GEMINI_API_KEY' },
  { provider: 'google', model: 'gemini-1.5-flash-8b', input_per_m: 0.0375, output_per_m: 0.15, effort: ['trivial', 'standard'], context: 128000, key_env: 'GEMINI_API_KEY' },
  { provider: 'google', model: 'gemini-2.5-flash', input_per_m: 0.30, output_per_m: 2.50, effort: ['trivial', 'standard', 'hard'], context: 1000000, key_env: 'GEMINI_API_KEY' },
  { provider: 'deepseek', model: 'deepseek-chat', input_per_m: 0.07, output_per_m: 0.27, effort: ['trivial', 'standard', 'hard'], context: 64000, key_env: 'DEEPSEEK_API_KEY' },
  { provider: 'openrouter', model: 'meta-llama/llama-3.1-8b-instruct:free', input_per_m: 0, output_per_m: 0, effort: ['trivial', 'standard'], context: 131072, key_env: 'OPENROUTER_API_KEY' },
  { provider: 'together', model: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo', input_per_m: 0.18, output_per_m: 0.18, effort: ['trivial', 'standard'], context: 8192, key_env: 'TOGETHER_API_KEY' },
  { provider: 'openai', model: 'gpt-4o-mini', input_per_m: 0.15, output_per_m: 0.60, effort: ['trivial', 'standard'], context: 128000, key_env: 'OPENAI_API_KEY' },
  { provider: 'anthropic', model: 'claude-sonnet-4-20250514', input_per_m: 3, output_per_m: 15, effort: ['standard', 'hard'], context: 200000, key_env: 'ANTHROPIC_API_KEY' },
];

function id(spec) {
  return String(spec.provider || '') + '/' + String(spec.model || '');
}

function normalizeSpec(spec) {
  spec = Object.assign({}, spec || {});
  var canonical = MODELS.find(function(item) {
    return item.provider === spec.provider && item.model === spec.model;
  }) || {};
  var merged = Object.assign({}, canonical, spec);
  if (merged.input_per_m == null && merged.cost != null) {
    // v2.5.2 scalar costs were stored in per-1K units despite their comment.
    merged.input_per_m = Number(merged.cost) * 1000;
  }
  if (merged.output_per_m == null && merged.cost != null) {
    merged.output_per_m = Number(merged.cost) * 1000;
  }
  merged.input_per_m = Number(merged.input_per_m || 0);
  merged.output_per_m = Number(merged.output_per_m || 0);
  merged.cost = Math.max(merged.input_per_m, merged.output_per_m) / 1000;
  merged.id = id(merged);
  return merged;
}

function estimateCost(spec, inputTokens, outputTokens) {
  spec = normalizeSpec(spec);
  return (Number(inputTokens || 0) / 1e6) * spec.input_per_m +
    (Number(outputTokens || 0) / 1e6) * spec.output_per_m;
}

function find(provider, model) {
  var found = MODELS.find(function(item) {
    return item.provider === provider && item.model === model;
  });
  return found ? normalizeSpec(found) : null;
}

function isExpired(spec, now) {
  if (!spec || !spec.expires_at) return false;
  return new Date(spec.expires_at).getTime() <= (now || Date.now());
}

module.exports = {
  VERSION: 1,
  MODELS: MODELS,
  id: id,
  find: find,
  normalizeSpec: normalizeSpec,
  estimateCost: estimateCost,
  isExpired: isExpired,
};
