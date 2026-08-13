'use strict';

/**
 * Chunk model pool (v2.0).
 *
 * Discovers local Ollama models, maintains a curated list of cloud
 * free/cheap models, and filters by effort, budget, and available API keys.
 *
 * CommonJS, 'use strict', var, try/catch around JSON — compatible with the
 * Llama 30B safety settings used elsewhere in this repo.
 */

var fs = require('fs');
var path = require('path');
var os = require('os');
var http = require('http');

var CONFIG_FILE = path.join(os.homedir(), '.analyzthis_design', 'config.json');

function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
  catch (e) { return {}; }
}

function hasEnv(name) {
  return !!process.env[name];
}

// Curated cloud models. Prices are estimates (USD per 1M tokens input/output).
// The router treats cost=0 as free; anything >0 as cheap/paid.
var DEFAULT_CLOUD_POOL = [
  // Free-ish / very cheap with user key
  { provider: 'groq', model: 'llama-3.1-8b-instant', cost: 0.00005, effort: ['trivial', 'standard'], context: 131072, key_env: 'GROQ_API_KEY' },
  { provider: 'groq', model: 'mixtral-8x7b-32768', cost: 0.00024, effort: ['trivial', 'standard', 'hard'], context: 32768, key_env: 'GROQ_API_KEY' },
  { provider: 'google', model: 'gemini-1.5-flash', cost: 0.000075, effort: ['trivial', 'standard', 'hard'], context: 128000, key_env: 'GEMINI_API_KEY' },
  { provider: 'google', model: 'gemini-1.5-flash-8b', cost: 0.0000375, effort: ['trivial', 'standard'], context: 128000, key_env: 'GEMINI_API_KEY' },
  { provider: 'deepseek', model: 'deepseek-chat', cost: 0.00007, effort: ['trivial', 'standard', 'hard'], context: 64000, key_env: 'DEEPSEEK_API_KEY' },
  { provider: 'openrouter', model: 'meta-llama/llama-3.1-8b-instruct:free', cost: 0, effort: ['trivial', 'standard'], context: 131072, key_env: 'OPENROUTER_API_KEY' },
  { provider: 'together', model: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo', cost: 0.00018, effort: ['trivial', 'standard'], context: 8192, key_env: 'TOGETHER_API_KEY' },
  // Paid but cheap fallback
  { provider: 'openai', model: 'gpt-4o-mini', cost: 0.00015, effort: ['trivial', 'standard'], context: 128000, key_env: 'OPENAI_API_KEY' },
  // Frontier chunk fallback (only if budget allows)
  { provider: 'anthropic', model: 'claude-sonnet-4-20250514', cost: 0.003, effort: ['standard', 'hard'], context: 200000, key_env: 'ANTHROPIC_API_KEY' },
];

// Recommended Ollama models for chunk tasks, ordered by capability/cost trade-off.
var DEFAULT_OLLAMA_MODELS = [
  { provider: 'ollama', model: 'llama3.1', cost: 0, effort: ['trivial', 'standard'], context: 8192 },
  { provider: 'ollama', model: 'mistral', cost: 0, effort: ['trivial', 'standard'], context: 8192 },
  { provider: 'ollama', model: 'qwen2.5', cost: 0, effort: ['trivial', 'standard', 'hard'], context: 128000 },
  { provider: 'ollama', model: 'gemma3:4b', cost: 0, effort: ['trivial', 'standard'], context: 8192 },
  { provider: 'ollama', model: 'phi4', cost: 0, effort: ['trivial', 'standard'], context: 8192 },
];

function detectOllama(baseUrl) {
  baseUrl = baseUrl || 'http://localhost:11434';
  return new Promise(function(resolve) {
    var url = new URL('/api/tags', baseUrl);
    var lib = url.protocol === 'https:' ? require('https') : http;
    var req = lib.get(url.toString(), { timeout: 1500 }, function(res) {
      var chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() {
        if (res.statusCode !== 200) { resolve([]); return; }
        try {
          var data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          var models = (data.models || []).map(function(m) { return m.name || m.model; });
          resolve(models);
        } catch (e) { resolve([]); }
      });
    });
    req.on('error', function() { resolve([]); });
    req.on('timeout', function() { req.destroy(); resolve([]); });
  });
}

function filterOllamaModels(available) {
  var result = [];
  for (var i = 0; i < DEFAULT_OLLAMA_MODELS.length; i++) {
    var spec = DEFAULT_OLLAMA_MODELS[i];
    for (var j = 0; j < available.length; j++) {
      var name = available[j];
      // Accept exact match or prefix match (e.g. "llama3.1:latest" matches "llama3.1")
      if (name === spec.model || name.indexOf(spec.model + ':') === 0) {
        result.push(Object.assign({}, spec, { model: name }));
        break;
      }
    }
  }
  return result;
}

function isKeyAvailable(spec) {
  if (!spec.key_env) return true;
  return hasEnv(spec.key_env);
}

function getUserPool(config) {
  var cfg = config.chunk_models || config.chunkModels || {};
  if (cfg.pool && cfg.pool.length) return cfg.pool;
  return null;
}

async function discoverPool(opts) {
  opts = opts || {};
  var config = opts.config || loadConfig();
  var ollamaBase = (config.ollama && config.ollama.base_url) || 'http://localhost:11434';
  var ollamaEnabled = !config.ollama || config.ollama.enabled !== false;

  var pool = [];

  if (ollamaEnabled) {
    var available = await detectOllama(ollamaBase);
    var ollamaModels = filterOllamaModels(available);
    if (ollamaModels.length === 0 && available.length) {
      // Fallback: use whatever Ollama has, treating all as standard effort.
      for (var a = 0; a < available.length; a++) {
        if (available[a].indexOf('embed') !== -1) continue;
        ollamaModels.push({ provider: 'ollama', model: available[a], cost: 0, effort: ['trivial', 'standard'], context: 8192 });
      }
    }
    pool = pool.concat(ollamaModels);
  }

  var userPool = getUserPool(config);
  pool = pool.concat(userPool || DEFAULT_CLOUD_POOL);

  return pool;
}

function filterPool(pool, opts) {
  opts = opts || {};
  var effort = opts.effort || 'standard';
  var budget = opts.budget || 'auto'; // free, cheap, auto
  var result = [];

  for (var i = 0; i < pool.length; i++) {
    var spec = pool[i];
    if (spec.effort && spec.effort.indexOf(effort) === -1) continue;
    if (!isKeyAvailable(spec)) continue;

    if (budget === 'free' && spec.cost > 0) continue;
    if (budget === 'cheap' && spec.cost > 0.001) continue; // exclude frontier

    result.push(spec);
  }

  result.sort(function(a, b) {
    if (a.cost !== b.cost) return a.cost - b.cost;
    if (a.context !== b.context) return b.context - a.context;
    return 0;
  });

  return result;
}

function resolvePlannerModel(config) {
  config = config || loadConfig();
  var cfg = config.chunk_models || config.chunkModels || {};

  if (cfg.planner && cfg.planner.provider) {
    var spec = cfg.planner;
    if (spec.provider === 'host') return { provider: 'host', model: spec.model || 'devi' };
    if (isKeyAvailable({ key_env: keyEnvForProvider(spec.provider) })) return Object.assign({}, spec, { cost: spec.cost == null ? 0.003 : spec.cost });
  }

  // Frontier preference order.
  var frontier = [
    { provider: 'anthropic', model: 'claude-sonnet-4-20250514', key_env: 'ANTHROPIC_API_KEY' },
    { provider: 'openai', model: 'gpt-4o', key_env: 'OPENAI_API_KEY' },
    { provider: 'google', model: 'gemini-1.5-pro', key_env: 'GEMINI_API_KEY' },
    { provider: 'zai', model: 'glm-4.5-flash', key_env: 'ZAI_API_KEY' },
  ];
  for (var i = 0; i < frontier.length; i++) {
    if (isKeyAvailable(frontier[i])) return Object.assign({ cost: 0.003 }, frontier[i]);
  }

  // Fallback: host/Devi, with a warning that planner quality may degrade.
  return { provider: 'host', model: 'devi', cost: 0, fallback_warning: true };
}

function resolveSynthesisModel(pool, opts) {
  opts = opts || {};
  var effort = opts.effort || 'standard';
  var ranked = filterPool(pool, { effort: effort, budget: opts.budget || 'auto' });
  if (ranked.length) return ranked[0];
  // Fallback to planner-tier if no chunk model available.
  return resolvePlannerModel(opts.config);
}

function keyEnvForProvider(provider) {
  var map = {
    anthropic: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
    google: 'GEMINI_API_KEY',
    zai: 'ZAI_API_KEY',
    groq: 'GROQ_API_KEY',
    together: 'TOGETHER_API_KEY',
    openrouter: 'OPENROUTER_API_KEY',
    deepseek: 'DEEPSEEK_API_KEY',
  };
  return map[provider];
}

function formatModelName(spec) {
  return spec.provider + '/' + spec.model;
}

function estimateCost(spec, inputTokens, outputTokens) {
  var cost = spec.cost || 0;
  if (cost <= 0) return 0;
  return (inputTokens / 1e6 + outputTokens / 1e6) * cost;
}

module.exports = {
  DEFAULT_CLOUD_POOL: DEFAULT_CLOUD_POOL,
  DEFAULT_OLLAMA_MODELS: DEFAULT_OLLAMA_MODELS,
  discoverPool: discoverPool,
  filterPool: filterPool,
  resolvePlannerModel: resolvePlannerModel,
  resolveSynthesisModel: resolveSynthesisModel,
  isKeyAvailable: isKeyAvailable,
  keyEnvForProvider: keyEnvForProvider,
  formatModelName: formatModelName,
  estimateCost: estimateCost,
  detectOllama: detectOllama,
};
