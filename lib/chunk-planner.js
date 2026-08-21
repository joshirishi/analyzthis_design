'use strict';

/**
 * Chunk planner (v2.0).
 *
 * Uses a frontier/strong model to produce a chunked execution plan:
 * - persona per chunk
 * - chunk goal
 * - system/user prompts for the chunk
 * - effort level
 * - dependencies
 * - output schema
 *
 * If no frontier API key is available, falls back to the host/Devi model
 * with a warning that planner quality may degrade.
 *
 * CommonJS, 'use strict', var, try/catch around JSON.
 */

var fs = require('fs');
var path = require('path');
var os = require('os');
var session = require('./session');
var knowledge = require('./knowledge');
var chunkModels = require('./chunk-models');
var { resolvePackageRoot } = require('./platforms');

var PACKAGE_ROOT = resolvePackageRoot(__dirname);
var AGENTS_DIR = path.join(PACKAGE_ROOT, 'agents');

function loadJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch (e) { return null; }
}

var CONFIG_FILE = path.join(os.homedir(), '.analyzthis_design', 'config.json');
function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
  catch (e) { return {}; }
}

function loadManifest(id) {
  return loadJson(path.join(AGENTS_DIR, 'manifests', id + '.json'));
}

function loadSkillOrCard(id) {
  var manifest = loadManifest(id);
  if (!manifest) return '';
  var cardPath = path.join(PACKAGE_ROOT, manifest.system_card || '');
  if (cardPath && fs.existsSync(cardPath)) return fs.readFileSync(cardPath, 'utf8');
  var skillPath = path.join(PACKAGE_ROOT, manifest.system_skill || '');
  if (skillPath && fs.existsSync(skillPath)) return fs.readFileSync(skillPath, 'utf8').slice(0, 6000);
  return '';
}

function buildContextPack(state, task, figma) {
  var taskMap = (state.task_map || []).slice(0, 8);
  var kb = [];
  try {
    kb = knowledge.getPersonaSliceForPrompt(state, 'arjun');
  } catch (e) { /* ignore */ }

  // Gather available reference data for the planner so it can scope chunks
  // to personas whose CSV references are strongest for this task.
  var refHints = [];
  try {
    var refPack = require('./reference-pack');
    var keywords = refPack.extractKeywords(task);
    if (keywords.length) {
      var personas = Object.keys(refPack.REFERENCE_MAP);
      for (var i = 0; i < personas.length; i++) {
        var spec = refPack.getReferenceSpec(personas[i], state);
        if (!spec) continue;
        try {
          var result = require('./retrieve').retrieve({
            file: spec.file,
            filters: [{ column: spec.column, anyOf: keywords }],
            limit: 3,
          });
          if (result.rows.length) {
            refHints.push(personas[i] + ': ' + result.rows.length + ' rows in ' + spec.file);
          }
        } catch (e) { /* file missing */ }
      }
    }
  } catch (e) { /* reference-pack unavailable */ }

  return {
    task: task,
    figma: figma || (state.figma_node && state.figma_node.url) || '',
    task_map: taskMap,
    hierarchy_top3: (state.digest && state.digest.hierarchy_top3) || [],
    ds_at_risk: (state.digest && state.digest.ds_at_risk) || [],
    knowledge_bank_excerpt: kb.slice(0, 3).map(function(n) {
      return n.title + ': ' + n.content.slice(0, 400);
    }).join('\n\n'),
    reference_hints: refHints,
    mode: state.mode || 'assess_only',
  };
}

function plannerSystemPrompt() {
  return [
    'You are the Task Planner for a team of design personas.',
    'Your job is to break a design task into small, sequential, independently executable chunks.',
    'Each chunk targets one persona and has a clear goal, prompts, effort level, and dependencies.',
    'You must output ONLY a JSON object inside a ```json code fence.',
    '',
    'CRITICAL: Before planning chunks, evaluate whether the task premise is valid.',
    'Ask: "Are we solving the right problem?" If the premise is questionable, add a',
    'premise_check chunk (persona: raj, effort: hard) that explicitly challenges the',
    'framing. The premise_check chunk should run FIRST and its output should be',
    'available to subsequent chunks via depends_on.',
    '',
    'Also add a synthesis chunk (persona: raj, effort: hard) that runs LAST and must:',
    '1. Resolve any disagreements between personas (pick a winner, give a forward path)',
    '2. Challenge the premise if it was not already challenged',
    '3. Produce a definitive verdict — not a summary of opinions',
    '',
    'Allowed personas: arjun (UX/visual), meera (business), priya (feasibility), zara (delight), noor (minimalist IA), anuj (dense power-user), raj (strategy/arbitration).',
    '',
    'Effort levels:',
    '- trivial: simple extraction or structured scoring',
    '- standard: a full persona output block',
    '- hard: synthesis, arbitration, or ambiguous multi-constraint tasks',
    '',
    'Output schema:',
    '{',
    '  "plan_id": "short-unique-id",',
    '  "task_summary": "one-line summary",',
    '  "premise_valid": true | false | "questionable",',
    '  "premise_concern": "if questionable, what is the real problem?",',
    '  "chunks": [',
    '    {',
    '      "id": "premise_check",',
    '      "persona": "raj",',
    '      "goal": "challenge the task framing — are we solving the right problem?",',
    '      "system_prompt": "...",',
    '      "user_prompt": "...",',
    '      "effort": "hard",',
    '      "depends_on": [],',
    '      "output_schema": "premise_assessment"',
    '    },',
    '    {',
    '      "id": "arjun",',
    '      "persona": "arjun",',
    '      "goal": "...",',
    '      "system_prompt": "...",',
    '      "user_prompt": "...",',
    '      "effort": "standard",',
    '      "depends_on": ["premise_check"],',
    '      "output_schema": "ux_audit"',
    '    }',
    '  ],',
    '  "synthesis": {',
    '    "persona": "raj",',
    '    "goal": "resolve conflicts, challenge premise if needed, produce definitive verdict",',
    '    "system_prompt": "...",',
    '    "user_prompt": "..."',
    '  }',
    '}',
  ].join('\n');
}

function plannerUserPrompt(task, figma, contextPack, maxChunks) {
  return [
    'Task: ' + task,
    figma ? 'Figma: ' + figma : '',
    '',
    'Context pack:',
    JSON.stringify(contextPack, null, 2).slice(0, 4000),
    '',
    'Design a chunk plan with at most ' + maxChunks + ' chunks.',
    'Prefer sequential dependencies. Use depends_on to declare which chunk outputs are inputs.',
    'Keep each chunk focused on one persona lens.',
    '',
    'The final synthesis chunk should merge all outputs into a verdict (SHIP / REVISE / BLOCK), composite score, and Top 3 actionable changes.',
  ].join('\n');
}

function parsePlan(text) {
  var empty = {
    plan_id: '',
    task_summary: '',
    chunks: [],
    synthesis: { persona: 'raj', goal: '', system_prompt: '', user_prompt: '' }
  };
  if (!text) return { plan: empty, parse_error: 'empty' };

  var fence = text.match(/```json\s*([\s\S]*?)```/i);
  var raw = fence ? fence[1].trim() : text.trim();
  try {
    var parsed = JSON.parse(raw);
    if (!parsed.chunks || !Array.isArray(parsed.chunks)) {
      return { plan: empty, parse_error: 'missing chunks array' };
    }
    return { plan: parsed, parse_error: null };
  } catch (e) {
    return { plan: empty, parse_error: e.message };
  }
}

function topologicalSort(chunks) {
  var byId = {};
  for (var i = 0; i < chunks.length; i++) byId[chunks[i].id] = chunks[i];

  var visited = {};
  var result = [];

  function visit(id, stack) {
    if (stack.indexOf(id) !== -1) throw new Error('Circular dependency in chunk plan: ' + id);
    if (visited[id]) return;
    visited[id] = true;
    var chunk = byId[id];
    if (!chunk) throw new Error('Unknown chunk dependency: ' + id);
    var deps = chunk.depends_on || [];
    for (var j = 0; j < deps.length; j++) visit(deps[j], stack.concat([id]));
    result.push(chunk);
  }

  for (var k = 0; k < chunks.length; k++) visit(chunks[k].id, []);
  return result;
}

async function createPlan(opts) {
  opts = opts || {};
  var task = opts.task || '';
  var figma = opts.figma || '';
  var projectId = opts.project || session.getProjectId();
  var config = opts.config || loadConfig();
  var maxChunks = opts.maxChunks || (config.chunk_models && config.chunk_models.max_chunks) || 6;

  var state = session.show({ project: projectId }) || session.init({ project: projectId });
  var contextPack = buildContextPack(state, task, figma);

  var plannerModel = chunkModels.resolvePlannerModel(config);

  var hostRun = null;
  if (plannerModel.provider === 'host') {
    var existingHost = (state && state.host_run) || {};
    if (opts.continueRun && existingHost.run_dir && fs.existsSync(existingHost.run_dir)) {
      hostRun = {
        runId: existingHost.run_id,
        runDir: existingHost.run_dir,
        manifest: require('./host-llm').loadManifest(existingHost.run_dir),
      };
    } else {
      hostRun = require('./host-llm').createRun({ projectId: projectId, task: task });
      try {
        session.update({ project: projectId, patch: { host_run: { run_id: hostRun.runId, run_dir: hostRun.runDir, task: task, status: 'in_progress', last_pending: null, checkpoint: null, started_at: new Date().toISOString() } } });
      } catch (e) { /* ignore */ }
    }
  } else if (plannerModel.provider === 'ollama') {
    // Ollama needs no host run context; callLlm handles it directly.
  }

  // Reuse the most recent completed chunk-planner response when --continue is set.
  var reusedText = null;
  if (plannerModel.provider === 'host' && hostRun && hostRun.manifest && opts.continueRun) {
    var hostModule = require('./host-llm');
    var completed = (hostRun.manifest.completed_steps || []).slice().reverse();
    for (var ci = 0; ci < completed.length; ci++) {
      if (completed[ci].indexOf('chunk-planner') === -1) continue;
      try {
        reusedText = hostModule.readResponse(hostRun.runDir, completed[ci]);
        if (reusedText) break;
      } catch (e) { reusedText = null; }
    }
    // Also try the exact step the manifest points at, in case the response was
    // submitted by an external tool but the manifest was not updated.
    if (!reusedText) {
      var latestPendingId = String(hostRun.manifest.step_counter).padStart(3, '0') + '-chunk-planner';
      try {
        reusedText = hostModule.readResponse(hostRun.runDir, latestPendingId);
        if (reusedText && !hostRun.manifest.completed_steps.includes(latestPendingId)) {
          hostRun.manifest.completed_steps.push(latestPendingId);
          hostModule.saveManifest(hostRun.runDir, hostRun.manifest);
        }
      } catch (e) { reusedText = null; }
    }
  }

  var system = plannerSystemPrompt();
  var user = plannerUserPrompt(task, figma, contextPack, maxChunks);

  var text = reusedText || '';
  var callLlmFn = opts.callLlmFn;
  if (!callLlmFn) {
    var orchestrator = require('./orchestrator/run');
    callLlmFn = orchestrator.callLlm;
  }

  if (!text) {
    try {
      text = await callLlmFn({
        provider: plannerModel.provider,
        model: plannerModel.model,
        system: system,
        user: user,
        maxTokens: 2500,
        personaId: 'chunk-planner',
        hostContext: plannerModel.provider === 'host' ? hostRun : undefined,
      });
    } catch (e) {
      if (e && e.name === 'HostLlmPendingError') {
        return {
          plan: null,
          planner_model: plannerModel,
          context_pack: contextPack,
          planner_warning: plannerModel.fallback_warning ?
            'No frontier API key found. Planner fell back to host/Devi; chunk quality depends on the host model.' : null,
          host_pending: {
            run_dir: e.runDir,
            step_id: e.stepId,
            message: 'The chunk planner prompt has been written to the host queue. Respond via /devi, then rerun with --continue.',
          },
          planner_model: plannerModel,
          planner_warning: plannerModel.fallback_warning ?
            'No frontier API key found. Planner fell back to host/Devi; chunk quality depends on the host model.' : null,
        };
      }
      throw new Error('Planner failed: ' + (e && e.message ? e.message : String(e)));
    }
  }

  var parsed = parsePlan(text);
  if (parsed.parse_error) {
    throw new Error('Planner produced invalid JSON: ' + parsed.parse_error);
  }

  var plan = parsed.plan;
  plan.chunks = topologicalSort(plan.chunks);

  return {
    plan: plan,
    planner_model: plannerModel,
    context_pack: contextPack,
    planner_warning: plannerModel.fallback_warning ?
      'No frontier API key found. Planner fell back to host/Devi; chunk quality depends on the host model.' : null,
  };
}

module.exports = {
  createPlan: createPlan,
  parsePlan: parsePlan,
  topologicalSort: topologicalSort,
  plannerSystemPrompt: plannerSystemPrompt,
  plannerUserPrompt: plannerUserPrompt,
};
