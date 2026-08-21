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

  // Detect disagreements between personas for explicit arbitration.
  var disagreements = [];
  for (var a = 0; a < results.length; a++) {
    for (var b = a + 1; b < results.length; b++) {
      var va = results[a].structured_output && results[a].structured_output.verdict;
      var vb = results[b].structured_output && results[b].structured_output.verdict;
      if (va && vb && va !== vb) {
        disagreements.push(results[a].persona + ' says ' + va + ' but ' + results[b].persona + ' says ' + vb);
      }
    }
  }

  lines.push('',
    'You MUST do the following:',
    '',
    '1. RESOLVE CONFLICTS: If personas disagree on any point, pick a winner. Do not present both sides and leave it open. State which persona is correct and why, with a forward path.',
    '2. CHALLENGE THE PREMISE: Before accepting the task framing, ask: "Are we solving the right problem?" If the premise is questionable, flag it explicitly.',
    '3. Give a definitive answer — not a summary of opinions.',
    '',
    'Produce:',
    '- Premise check: Is the task framing valid? If not, what is the real problem?',
    '- Resolved conflicts: For each disagreement, who is right and why.',
    '- Verdict: SHIP | REVISE | BLOCK',
    '- Composite score out of 5 if applicable',
    '- Top 3 actionable changes (each with a specific forward path, not just "fix it")',
    '- Brief reasoning',
    '',
    'Use the same format as the design-critic synthesis.'
  );

  if (disagreements.length) {
    lines.splice(lines.indexOf('You MUST do the following:'), 0,
      'DETECTED DISAGREEMENTS (must resolve each):', '');
    for (var d = 0; d < disagreements.length; d++) {
      lines.splice(lines.indexOf('DETECTED DISAGREEMENTS'), 0, '  - ' + disagreements[d]);
    }
  }

  return {
    system: 'You synthesize multi-persona design critique outputs. You are decisive — not a summarizer. Resolve conflicts explicitly, challenge premises, and give forward paths. If personas contradict, pick a winner with reasoning.',
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
    premise_challenge: extractPremiseCheck(text),
    conflict_resolutions: extractConflictResolutions(text),
    raw_synthesis: text,
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

function extractPremiseCheck(text) {
  if (!text) return null;
  var m = text.match(/premise[\s:]*check[\s:]*([^\n]+)/i);
  if (m) return m[1].trim();
  m = text.match(/are we solving[\s\S]{0,200}/i);
  if (m) return m[0].trim();
  m = text.match(/premise[\s:]*([valid|questionable|invalid]+)/i);
  if (m) return m[0].trim();
  return null;
}

function extractConflictResolutions(text) {
  if (!text) return [];
  var resolutions = [];
  var blocks = text.split(/\n(?=\d+\.|resolve|conflict|disagree)/i);
  for (var i = 0; i < blocks.length; i++) {
    var b = blocks[i].trim();
    if (/^(resolve|conflict|disagree)/i.test(b) || /^\d+\.\s*(resolve|conflict)/i.test(b)) {
      resolutions.push(b.slice(0, 300));
    }
  }
  return resolutions;
}

module.exports = {
  synthesize: synthesize,
  buildSynthesisPrompt: buildSynthesisPrompt,
  hasContradictions: hasContradictions,
  extractPremiseCheck: extractPremiseCheck,
  extractConflictResolutions: extractConflictResolutions,
};
