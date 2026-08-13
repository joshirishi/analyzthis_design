'use strict';

/**
 * Chunk run coordinator (v2.0).
 *
 * Top-level orchestrator for chunked execution. Default behavior for
 * `npx analyzthis_design run --task "..."`.
 *
 * 1. Calls the planner (frontier/host) to produce a chunk graph.
 * 2. Executes chunks sequentially by default using the cheapest model.
 * 3. Synthesizes outputs.
 * 4. Persists chunk_run to session.
 *
 * CommonJS, 'use strict', var.
 */

var fs = require('fs');
var os = require('os');
var path = require('path');

var session = require('./session');
var planner = require('./chunk-planner');
var executor = require('./chunk-executor');
var synthesis = require('./chunk-synthesis');
var chunkModels = require('./chunk-models');

var CONFIG_FILE = path.join(os.homedir(), '.analyzthis_design', 'config.json');

function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
  catch (e) { return {}; }
}

async function runChunked(opts) {
  opts = opts || {};
  var task = opts.task || '';
  var figma = opts.figma || '';
  var projectId = opts.project || session.getProjectId();
  var config = opts.config || loadConfig();
  var budget = opts.budget || (config.chunk_models && config.chunk_models.budget) || 'auto';
  var sequential = opts.sequential !== false; // default true
  var maxChunks = opts.maxChunks || (config.chunk_models && config.chunk_models.max_chunks) || 6;
  var dryRun = !!opts.dryRun;
  var callLlmFn = opts.callLlmFn;

  if (!task) throw new Error('--task is required');

  var state = session.show({ project: projectId }) || session.init({ project: projectId });

  var planResult;
  try {
    planResult = await planner.createPlan({
      task: task,
      figma: figma,
      project: projectId,
      config: config,
      maxChunks: maxChunks,
      callLlmFn: callLlmFn,
      continueRun: !!opts.continueRun,
    });
  } catch (e) {
    throw new Error('Chunk planner failed: ' + e.message);
  }

  if (planResult.host_pending) {
    return {
      project_id: projectId,
      task: task,
      host_pending: planResult.host_pending,
      planner_model: planResult.planner_model,
      planner_warning: planResult.planner_warning,
      mode: 'host_pending',
    };
  }

  if (dryRun) {
    return {
      project_id: projectId,
      task: task,
      plan: planResult.plan,
      planner_model: planResult.planner_model,
      planner_warning: planResult.planner_warning,
      mode: 'chunked_dry_run',
    };
  }

  var results = [];
  var totalCost = 0;
  var totalInput = 0;
  var totalOutput = 0;
  var modelsUsed = [];
  var failedChunks = [];
  var cacheHits = 0;

  var chunks = planResult.plan.chunks || [];

  for (var i = 0; i < chunks.length; i++) {
    var chunk = chunks[i];
    var result = await executor.executeChunk({
      chunk: chunk,
      priorResults: results,
      contextPack: planResult.context_pack,
      state: state,
      task: task,
      config: config,
      budget: budget,
      callLlmFn: callLlmFn,
    });

    results.push(result);

    if (result.success) {
      var name = chunkModels.formatModelName(result.model_used);
      if (modelsUsed.indexOf(name) === -1) modelsUsed.push(name);
      totalCost += result.cost || 0;
      totalInput += result.tokens.input;
      totalOutput += result.tokens.output;
      if (result.cache_hit) cacheHits++;
    } else {
      failedChunks.push({ id: chunk.id, error: result.error });
    }
  }

  var syn = await synthesis.synthesize({
    plan: planResult.plan,
    results: results,
    contextPack: planResult.context_pack,
    config: config,
    budget: budget,
    callLlmFn: callLlmFn,
  });

  totalCost += syn.cost || 0;
  totalInput += syn.tokens ? syn.tokens.input : 0;
  totalOutput += syn.tokens ? syn.tokens.output : 0;
  if (syn.model_used) {
    var synName = chunkModels.formatModelName(syn.model_used);
    if (modelsUsed.indexOf(synName) === -1) modelsUsed.push(synName);
  }

  var chunkRun = {
    plan: planResult.plan,
    planner_model: planResult.planner_model,
    planner_warning: planResult.planner_warning,
    results: results,
    synthesis: syn,
    total_cost: Number(totalCost.toFixed(6)),
    total_tokens: { input: totalInput, output: totalOutput },
    models_used: modelsUsed,
    failed_chunks: failedChunks,
    cache_hits: cacheHits,
    budget: budget,
    mode: sequential ? 'sequential' : 'parallel',
  };

  var final = session.update({
    project: projectId,
    patch: {
      chunk_run: chunkRun,
      task_type: state.task_type || 'chunked_run',
      mode: 'assess_only',
      digest: Object.assign({}, state.digest || {}, {
        task_map_summary: task.slice(0, 240),
        experts: chunks.map(function(c) { return c.persona; }),
        mode: 'assess_only',
      }),
      metrics: {
        llm_calls: results.length + 1, // chunks + synthesis
        experts_run: chunks.map(function(c) { return c.persona; }),
        input_tokens_est: totalInput,
        output_tokens_est: totalOutput,
        cost_usd: Number(totalCost.toFixed(6)),
        mode: 'chunked',
        cache_hits: cacheHits,
        effort_log: results.map(function(r) {
          return {
            persona: r.persona,
            effort: r.chunk ? r.chunk.effort : 'standard',
            model: r.model_used ? chunkModels.formatModelName(r.model_used) : null,
            scoped_mode: null,
          };
        }),
      },
    },
  });

  return {
    project_id: projectId,
    task: task,
    plan: planResult.plan,
    chunk_run: chunkRun,
    session: final,
  };
}

module.exports = {
  runChunked: runChunked,
};
