'use strict';

/**
 * Chunk executor (v2.0).
 *
 * Runs a single chunk against a selected model, with one retry and fallback
 * to the next-best model. Never uses Devi/host as the primary chunk executor;
 * it is only used as a last resort if the user has no other models.
 *
 * CommonJS, 'use strict', var.
 */

var chunkModels = require('./chunk-models');
var chunkRouter = require('./chunk-router');
var telemetry = require('./chunk-telemetry');
var referencePack = require('./reference-pack');
var outputQuality = require('./output-quality');

function buildChunkPrompt(chunk, priorResults, contextPack) {
  var priorContext = '';
  var deps = chunk.depends_on || [];
  if (deps.length) {
    var lines = [];
    for (var i = 0; i < deps.length; i++) {
      var id = deps[i];
      var found = null;
      for (var j = 0; j < priorResults.length; j++) {
        if (priorResults[j].chunk_id === id) { found = priorResults[j]; break; }
      }
      if (found) {
        lines.push('--- Output from chunk "' + id + '" ---\n' + found.output.slice(0, 1500));
      }
    }
    priorContext = lines.join('\n\n');
  }

  var userParts = [chunk.user_prompt || chunk.goal];
  if (priorContext) {
    userParts.push('', 'Prior chunk outputs you must use:', priorContext);
  }
  if (contextPack) {
    userParts.push('', 'Original task context:', JSON.stringify(contextPack, null, 2).slice(0, 2000));
  }

  return {
    system: chunk.system_prompt || ('You are the ' + chunk.persona + ' persona. ' + chunk.goal),
    user: userParts.join('\n'),
  };
}

function parseStructured(text, schema) {
  var result = {
    grades: {},
    score: null,
    top_fixes: [],
    verdict: null,
    raw: text,
  };

  var scoreMatch = text.match(/(\d+(?:\.\d+)?)\s*\/\s*5/);
  if (scoreMatch) result.score = Number(scoreMatch[1]);

  var gradeMatches = text.match(/(\w+)\[([A-F])\]/gi);
  if (gradeMatches) {
    for (var g = 0; g < gradeMatches.length; g++) {
      var m = gradeMatches[g].match(/(\w+)\[([A-F])\]/i);
      if (m) result.grades[m[1].toLowerCase()] = m[2].toUpperCase();
    }
  }

  var fixesMatch = text.match(/Top\s*2\s*fixes:\s*1\.\s*([^\n]+)\s*2\.\s*([^\n]+)/i);
  if (fixesMatch) {
    result.top_fixes = [fixesMatch[1].trim(), fixesMatch[2].trim()];
  }

  var v = text.match(/verdict[\s:]*(SHIP|REVISE|BLOCK)/i);
  if (v) result.verdict = v[1].toUpperCase();

  return result;
}

async function executeChunk(opts) {
  opts = opts || {};
  var chunk = opts.chunk;
  var priorResults = opts.priorResults || [];
  var contextPack = opts.contextPack;
  var state = opts.state;
  var task = (contextPack && contextPack.task) || opts.task || '';
  var config = opts.config || chunkModels.loadConfig();
  var budget = opts.budget || 'auto';
  var callLlmFn = opts.callLlmFn;
  var attempt = 0;
  var maxAttempts = opts.maxAttempts || 3;
  var qualityFailures = 0;
  var maxQualityFailures = opts.maxQualityFailures == null ? 1 : Number(opts.maxQualityFailures);
  var outputFormat = chunk.output_schema || 'generic';

  if (!callLlmFn) {
    var orchestrator = require('./orchestrator/run');
    callLlmFn = orchestrator.callLlm;
  }

  // Build reference pack (CSV + vault slices) for this chunk's persona.
  var refPack = null;
  var cacheHit = false;
  if (state && task && chunk.persona) {
    try {
      refPack = await referencePack.buildReferencePack(chunk.persona, task, state, callLlmFn);
      if (refPack && refPack.cacheHit) cacheHit = true;
    } catch (e) { /* reference pack unavailable — continue without */ }
  }

  var ranked;
  try {
    var resolved = await chunkRouter.resolveChunkModel({
      effort: chunk.effort || 'standard',
      chunkType: chunk.id + '/' + chunk.persona,
      persona: chunk.persona,
      taskType: chunk.id,
      outputFormat: outputFormat,
      budget: budget,
      config: config,
      explicitProvider: opts.explicitProvider,
      explicitModel: opts.explicitModel,
    });
    ranked = resolved.ranked;
  } catch (e) {
    return {
      chunk_id: chunk.id,
      success: false,
      error: e.message,
      attempts: 0,
      output: '',
    };
  }

  var lastError = null;
  var modelIndex = 0;

  while (modelIndex < ranked.length && attempt < maxAttempts) {
    var model = ranked[modelIndex];
    attempt++;

    var prompts = buildChunkPrompt(chunk, priorResults, contextPack);

    // Inject ranked reference citations into the user prompt.
    if (refPack && refPack.citations && refPack.citations.length) {
      prompts.user += '\n\nRelevant references (cite these in your output):\n' +
        refPack.citations.join('\n');
    }

    var start = Date.now();
    try {
      var text = await callLlmFn({
        provider: model.provider,
        model: model.model,
        system: prompts.system,
        user: prompts.user,
        maxTokens: model.context > 16000 ? 2500 : 1200,
        personaId: chunk.persona,
      });

      var inTok = Math.ceil((prompts.system.length + prompts.user.length) / 4);
      var outTok = Math.ceil(text.length / 4);
      var quality = outputQuality.validateOutput(text, {
        persona: chunk.persona,
        outputFormat: outputFormat,
      });

      telemetry.record({
        scope_version: 1,
        chunk_id: chunk.id,
        persona: chunk.persona,
        task_type: chunk.id,
        output_format: outputFormat,
        model: chunkModels.formatModelName(model),
        provider: model.provider,
        effort: chunk.effort || 'standard',
        input_tokens: inTok,
        output_tokens: outTok,
        cost: chunkModels.estimateCost(model, inTok, outTok),
        transport_success: true,
        quality_pass: quality.pass,
        quality_score: quality.score,
        validator_version: quality.version,
        success: quality.pass,
        attempts: attempt,
        at: new Date().toISOString(),
      });

      if (!quality.pass) {
        qualityFailures++;
        lastError = 'Output quality failed: ' + quality.issues.map(function(item) {
          return item.code;
        }).join(', ');
        if (qualityFailures > maxQualityFailures) break;
        modelIndex++;
        continue;
      }

      return {
        chunk_id: chunk.id,
        persona: chunk.persona,
        goal: chunk.goal,
        effort: chunk.effort || 'standard',
        output_format: outputFormat,
        model_used: { provider: model.provider, model: model.model, cost: model.cost },
        output: text,
        full_prompt: prompts,
        structured_output: parseStructured(text, chunk.output_schema),
        tokens: { input: inTok, output: outTok },
        cost: chunkModels.estimateCost(model, inTok, outTok),
        latency_ms: Date.now() - start,
        attempts: attempt,
        cache_hit: cacheHit,
        references: (refPack && refPack.citations) || [],
        quality: quality,
        success: true,
      };
    } catch (e) {
      lastError = e.message;
      telemetry.record({
        scope_version: 1,
        chunk_id: chunk.id,
        persona: chunk.persona,
        task_type: chunk.id,
        output_format: outputFormat,
        model: chunkModels.formatModelName(model),
        provider: model.provider,
        effort: chunk.effort || 'standard',
        transport_success: false,
        quality_pass: null,
        failure_kind: outputQuality.classifyError(e),
        success: false,
        error: e.message,
        attempts: attempt,
        at: new Date().toISOString(),
      });
      modelIndex++;
    }
  }

  return {
    chunk_id: chunk.id,
    persona: chunk.persona,
    goal: chunk.goal,
    success: false,
    error: lastError || 'All chunk models failed',
    attempts: attempt,
    quality_failures: qualityFailures,
    output: '',
  };
}

module.exports = {
  executeChunk: executeChunk,
  buildChunkPrompt: buildChunkPrompt,
  parseStructured: parseStructured,
};
