'use strict';

/**
 * Resolve LLM provider — prefers explicit choice, then API keys, then host (Devi).
 */

const PROVIDERS = ['anthropic', 'openai', 'google', 'zai', 'host'];

function hasKey(provider) {
  switch (provider) {
    case 'anthropic': return !!process.env.ANTHROPIC_API_KEY;
    case 'openai': return !!process.env.OPENAI_API_KEY;
    case 'google': return !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
    case 'zai': return !!(process.env.ZAI_API_KEY || process.env.ZHIPU_API_KEY);
    case 'host': return true;
    default: return false;
  }
}

/**
 * Pick default provider for orchestrator runs.
 * @param {object} [config]
 * @param {string|null} [explicit]
 */
function resolveDefaultProvider(config, explicit) {
  if (explicit && explicit !== 'auto') return explicit;
  if (process.env.ANALYZTHIS_PROVIDER) return process.env.ANALYZTHIS_PROVIDER;

  const fromConfig = config?.orchestrator?.provider;
  if (fromConfig && fromConfig !== 'auto' && hasKey(fromConfig)) return fromConfig;

  for (const p of ['openai', 'anthropic', 'google', 'zai']) {
    if (hasKey(p)) return p;
  }
  return 'host';
}

/**
 * Map effort tier provider — fall back to host when API key missing.
 */
function resolveTierProvider(tierProvider, defaultProvider) {
  if (tierProvider === 'host') return 'host';
  if (tierProvider && hasKey(tierProvider)) return tierProvider;
  if (defaultProvider === 'host') return 'host';
  if (hasKey(defaultProvider)) return defaultProvider;
  return 'host';
}

module.exports = { PROVIDERS, hasKey, resolveDefaultProvider, resolveTierProvider };
