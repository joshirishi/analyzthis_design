'use strict';

/**
 * Shared model preference resolver for chunked and unchunked execution.
 * Effort/gate constraints are established by the caller before preferences.
 */

var fs = require('fs');
var path = require('path');
var os = require('os');
var crypto = require('crypto');
var registry = require('./model-registry');
var provider = require('./provider');
var platforms = require('./platforms');
var outputQuality = require('./output-quality');

var PACKAGE_ROOT = platforms.resolvePackageRoot(__dirname);
var DEFAULT_LOCAL_FILE = path.join(os.homedir(), '.analyzthis_design', 'calibration.json');
var GLOBAL_FILE = path.join(PACKAGE_ROOT, 'agents', 'model-policy.json');

function readJson(file) {
  if (!file || !fs.existsSync(file)) return {};
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { return {}; }
}

function localFile() {
  return process.env.ANALYZTHIS_CALIBRATION_FILE || DEFAULT_LOCAL_FILE;
}

function promptHash(persona) {
  var manifestPath = path.join(PACKAGE_ROOT, 'agents', 'manifests', persona + '.json');
  var manifest = readJson(manifestPath);
  var parts = [];
  [manifest.system_card, manifest.system_skill].forEach(function(relative) {
    if (!relative) return;
    var file = path.join(PACKAGE_ROOT, relative);
    if (fs.existsSync(file)) parts.push(fs.readFileSync(file));
  });
  return crypto.createHash('sha256').update(Buffer.concat(parts)).digest('hex').slice(0, 16);
}

function calibrationContract() {
  var file = path.join(PACKAGE_ROOT, 'agents', 'calibration-benchmark.json');
  var benchmark = readJson(file);
  return {
    version: benchmark.version,
    judge_policy_version: benchmark.judge_version,
    hash: Object.keys(benchmark).length
      ? crypto.createHash('sha256').update(JSON.stringify(benchmark)).digest('hex').slice(0, 16)
      : null,
  };
}

function assignmentFrom(policy, persona, effort) {
  var personas = policy.personas || policy.assignments || {};
  return personas[persona] && personas[persona][effort];
}

function eligible(spec, effort) {
  spec = registry.normalizeSpec(spec);
  if (!spec.provider || !spec.model || registry.isExpired(spec)) return false;
  if (spec.effort && spec.effort.indexOf(effort) === -1) return false;
  if (spec.provider !== 'host' && !provider.hasKey(spec.provider)) return false;
  return true;
}

function validWinner(winner, persona, effort, requireContract) {
  if (!winner || !eligible(winner, effort)) return false;
  if (requireContract) {
    var hasJudge = winner.judge_policy_version != null || winner.judge_version != null;
    if (!winner.prompt_hash || winner.validator_version == null ||
        winner.benchmark_version == null || !winner.benchmark_hash ||
        !hasJudge || !winner.expires_at) return false;
  }
  if (winner.prompt_hash && winner.prompt_hash !== promptHash(persona)) return false;
  if (winner.validator_version != null && Number(winner.validator_version) !== outputQuality.VERSION) return false;
  var contract = calibrationContract();
  if (winner.benchmark_version != null && winner.benchmark_version !== contract.version) return false;
  if (winner.benchmark_hash && winner.benchmark_hash !== contract.hash) return false;
  var judgeVersion = winner.judge_policy_version != null ? winner.judge_policy_version : winner.judge_version;
  if (judgeVersion != null && judgeVersion !== contract.judge_policy_version) return false;
  return true;
}

function resolveAssignment(opts) {
  opts = opts || {};
  var persona = opts.persona || 'general';
  var effort = opts.effort || 'standard';
  var config = opts.config || {};
  var candidates = [];

  if (opts.explicitProvider || opts.explicitModel) {
    var inferred = opts.explicitProvider;
    if (!inferred && opts.explicitModel) {
      var known = registry.MODELS.find(function(item) { return item.model === opts.explicitModel; });
      inferred = known && known.provider;
    }
    candidates.push({
      source: 'explicit',
      value: { provider: inferred, model: opts.explicitModel },
      strict: true,
    });
  }

  var pinned = assignmentFrom(config.model_policy || {}, persona, effort);
  if (!pinned && config.orchestrator && config.orchestrator.provider &&
      config.orchestrator.provider !== 'auto' && config.orchestrator.model) {
    pinned = { provider: config.orchestrator.provider, model: config.orchestrator.model };
  }
  if (pinned) candidates.push({ source: 'user_config', value: pinned, strict: false });
  candidates.push({ source: 'local_calibration', value: assignmentFrom(readJson(localFile()), persona, effort) });
  candidates.push({ source: 'package_policy', value: assignmentFrom(readJson(GLOBAL_FILE), persona, effort) });

  for (var i = 0; i < candidates.length; i++) {
    var candidate = candidates[i];
    if (!candidate.value) continue;
    var value = registry.normalizeSpec(candidate.value);
    var requireContract = candidate.source === 'local_calibration' || candidate.source === 'package_policy';
    if (validWinner(value, persona, effort, requireContract)) {
      return { spec: value, source: candidate.source, prompt_hash: promptHash(persona) };
    }
    if (candidate.strict) {
      var error = new Error('Requested model is unavailable or not eligible for effort=' + effort);
      error.code = 'INELIGIBLE_MODEL';
      throw error;
    }
  }
  return null;
}

function prioritizePool(pool, opts) {
  opts = opts || {};
  if (opts.explicitProvider && !opts.explicitModel) {
    var providerOnly = pool.filter(function(item) {
      return item.provider === opts.explicitProvider;
    });
    if (!providerOnly.length) {
      var providerError = new Error('No eligible model for requested provider: ' + opts.explicitProvider);
      providerError.code = 'INELIGIBLE_MODEL';
      throw providerError;
    }
    return { pool: providerOnly, policy: { source: 'explicit_provider' } };
  }
  var resolved = resolveAssignment(opts);
  if (!resolved) return { pool: pool, policy: null };
  var wanted = registry.id(resolved.spec);
  var index = pool.findIndex(function(item) {
    return registry.id(item) === wanted;
  });
  if (index === -1) {
    if (resolved.source === 'explicit' || resolved.source === 'user_config') {
      var error = new Error('Requested model is not in the available model pool: ' + wanted);
      error.code = 'MODEL_NOT_IN_POOL';
      throw error;
    }
    return { pool: pool, policy: null };
  }
  var ordered = pool.slice();
  var selected = ordered.splice(index, 1)[0];
  ordered.unshift(selected);
  return { pool: ordered, policy: resolved };
}

module.exports = {
  VERSION: 1,
  GLOBAL_FILE: GLOBAL_FILE,
  localFile: localFile,
  promptHash: promptHash,
  calibrationContract: calibrationContract,
  eligible: eligible,
  resolveAssignment: resolveAssignment,
  prioritizePool: prioritizePool,
};
