'use strict';

/**
 * Chunk synthesis (v2.0).
 *
 * Merges chunk outputs into a final verdict. Uses the cheapest capable model
 * from the chunk pool. Escalates to the planner-tier model if outputs
 * contradict or if chunk success rate is low.
 *
 * CommonJS, 'use strict', var.
 */

var chunkModels = require('./chunk-models');
var chunkRouter = require('./chunk-router');
var synthesis = require('./synthesis');

function buildSynthesisPrompt(plan, results, contextPack) {
  var lines = [
    'You are the synthesis engine. Merge the following persona chunk outputs into a final verdict.',
    '',
    'Task: ' + (contextPack.task || plan.task_summary || ''),
    '',
    'Chunk outputs:',
  ];

  for (var i = 0; i < results.length; i++) {
    var r = results[i];
    lines.push('--- ' + r.chunk_id + ' (' + r.persona + ') ---');
    lines.push(r.output.slice(0, 1200));
  }

  lines.push('',
    'Produce:',
    '- Verdict: SHIP | REVISE | BLOCK',
    '- Composite score out of 5 if applicable',
    '- Top 3 actionable changes',
    '- Brief reasoning',
    '',
    'Use the same format as the design-critic synthesis.'
  );

  return {
    system: 'You synthesize multi-persona design critique outputs. Be concise and cite the most important conflicts.',
    user: lines.join('\n'),
  };
}

function hasContradictions(results) {
  var verdicts = [];
  for (var i = 0; i < results.length; i++) {
    var v = results[i].structured_output && results[i].structured_output.verdict;
    if (v) verdicts.push(v);
  }
  if (verdicts.length < 2) return false;
  var allSame = verdicts.every(function(v) { return v === verdicts[0]; });
  return !allSame;
}

async function synthesize(opts) {
  opts = opts || {};
  var plan = opts.plan;
  var results = opts.results || [];
  var contextPack = opts.contextPack;
  var config = opts.config || chunkModels.loadConfig();
  var budget = opts.budget || 'auto';
  var callLlmFn = opts.callLlmFn;

  if (!callLlmFn) {
    var orchestrator = require('./orchestrator/run');
    callLlmFn = orchestrator.callLlm;
  }

  var successful = results.filter(function(r) { return r.success; });
  if (!successful.length) {
    return {
      verdict: 'BLOCK',
      total: 0,
      max_total: 0,
      top3: [{ change: 'All chunk models failed', owner: 'user', reason: 'No model produced output' }],
      composite: { verdict: 'BLOCK', total: 0, max_total: 0, top3: [] },
      markdown: '## Synthesis\n\nAll chunk models failed. No verdict possible.',
      model_used: null,
      contradictions: false,
    };
  }

  var contradictions = hasContradictions(successful);
  var synChunk = plan.synthesis || { persona: 'raj', goal: 'resolve conflicts', system_prompt: '', user_prompt: '' };

  // Try cheap synthesis first.
  var prompts = buildSynthesisPrompt(plan, successful, contextPack);
  var model;
  try {
    var resolved = await chunkRouter.resolveChunkModel({
      effort: 'hard',
      chunkType: 'synthesis',
      budget: budget,
      config: config,
    });
    model = resolved.selected;
  } catch (e) {
    // Fall back to planner-tier.
    model = chunkModels.resolvePlannerModel(config);
  }

  if (contradictions) {
    // Escalate to planner-tier for arbitration.
    model = chunkModels.resolvePlannerModel(config);
  }

  var text = '';
  try {
    text = await callLlmFn({
      provider: model.provider,
      model: model.model,
      system: prompts.system,
      user: prompts.user,
      maxTokens: 1800,
      personaId: synChunk.persona || 'raj',
    });
  } catch (e) {
    // Last-resort: try to use the existing synthesis module on raw text.
    return fallbackSynthesis(successful);
  }

  var inTok = Math.ceil((prompts.system.length + prompts.user.length) / 4);
  var outTok = Math.ceil(text.length / 4);

  var syn = synthesis.buildSynthesis ? synthesis.buildSynthesis(successful) : null;
  if (!syn) syn = fallbackSynthesis(successful);

  return {
    verdict: syn.composite.verdict || 'REVISE',
    total: syn.composite.total || 0,
    max_total: syn.composite.max_total || 0,
    top3: syn.composite.top3 || [],
    composite: syn.composite,
    markdown: syn.markdown || text,
    model_used: { provider: model.provider, model: model.model, cost: model.cost },
    contradictions: contradictions,
    tokens: { input: inTok, output: outTok },
    cost: chunkModels.estimateCost(model, inTok, outTok),
  };
}

function fallbackSynthesis(results) {
  var lines = ['## Synthesis\n'];
  var verdict = 'REVISE';
  var score = 0;
  var count = 0;
  for (var i = 0; i < results.length; i++) {
    var r = results[i];
    lines.push('### ' + r.persona);
    lines.push(r.output.slice(0, 500));
    if (r.structured_output && r.structured_output.score) {
      score += r.structured_output.score;
      count++;
    }
    if (r.structured_output && r.structured_output.verdict) {
      if (r.structured_output.verdict === 'BLOCK') verdict = 'BLOCK';
      else if (r.structured_output.verdict === 'REVISE' && verdict === 'SHIP') verdict = 'REVISE';
    }
  }
  var avgScore = count ? (score / count) : 0;
  lines.push('', '**Verdict:** ' + verdict, '**Score:** ' + avgScore.toFixed(1) + '/5');
  return {
    composite: { verdict: verdict, total: Math.round(avgScore), max_total: 5, top3: [] },
    markdown: lines.join('\n'),
  };
}

module.exports = {
  synthesize: synthesize,
  buildSynthesisPrompt: buildSynthesisPrompt,
  hasContradictions: hasContradictions,
};
