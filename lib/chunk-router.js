'use strict';

/**
 * Chunk router (v2.0).
 *
 * Picks the cheapest capable model for a chunk from the discovered pool.
 * Applies telemetry-based penalties so bad model+chunk combinations are
 * deprioritized over time.
 *
 * CommonJS, 'use strict', var.
 */

var chunkModels = require('./chunk-models');
var telemetry = require('./chunk-telemetry');
var modelPolicy = require('./model-policy');

function applyTelemetryPenalty(pool, chunkType, scope) {
  var stats = telemetry.getStatsForChunkType(chunkType, scope);
  if (!stats || !stats.length) return pool;

  var penalized = [];
  for (var i = 0; i < pool.length; i++) {
    var spec = pool[i];
    var name = chunkModels.formatModelName(spec);
    var record = stats.find(function(s) { return s.model === name; });
    var penalty = 0;
    if (record && record.quality_attempts >= 3) {
      // Rate limits are availability failures and never lower a model's quality score.
      var successRate = record.quality_successful / record.quality_attempts;
      if (successRate < 0.5) penalty += 0.01;
      if (successRate < 0.25) penalty += 0.02;
      if (record.confidence === 'legacy') penalty *= 0.25;
    }
    penalized.push(Object.assign({}, spec, { effective_cost: (spec.cost || 0) + penalty }));
  }

  penalized.sort(function(a, b) {
    return a.effective_cost - b.effective_cost;
  });

  return penalized;
}

async function resolveChunkModel(opts) {
  opts = opts || {};
  var effort = opts.effort || 'standard';
  var chunkType = opts.chunkType || opts.persona || 'general';
  var budget = opts.budget || 'auto';
  var config = opts.config || chunkModels.loadConfig();

  var pool = await chunkModels.discoverPool({ config: config });
  var filtered = chunkModels.filterPool(pool, { effort: effort, budget: budget });
  var ranked = applyTelemetryPenalty(filtered, chunkType, {
    persona: opts.persona,
    effort: effort,
    taskType: opts.taskType || chunkType,
    outputFormat: opts.outputFormat,
  });
  var prioritized = modelPolicy.prioritizePool(ranked, {
    persona: opts.persona,
    effort: effort,
    config: config,
    explicitProvider: opts.explicitProvider,
    explicitModel: opts.explicitModel,
  });
  ranked = prioritized.pool;

  if (!ranked.length) {
    throw new Error('No chunk model available for effort=' + effort + ' budget=' + budget);
  }

  return {
    ranked: ranked,
    selected: ranked[0],
    policy: prioritized.policy,
  };
}

module.exports = {
  resolveChunkModel: resolveChunkModel,
  applyTelemetryPenalty: applyTelemetryPenalty,
};
