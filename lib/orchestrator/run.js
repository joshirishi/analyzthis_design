#!/usr/bin/env node
'use strict';

/**
 * Standalone persona orchestrator runtime (v2).
 * Loads agents/ manifests + router + chain, optionally calls an LLM per persona step.
 *
 * Usage:
 *   npx analyzthis_design run --task "..." [--figma URL] [--provider anthropic|openai|google|zai] [--dry-run]
 *   npx analyzthis_design run --task "..." --lite            # force MoE subset only (default)
 *   npx analyzthis_design run --task "..." --full             # allow the full design-critic chain
 *   npx analyzthis_design run --task "..." --deliberate --max-rounds 3 --satisfaction 0.4
 *   npx analyzthis_design run --task "..." --no-deliberate   # legacy sequential handoff
 *
 * Env / config (never committed):
 *   ANTHROPIC_API_KEY | OPENAI_API_KEY | GEMINI_API_KEY (or GOOGLE_API_KEY) | ZAI_API_KEY (or ZHIPU_API_KEY)
 *   ~/.analyzthis_design/config.json → {
 *     "orchestrator": {
 *       "provider": "anthropic",
 *       "model": "...",
 *       "mode": "lite" | "full",
 *       "tiers": { "extract": {...}, "structured": {...}, "critique": {...}, "arbitrate": {...} },
 *       "max_tokens": { "structured": 900, "critique": 1800, "arbitrate": 1200 }
 *     },
 *     "pricing": { "<model-id>": { "input_per_m": 0.30, "output_per_m": 2.50 } }
 *   }
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const https = require('https');
const session  = require('../session');
const retrieve = require('../retrieve');
const cache    = require('../cache');
const deliberation = require('../deliberation');
const lessons = require('../lessons');
const queryExpander = require('../query-expander');
const ranker = require('../ranker');
const knowledge = require('../knowledge');
const chunkRun = require('../chunk-run');
const chunkModels = require('../chunk-models');
const referencePack = require('../reference-pack');
const { callHostLlm, createRun, HostLlmPendingError, printDeviInstructions, findLatestRun, loadManifest: loadHostManifest } = require('../host-llm');
const { resolveDefaultProvider, resolveTierProvider } = require('../provider');
const synthesis = require('../synthesis');
const { enforceOutputCap, enforceSystemCap } = require('../token-gate');

// Resolve package root whether we are running from source (lib/) or published (dist/lib/)
const { resolvePackageRoot } = require('../platforms');
const PACKAGE_ROOT = resolvePackageRoot(__dirname);
const AGENTS_DIR   = path.join(PACKAGE_ROOT, 'agents');
const CONFIG_FILE  = path.join(os.homedir(), '.analyzthis_design', 'config.json');

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
  catch { return {}; }
}

function loadManifest(id) {
  const p = path.join(AGENTS_DIR, 'manifests', `${id}.json`);
  if (!fs.existsSync(p)) throw new Error(`Manifest not found: ${id}`);
  return loadJson(p);
}

function loadSkill(manifest) {
  const skillPath = path.join(PACKAGE_ROOT, manifest.system_skill);
  if (!fs.existsSync(skillPath)) return `(skill missing: ${manifest.system_skill})`;
  return fs.readFileSync(skillPath, 'utf8');
}

/**
 * Load a persona's short card (agents/cards/<id>.md) instead of its full
 * SKILL.md. Falls back to a slice of the full skill if no card exists yet.
 */
function loadCard(manifest, id) {
  if (manifest.system_card) {
    const cardPath = path.join(PACKAGE_ROOT, manifest.system_card);
    if (fs.existsSync(cardPath)) return fs.readFileSync(cardPath, 'utf8');
  }
  return loadSkill(manifest).slice(0, 4000);
}

// ─── Retrieve-on-demand reference rows (Phase 2.3) ──────────────────────────
// buildReferencePack, REFERENCE_MAP, extractKeywords, detectStack, getReferenceSpec
// are now in lib/reference-pack.js (shared with chunk-executor).
// Thin wrapper kept here for backward compat with deliberation.js callbacks.

async function buildReferencePack(id, task, state) {
  return referencePack.buildReferencePack(id, task, state, callLlm);
}

/**
 * Classify a task against every router rule whose signals hit — not just the
 * first match. Multiple rules can legitimately apply to one ask (e.g. a task
 * that mentions both "contrast" and "onboarding"), and only merging all of
 * them avoids silently dropping an expert that a single-match router would miss.
 */
function classifyProblems(task) {
  const router = loadJson(path.join(AGENTS_DIR, 'router.json'));
  const lower = (task || '').toLowerCase();
  const matched = router.rules.filter((rule) =>
    rule.signals.some((s) => lower.includes(s.toLowerCase())));
  if (matched.length === 0) {
    const fallback = router.rules.find((r) => r.problem_type === 'full_screen_review') || router.rules[0];
    return [fallback];
  }
  return matched;
}

// Back-compat single-rule accessor (first match) — prefer classifyProblems for new code.
function classifyProblem(task) {
  return classifyProblems(task)[0];
}

/**
 * Merge experts across every matched rule, then subtract the union of every
 * matched rule's never_route_to. A persona explicitly excluded by any matched
 * rule stays excluded even if another matched rule would have included it —
 * exclusions are a stronger signal than inclusions (e.g. "never Zara for contrast").
 */
function resolveExpertsForRules(rules, chain, { mode = 'lite', explicitExperts = null } = {}) {
  if (explicitExperts && explicitExperts.length) {
    return {
      experts: explicitExperts.filter((id) => fs.existsSync(path.join(AGENTS_DIR, 'manifests', `${id}.json`))),
      full_chain: false,
      ideation_chain: false,
    };
  }

  const isIdeation = rules.some((r) =>
    r.problem_type === 'ideation_wireframe' || (r.route_to || []).includes('ideation_chain'));

  if (isIdeation) {
    const seen = new Set();
    const experts = [];
    for (const step of chain.ideation_chain || []) {
      if (!seen.has(step.persona)) {
        seen.add(step.persona);
        experts.push(step.persona);
      }
    }
    return {
      experts: experts.filter((id) => fs.existsSync(path.join(AGENTS_DIR, 'manifests', `${id}.json`))),
      full_chain: false,
      ideation_chain: true,
    };
  }

  const isFullScreenReview = rules.some((r) =>
    r.problem_type === 'full_screen_review' || (r.route_to || []).includes('design-critic_chain'));

  if (isFullScreenReview && mode === 'full') {
    return { experts: chain.default_chain.map((s) => s.persona), full_chain: true, ideation_chain: false };
  }

  const experts = [];
  const neverSet = new Set();
  for (const rule of rules) {
    for (const token of rule.never_route_to || []) neverSet.add(token);
  }

  for (const rule of rules) {
    // In lite mode (the default), a full_screen_review match still resolves to
    // a bounded MoE subset (Arjun + Meera) rather than the entire default_chain.
    const routeTo = isFullScreenReview && mode !== 'full' ? ['arjun', 'meera'] : (rule.route_to || []);
    for (const token of routeTo) {
      if (token === 'design-critic_chain') continue;
      if (token === 'ds_gate' || token === 'arjun_color_system_only') {
        if (!experts.includes('arjun')) experts.push('arjun');
      } else if (token !== 'direct_noor_without_gate' && token !== 'noor_alone') {
        if (!experts.includes(token)) experts.push(token);
      }
    }
  }

  const filtered = experts.filter((id) => !neverSet.has(id));
  return {
    experts: filtered.filter((id) => fs.existsSync(path.join(AGENTS_DIR, 'manifests', `${id}.json`))),
    full_chain: false,
    ideation_chain: false,
  };
}

// Back-compat single-rule accessor.
function resolveExperts(rule) {
  const chain = loadJson(path.join(AGENTS_DIR, 'chain.json'));
  return resolveExpertsForRules([rule], chain, { mode: 'full' }).experts;
}

// ─── Effort-graded model selection (v1.10) ──────────────────────────────────

/**
 * Classify the effort a sub-task needs, using only cheap signals already
 * available in routing + session digest + the persona manifest. No LLM call —
 * an LLM call to pick a model would eat the savings this whole layer exists
 * to capture. First matching rule wins, so the order below is the priority.
 *
 * @returns {"trivial"|"standard"|"hard"}
 */
function classifyEffort({ routing, digest, manifest, scopedMode, fullChain, isDeltaFollowUp } = {}) {
  // Safety-first rules: anything risky escalates to hard before any savings rule.
  if (scopedMode) return 'trivial';                       // scoped mode = single dimension by construction
  if (fullChain) return 'hard';                            // explicit full audit
  if (routing && /full_screen_review/.test(routing.problem_type)) return 'hard';
  if (routing && /stalemate/.test(routing.problem_type)) return 'hard';
  if (digest && Array.isArray(digest.ds_at_risk) && digest.ds_at_risk.length) return 'hard';
  // Savings rules: deltas and structured work don't need a frontier model.
  if (isDeltaFollowUp) return 'trivial';                   // REVISE → re-grade only flagged sections
  if (manifest && manifest.tier === 'structured') return 'trivial';
  if (manifest && manifest.tier === 'arbitrate') return 'standard';
  return 'standard';
}

/**
 * Resolve the (provider, model, maxTokens) for one persona call from the
 * effort matrix, with persona-level overrides winning over the global matrix
 * and the legacy tiers map as the final fallback so existing manifests keep
 * working unchanged. Gates are pinned to gate_override.use_effort.
 *
 * Resolution order (first hit wins):
 *   1. manifest.effort_overrides[effort]  (persona-specific)
 *   2. chain.effort_matrix[effort]        (global matrix, v1.10)
 *   3. chain.tiers[manifest.tier]         (legacy fallback, v1.9)
 *   4. manifest.max_output_tokens         (last resort for the cap)
 */
function resolveModel({ manifest, effort, chain, config, defaultProvider, defaultModel, gateName }) {
  let effKey = effort;
  const gateOverride = chain.gate_override;
  if (gateName && gateOverride && (gateOverride.applies_to || []).includes(gateName)) {
    effKey = gateOverride.use_effort || 'hard';
  }

  const override = (manifest.effort_overrides && manifest.effort_overrides[effKey]) || {};
  const matrix   = (chain.effort_matrix && chain.effort_matrix[effKey]) || {};
  const legacy   = (config.orchestrator?.tiers && config.orchestrator?.tiers[manifest.tier]) || {};

  const provider = override.provider || matrix.provider || legacy.provider || defaultProvider;
  const model    = override.model    || matrix.model    || legacy.model    || defaultModel;
  const resolvedProvider = resolveTierProvider(provider, defaultProvider);
  const maxTokens = override.max_output_tokens || matrix.max_output_tokens
    || config.orchestrator?.max_tokens?.[manifest.tier] || manifest.max_output_tokens;
  return { provider: resolvedProvider, model, maxTokens, effort: effKey };
}

function ollamaJson(baseUrl, model, system, user, maxTokens) {
  return new Promise(function(resolve, reject) {
    var lib = baseUrl.indexOf('https:') === 0 ? require('https') : require('http');
    var url = new URL('/api/chat', baseUrl);
    var body = JSON.stringify({
      model: model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      stream: false,
      options: { num_predict: maxTokens || 1200 },
    });
    var req = lib.request(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 60000,
    }, function(res) {
      var chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() {
        var raw = Buffer.concat(chunks).toString('utf8');
        try {
          var json = JSON.parse(raw);
          if (res.statusCode >= 400) {
            reject(new Error(json.error || 'Ollama HTTP ' + res.statusCode));
          } else {
            resolve(json);
          }
        } catch (e) {
          reject(new Error('Bad JSON from Ollama: ' + raw.slice(0, 200)));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', function() { req.destroy(); reject(new Error('Ollama timeout')); });
    req.write(body);
    req.end();
  });
}

function httpsJson(hostname, apiPath, headers, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname,
      path: apiPath,
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        try {
          const json = JSON.parse(raw);
          if (res.statusCode >= 400) {
            reject(new Error(json.error?.message || json.message || `HTTP ${res.statusCode}: ${raw.slice(0, 200)}`));
          } else {
            resolve(json);
          }
        } catch (e) {
          reject(new Error(`Bad JSON from ${hostname}: ${raw.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function callLlm({ provider, model, system, user, maxTokens, personaId, hostContext }) {
  if (provider === 'host') {
    const text = await callHostLlm({
      personaId, system, user, maxTokens, runContext: hostContext,
    });
    return enforceOutputCap(text, maxTokens);
  }

  let text = '';

  if (provider === 'anthropic') {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error('ANTHROPIC_API_KEY not set');
    const json = await httpsJson('api.anthropic.com', '/v1/messages', {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    }, {
      model: model || 'claude-sonnet-4-20250514',
      max_tokens: maxTokens || 4096,
      system,
      messages: [{ role: 'user', content: user }],
    });
    text = json.content?.map((c) => c.text).join('\n') || '';
  } else if (provider === 'openai') {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error('OPENAI_API_KEY not set');
    const json = await httpsJson('api.openai.com', '/v1/chat/completions', {
      Authorization: `Bearer ${key}`,
    }, {
      model: model || 'gpt-4o',
      max_tokens: maxTokens || undefined,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });
    text = json.choices?.[0]?.message?.content || '';
  } else if (provider === 'google') {
    const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!key) throw new Error('GEMINI_API_KEY not set');
    const json = await httpsJson('generativelanguage.googleapis.com', '/v1beta/openai/chat/completions', {
      Authorization: `Bearer ${key}`,
    }, {
      model: model || 'gemini-2.5-flash',
      max_tokens: maxTokens || undefined,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });
    text = json.choices?.[0]?.message?.content || '';
  } else if (provider === 'zai') {
    const key = process.env.ZAI_API_KEY || process.env.ZHIPU_API_KEY;
    if (!key) throw new Error('ZAI_API_KEY not set');
    const json = await httpsJson('open.bigmodel.cn', '/api/paas/v4/chat/completions', {
      Authorization: `Bearer ${key}`,
    }, {
      model: model || 'glm-4.5-flash',
      max_tokens: maxTokens || undefined,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });
    text = json.choices?.[0]?.message?.content || '';
  } else if (provider === 'ollama') {
    const baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    const json = await ollamaJson(baseUrl, model || 'llama3.1', system, user, maxTokens);
    text = json.message?.content || json.response || '';
  } else if (provider === 'groq') {
    const key = process.env.GROQ_API_KEY;
    if (!key) throw new Error('GROQ_API_KEY not set');
    const json = await httpsJson('api.groq.com', '/openai/v1/chat/completions', {
      Authorization: `Bearer ${key}`,
    }, {
      model: model || 'llama-3.1-8b-instant',
      max_tokens: maxTokens || undefined,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });
    text = json.choices?.[0]?.message?.content || '';
  } else if (provider === 'together') {
    const key = process.env.TOGETHER_API_KEY;
    if (!key) throw new Error('TOGETHER_API_KEY not set');
    const json = await httpsJson('api.together.xyz', '/v1/chat/completions', {
      Authorization: `Bearer ${key}`,
    }, {
      model: model || 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
      max_tokens: maxTokens || undefined,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });
    text = json.choices?.[0]?.message?.content || '';
  } else if (provider === 'openrouter') {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) throw new Error('OPENROUTER_API_KEY not set');
    const json = await httpsJson('openrouter.ai', '/api/v1/chat/completions', {
      Authorization: `Bearer ${key}`,
      'HTTP-Referer': 'https://github.com/joshirishi/analyzthis_design',
      'X-Title': 'analyzthis_design',
    }, {
      model: model || 'meta-llama/llama-3.1-8b-instruct:free',
      max_tokens: maxTokens || undefined,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });
    text = json.choices?.[0]?.message?.content || '';
  } else if (provider === 'deepseek') {
    const key = process.env.DEEPSEEK_API_KEY;
    if (!key) throw new Error('DEEPSEEK_API_KEY not set');
    const json = await httpsJson('api.deepseek.com', '/chat/completions', {
      Authorization: `Bearer ${key}`,
    }, {
      model: model || 'deepseek-chat',
      max_tokens: maxTokens || undefined,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });
    text = json.choices?.[0]?.message?.content || '';
  } else {
    throw new Error(`Unknown provider "${provider}". Use anthropic, openai, google, zai, ollama, groq, together, openrouter, deepseek, or host.`);
  }

  return enforceOutputCap(text, maxTokens);
}

/**
 * Run the orchestrator graph.
 * @param {{
 *   task: string, figma?: string, provider?: string, model?: string, dryRun?: boolean,
 *   project?: string, output?: string, lite?: boolean, full?: boolean, experts?: string[],
 *   continueRun?: boolean, hostResponder?: function,
 * }} opts
 */
async function runUnchunked(opts = {}) {
  const {
    task, figma = '', dryRun = false, project, output,
    experts: explicitExperts = null,
    noDeliberate = false,
    deliberate = null,
    maxRounds = null,
    satisfaction = null,
    continueRun = false,
    hostResponder = null,
  } = opts;
  if (!task) throw new Error('--task is required');

  const config = loadConfig();
  const dConfig = deliberation.loadDeliberationConfig(config);
  const provider = resolveDefaultProvider(config, opts.provider || config.orchestrator?.provider || 'auto');
  const model    = opts.model    || config.orchestrator?.model;

  const configMode = config.orchestrator?.mode || 'lite';
  const mode = opts.full ? 'full' : (opts.lite ? 'lite' : configMode);

  const useDeliberation = noDeliberate
    ? false
    : (deliberate != null ? deliberate : dConfig.default_mode !== 'legacy');

  let state = session.show({ project });
  if (!state) {
    const init = session.init({ project });
    state = session.show({ project: init.projectId });
  }
  const projectId = state.project_id;

  // Host LLM run directory (Devi bridge — no API keys)
  let hostContext = null;
  if (provider === 'host' && !dryRun) {
    if (continueRun && state.host_run?.run_dir) {
      const manifest = loadHostManifest(state.host_run.run_dir);
      hostContext = {
        runDir: state.host_run.run_dir,
        manifest,
        hostResponder,
      };
    } else if (!continueRun) {
      const created = createRun({ projectId, task });
      hostContext = { runDir: created.runDir, manifest: created.manifest, hostResponder };
      session.update({
        project: projectId,
        patch: {
          host_run: {
            run_id: created.runId,
            run_dir: created.runDir,
            task,
            status: 'in_progress',
            started_at: new Date().toISOString(),
          },
        },
      });
    }
  }

  const chain = loadJson(path.join(AGENTS_DIR, 'chain.json'));
  const rules = classifyProblems(task);
  const { experts, full_chain, ideation_chain } = resolveExpertsForRules(rules, chain, { mode, explicitExperts });
  const never = [...new Set(rules.flatMap((r) => r.never_route_to || []))];

  const routing = {
    problem_type: rules.map((r) => r.problem_type).join('+'),
    experts,
    never_route_to: never,
    reason: explicitExperts && explicitExperts.length
      ? `Explicit --experts override: ${explicitExperts.join(', ')}`
      : `Matched ${rules.length} rule(s) [${rules.map((r) => r.problem_type).join(', ')}] in "${mode}" mode`,
  };

  const dsAtRisk = Object.entries(state.ds_checklist || {})
    .filter(([, v]) => v === false)
    .map(([k]) => k);

  const deliberationGroups = deliberation.getDeliberationGroups(chain, {
    full_chain, ideation_chain, experts, mode,
  });

  session.update({
    project: projectId,
    patch: {
      routing_decision: routing,
      figma_node: figma ? { url: figma, confirmed: false } : state.figma_node,
      mode: 'assess_only',
      task_map: state.task_map?.length
        ? state.task_map
        : [{ task, frequency: 'unknown', priority: 'P0' }],
      digest: {
        ...(state.digest || {}),
        task_map_summary: task.slice(0, 240),
        ds_at_risk: dsAtRisk,
        experts,
        mode: 'assess_only',
      },
    },
  });

  const plan = {
    project_id: projectId,
    task,
    figma,
    mode,
    routing,
    chain: experts,
    full_chain,
    ideation_chain,
    deliberation: useDeliberation ? {
      mode: 'adversarial',
      groups: deliberationGroups,
      max_rounds: maxRounds ?? dConfig.max_rounds,
      satisfaction_threshold: satisfaction ?? dConfig.satisfaction_threshold,
    } : { mode: 'legacy' },
    dry_run: dryRun,
    provider: dryRun ? null : provider,
    host_mode: provider === 'host',
  };

  if (dryRun) {
    console.log('\n── Dry run (no LLM calls) ──────────────────────────');
    console.log(JSON.stringify(plan, null, 2));
    console.log('');
    return plan;
  }

  const useLiteSchema = mode !== 'full' && !ideation_chain;
  const wireframePersonas = new Set(['noor', 'anuj']);
  const isDeltaFollowUp = !!(state.digest && state.digest.prior_scores && Object.keys(state.digest.prior_scores || {}).length);
  let cacheHits = 0;
  let costUsd = 0;

  async function loadPersonaContext(personaId, { isProduceRound, isObjectionRound }) {
    const manifest = loadManifest(personaId);
    const useDeepWireframe = ideation_chain && wireframePersonas.has(personaId);
    const isReviewRound = isObjectionRound && !isProduceRound;

    // Objection rounds: card only (~500 tokens) even in --full mode
    const context = isReviewRound
      ? loadCard(manifest, personaId)
      : (full_chain || useDeepWireframe || isProduceRound)
        ? loadSkill(manifest).slice(0, 12000)
        : loadCard(manifest, personaId);

    const personaUsesLite = isReviewRound || (useLiteSchema && !useDeepWireframe);

    const protocolHint = isObjectionRound
      ? `\nDELIBERATION REVIEW MODE: Read prior outputs critically. Low satisfaction default. ${deliberation.DELIBERATION_JSON_HINT}`
      : '';

    const systemParts = [
      `You are the "${personaId}" persona. Follow the card/skill instructions exactly.`,
      `Allowed jobs: ${(manifest.allowed_jobs || []).join('; ')}`,
      `Forbidden jobs: ${(manifest.forbidden_jobs || []).join('; ')}`,
      `Assess-only mode is ON — do not propose code edits as applied; output critique only.`,
      personaUsesLite
        ? 'Use the LITE objection schema — short grounding, objections, questions, JSON block.'
        : isProduceRound
          ? 'Use the DEEP output schema (full blocks as in your SKILL.md) plus deliberation JSON.'
          : 'REVIEW MODE: object to prior claims with evidence; include deliberation JSON block.',
      protocolHint,
      '',
      context,
    ];

    const system = isReviewRound
      ? enforceSystemCap(systemParts.join('\n'), 5500)
      : systemParts.join('\n');

    const effort = classifyEffort({
      routing, digest: state.digest, manifest, scopedMode: null, fullChain: full_chain, isDeltaFollowUp,
    });
    const resolved = resolveModel({
      manifest, effort: isObjectionRound ? 'trivial' : effort, chain, config,
      defaultProvider: provider, defaultModel: model, gateName: null,
    });

    let finalSystem = system;
    try {
      const lessonsResult = lessons.retrieveLessons({ task, personaId, limit: 3 });
      if (lessonsResult && lessonsResult.lessons && lessonsResult.lessons.length) {
        finalSystem = finalSystem + '\n\n' + lessons.buildLessonsInjection(lessonsResult.lessons);
      }
    } catch {
      // lessons retrieval failed — continue without injection
    }

    return {
      system: finalSystem,
      manifest,
      effort: resolved.effort,
      callProvider: resolved.provider,
      callModel: resolved.model,
      maxTokens: resolved.maxTokens,
    };
  }

  function parseStructuredOutput(text, personaId) {
    const result = { grades: {}, score: null, top_fixes: [] };
    const scoreMatch = text.match(/(\d+(?:\.\d+)?)\s*\/\s*5/);
    if (scoreMatch) result.score = Number(scoreMatch[1]);

    const gradeMatches = text.match(/(\w+)\[([A-F])\]/gi);
    if (gradeMatches) {
      for (const gm of gradeMatches) {
        const m = gm.match(/(\w+)\[([A-F])\]/i);
        if (m) result.grades[m[1].toLowerCase()] = m[2].toUpperCase();
      }
    }

    const fixesMatch = text.match(/Top\s*2\s*fixes:\s*1\.\s*([^\n]+)\s*2\.\s*([^\n]+)/i);
    if (fixesMatch) {
      result.top_fixes = [fixesMatch[1].trim(), fixesMatch[2].trim()];
    }
    return result;
  }

  async function callPersona(personaId, system, user, callOpts) {
    console.log(`\n⏳ Running persona: ${personaId}...`);
    const text = await callLlm({
      provider: callOpts.provider,
      model: callOpts.model,
      system,
      user,
      maxTokens: callOpts.maxTokens,
      personaId,
      hostContext,
    });
    const inTok = Math.ceil((system.length + user.length) / 4);
    const outTok = Math.ceil(text.length / 4);
    const price = config.pricing && config.pricing[callOpts.model];
    if (price) {
      costUsd += (inTok / 1e6) * (price.input_per_m || 0) + (outTok / 1e6) * (price.output_per_m || 0);
    }
    console.log(`✅ ${personaId} complete (${text.length} chars, ${callOpts.effort || 'standard'})`);
    return {
      text,
      input_tokens_est: inTok,
      output_tokens_est: outTok,
      structured_output: parseStructuredOutput(text, personaId),
      full_prompt: { system, user },
      effort_log_entry: {
        persona: personaId,
        effort: callOpts.effort || 'standard',
        model: callOpts.model,
        scoped_mode: null,
      },
    };
  }

  state = session.show({ project: projectId }) || state;

  let delibResult;
  try {
    delibResult = await deliberation.runDeliberation({
      chain,
      experts,
      full_chain,
      ideation_chain,
      mode,
      task,
      routing,
      state,
      figma,
      config,
      callPersona,
      loadPersonaContext,
      buildReferencePack: async (id, t) => {
        const pack = await buildReferencePack(id, t, state);
        if (pack?.cacheHit) cacheHits += 1;
        return pack;
      },
      noDeliberate: !useDeliberation,
      satisfaction_threshold: satisfaction != null ? Number(satisfaction) : undefined,
      max_rounds: maxRounds != null ? Number(maxRounds) : undefined,
      resume_checkpoint: continueRun ? state.host_run?.checkpoint : null,
    });
  } catch (err) {
    if (err.name === 'HostLlmPendingError') {
      session.update({
        project: projectId,
        patch: {
          persona_outputs: err.checkpoint?.persona_outputs || state.persona_outputs,
          host_run: {
            ...(state.host_run || {}),
            status: 'pending_devi',
            last_pending: { step_id: err.stepId, persona: err.personaId },
            checkpoint: err.checkpoint || null,
          },
        },
      });
      printDeviInstructions(err);
      throw err;
    }
    throw err;
  }

  const syn = synthesis.buildSynthesis(delibResult.persona_outputs, { deliberation: delibResult.deliberation });

  const verifyResults = figma
    ? { primary_task: 'not_run', screenshots: [], reason: 'browser automation unavailable in standalone runtime' }
    : { primary_task: 'not_run', screenshots: [], reason: 'assess_only, no URL' };

  const expertsRun = Object.keys(delibResult.persona_outputs);

  const full_prompts = {};
  const structured_outputs = {};
  for (const [id, out] of Object.entries(delibResult.persona_outputs || {})) {
    if (out.full_prompt) full_prompts[id] = out.full_prompt;
    if (out.structured_output) structured_outputs[id] = out.structured_output;
  }

  const final = session.update({
    project: projectId,
    patch: {
      persona_outputs: delibResult.persona_outputs,
      full_prompts: full_prompts,
      structured_outputs: structured_outputs,
      covered_points: delibResult.covered_points || [],
      task_type: state.task_type || classifyProblem(task)?.problem_type || '',
      deliberation: delibResult.deliberation,
      synthesis: syn.composite,
      synthesis_markdown: syn.markdown,
      verify_results: verifyResults,
      host_run: provider === 'host' ? {
        ...(state.host_run || {}),
        status: 'complete',
        completed_at: new Date().toISOString(),
        checkpoint: null,
      } : state.host_run,
      digest: {
        ...(state.digest || {}),
        ...delibResult.digest_patch,
        experts,
      },
      metrics: {
        llm_calls: delibResult.metrics.llm_calls,
        experts_run: expertsRun,
        input_tokens_est: delibResult.metrics.input_tokens_est,
        output_tokens_est: delibResult.metrics.output_tokens_est,
        cache_hits: cacheHits,
        mode,
        effort_log: delibResult.metrics.effort_log,
        cost_usd: Number(costUsd.toFixed(6)),
        deliberation_rounds: delibResult.metrics.deliberation_rounds,
        objections_raised: delibResult.metrics.objections_raised,
        objections_resolved: delibResult.metrics.objections_resolved,
        raj_escalations: delibResult.metrics.raj_escalations,
      },
    },
  });

  if (output) {
    fs.writeFileSync(path.resolve(output), JSON.stringify(final, null, 2));
    console.log(`\n✅ Wrote session state to ${path.resolve(output)}`);
  }

  console.log(`\n✅ Orchestrator run complete. Experts (${mode}): ${experts.join(', ')}`);
  console.log(`   Provider: ${provider}${provider === 'host' ? ' (Devi host bridge)' : ''}`);
  console.log(`   Deliberation: ${delibResult.deliberation.mode}, rounds=${delibResult.metrics.deliberation_rounds}, consensus=${delibResult.deliberation.consensus_reached}`);
  if (delibResult.deliberation.raj_escalated) console.log('   Raj escalated: yes');
  console.log(`   Verdict: ${syn.composite.verdict} (${syn.composite.total}/${syn.composite.max_total})`);
  console.log(`   Est. tokens: ${delibResult.metrics.input_tokens_est} in / ${delibResult.metrics.output_tokens_est} out`);
  if (costUsd) console.log(`   Est. cost:   $${costUsd.toFixed(4)}`);
  console.log(`   Session: ${session.sessionPath(projectId)}`);
  console.log('\n── Synthesis ──────────────────────────────────────');
  console.log(syn.markdown);
  console.log('');
  return final;
}

/**
 * Default run — chunked execution (v2.0).
 * Pass unchunked: true to use the legacy deliberation path.
 */
async function run(opts = {}) {
  if (opts.unchunked) {
    return runUnchunked(opts);
  }

  const result = await chunkRun.runChunked(opts);

  if (result.mode === 'host_pending' || result.host_pending) {
    return result;
  }

  if (result.mode === 'chunked_dry_run' || opts.dryRun) {
    return result;
  }

  const chunkRunState = result.chunk_run || result;
  const syn = chunkRunState.synthesis;
  console.log('\n✅ Chunked orchestrator run complete.');
  if (chunkRunState.planner_warning) {
    console.log(`   ⚠ Planner: ${chunkRunState.planner_warning}`);
  }
  if (chunkRunState.planner_model) {
    console.log(`   Planner: ${chunkModels.formatModelName(chunkRunState.planner_model)}`);
  }
  console.log(`   Chunks:  ${(chunkRunState.results || []).length}`);
  console.log(`   Failed:  ${(chunkRunState.failed_chunks || []).length}`);
  if (chunkRunState.models_used && chunkRunState.models_used.length) {
    console.log(`   Models:  ${chunkRunState.models_used.join(', ')}`);
  }
  console.log(`   Cost:    $${(chunkRunState.total_cost || 0).toFixed(4)}`);
  const tokens = chunkRunState.total_tokens || { input: 0, output: 0 };
  console.log(`   Tokens:  ${tokens.input} in / ${tokens.output} out`);
  if (syn) {
    console.log(`   Verdict: ${syn.verdict || 'n/a'} (${syn.total || 0}/${syn.max_total || 0})`);
  }
  console.log(`   Session: ${session.sessionPath(result.project_id || session.getProjectId())}`);
  return result.session;
}

module.exports = { run, runUnchunked, classifyProblem, classifyProblems, resolveExperts, resolveExpertsForRules, loadManifest, classifyEffort, resolveModel, callLlm, loadConfig };

// Direct invocation support
if (require.main === module) {
  const args = process.argv.slice(2);
  const get = (name) => {
    const eq = args.find((a) => a.startsWith(`--${name}=`));
    if (eq) return eq.split('=').slice(1).join('=');
    const i = args.indexOf(`--${name}`);
    if (i !== -1 && args[i + 1] && !args[i + 1].startsWith('--')) return args[i + 1];
    return null;
  };
  const expertsArg = get('experts');
  run({
    task: get('task'),
    figma: get('figma') || '',
    provider: get('provider'),
    model: get('model'),
    dryRun: args.includes('--dry-run'),
    lite: args.includes('--lite'),
    full: args.includes('--full'),
    noDeliberate: args.includes('--no-deliberate'),
    deliberate: args.includes('--deliberate') ? true : null,
    maxRounds: get('max-rounds'),
    satisfaction: get('satisfaction'),
    continueRun: args.includes('--continue'),
    experts: expertsArg ? expertsArg.split(',').map((s) => s.trim()).filter(Boolean) : null,
    project: get('project'),
    output: get('output'),
  }).catch((err) => {
    console.error(`\n  ✗  ${err.message}\n`);
    process.exit(1);
  });
}
