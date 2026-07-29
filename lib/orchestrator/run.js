#!/usr/bin/env node
'use strict';

/**
 * Standalone persona orchestrator runtime (v2).
 * Loads agents/ manifests + router + chain, optionally calls an LLM per persona step.
 *
 * Usage:
 *   npx analyzthis_design run --task "..." [--figma URL] [--provider anthropic|openai] [--dry-run]
 *   npx analyzthis_design run --task "..." --lite            # force MoE subset only (default)
 *   npx analyzthis_design run --task "..." --full             # allow the full design-critic chain
 *   npx analyzthis_design run --task "..." --experts arjun,meera   # explicit expert override
 *
 * Env / config (never committed):
 *   ANTHROPIC_API_KEY or OPENAI_API_KEY
 *   ~/.analyzthis_design/config.json → {
 *     "orchestrator": {
 *       "provider": "anthropic",
 *       "model": "...",
 *       "mode": "lite" | "full",
 *       "tiers": { "extract": {...}, "structured": {...}, "critique": {...}, "arbitrate": {...} },
 *       "max_tokens": { "structured": 900, "critique": 1800, "arbitrate": 1200 }
 *     }
 *   }
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const https = require('https');
const session  = require('../session');
const retrieve = require('../retrieve');
const cache    = require('../cache');

// Resolve package root whether we are running from source (lib/) or published (dist/lib/)
const PACKAGE_ROOT = (() => {
  const fromDist = path.join(__dirname, '..', '..', '..'); // dist/lib/orchestrator → package root
  if (fs.existsSync(path.join(fromDist, 'agents'))) return fromDist;
  return path.join(__dirname, '..', '..'); // lib/orchestrator → package root
})();
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

// Common product-type / domain keywords to match against CSV columns like
// "Best For" / "Product Type" — kept small and cheap rather than exhaustive.
const PRODUCT_KEYWORDS = [
  'saas', 'b2b', 'b2c', 'dashboard', 'analytics', 'e-commerce', 'ecommerce',
  'fintech', 'healthcare', 'crm', 'marketplace', 'admin', 'enterprise',
  'consumer', 'mobile', 'productivity', 'social', 'education', 'finance',
];

function extractKeywords(text) {
  const lower = (text || '').toLowerCase();
  return PRODUCT_KEYWORDS.filter((k) => lower.includes(k));
}

// Which reference files each persona pulls from, and which column to filter/cite.
// Mirrors the "Reference data" tables in each persona's SKILL.md, but scoped
// to the single most relevant file per persona for the standalone runtime —
// call retrieve() again with a different file for a deeper dive if needed.
const REFERENCE_MAP = {
  arjun: { file: 'styles.csv', column: 'Best For', limit: 3 },
  zara:  { file: 'colors.csv', column: 'Product Type', limit: 3 },
  meera: { file: 'products.csv', column: 'Product Type', limit: 3 },
  noor:  { file: 'ux-guidelines.csv', column: 'Category', limit: 3 },
  anuj:  { file: 'ux-guidelines.csv', column: 'Category', limit: 3 },
};

/**
 * Retrieve a compact, citation-ready reference pack for one persona's active
 * dimension, based on keywords found in the task text. Returns null (no pack)
 * when no product-type keyword is found — this is retrieve-on-demand, not a
 * full-file dump, so an unmatched task simply gets no reference block.
 */
function buildReferencePack(id, task) {
  const spec = REFERENCE_MAP[id];
  if (!spec) return null;
  const keywords = extractKeywords(task);
  if (!keywords.length) return null;
  try {
    const result = retrieve.retrieve({
      file: spec.file,
      filters: [{ column: spec.column, anyOf: keywords }],
      limit: spec.limit,
    });
    if (!result.rows.length) return null;
    return {
      cacheHit: result.cacheHit,
      citations: result.rows.map((row) => retrieve.cite(spec.file, row, spec.column)),
    };
  } catch {
    return null; // reference file missing/unreadable — persona falls back to its own skill knowledge
  }
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
    };
  }

  const isFullScreenReview = rules.some((r) =>
    r.problem_type === 'full_screen_review' || (r.route_to || []).includes('design-critic_chain'));

  if (isFullScreenReview && mode === 'full') {
    return { experts: chain.default_chain.map((s) => s.persona), full_chain: true };
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
  };
}

// Back-compat single-rule accessor.
function resolveExperts(rule) {
  const chain = loadJson(path.join(AGENTS_DIR, 'chain.json'));
  return resolveExpertsForRules([rule], chain, { mode: 'full' }).experts;
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

async function callLlm({ provider, model, system, user, maxTokens }) {
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
    return json.content?.map((c) => c.text).join('\n') || '';
  }

  if (provider === 'openai') {
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
    return json.choices?.[0]?.message?.content || '';
  }

  throw new Error(`Unknown provider "${provider}". Use anthropic or openai.`);
}

/**
 * Run the orchestrator graph.
 * @param {{
 *   task: string, figma?: string, provider?: string, model?: string, dryRun?: boolean,
 *   project?: string, output?: string, lite?: boolean, full?: boolean, experts?: string[],
 * }} opts
 */
async function run(opts = {}) {
  const { task, figma = '', dryRun = false, project, output, experts: explicitExperts = null } = opts;
  if (!task) throw new Error('--task is required');

  const config = loadConfig();
  const provider = opts.provider || config.orchestrator?.provider || 'anthropic';
  const model    = opts.model    || config.orchestrator?.model;

  // lite is the default everywhere unless --full or config says mode: "full".
  const configMode = config.orchestrator?.mode || 'lite';
  const mode = opts.full ? 'full' : (opts.lite ? 'lite' : configMode);

  // Ensure session exists
  let state = session.show({ project });
  if (!state) {
    const init = session.init({ project });
    state = session.show({ project: init.projectId });
  }
  const projectId = state.project_id;

  // Classify against every matching rule, then merge experts and never_route_to.
  const chain = loadJson(path.join(AGENTS_DIR, 'chain.json'));
  const rules = classifyProblems(task);
  const { experts, full_chain } = resolveExpertsForRules(rules, chain, { mode, explicitExperts });
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
    dry_run: dryRun,
    provider: dryRun ? null : provider,
  };

  if (dryRun) {
    console.log('\n── Dry run (no LLM calls) ──────────────────────────');
    console.log(JSON.stringify(plan, null, 2));
    console.log('');
    return plan;
  }

  // Execute each persona step
  const persona_outputs = {};
  let inputTokensEst = 0;
  let outputTokensEst = 0;
  let cacheHits = 0;
  const useLiteSchema = mode !== 'full';
  for (const id of experts) {
    const manifest = loadManifest(id);
    // Default to the short card (agents/cards/<id>.md); only paste the full
    // skill when running the full chain (default_chain), matching the
    // orchestrator's own "cards + lite by default" rule.
    const context = full_chain ? loadSkill(manifest).slice(0, 12000) : loadCard(manifest, id);
    const referencePack = buildReferencePack(id, task);
    if (referencePack?.cacheHit) cacheHits += 1;

    const system = [
      `You are the "${id}" persona. Follow the card/skill instructions exactly.`,
      `Allowed jobs: ${(manifest.allowed_jobs || []).join('; ')}`,
      `Forbidden jobs: ${(manifest.forbidden_jobs || []).join('; ')}`,
      `Assess-only mode is ON — do not propose code edits as applied; output critique only.`,
      useLiteSchema ? 'Use the LITE output schema from your card (grades + Top 2 fixes + score only).' : 'Use the DEEP output schema (full blocks as in your SKILL.md).',
      '',
      context,
    ].join('\n');

    const user = [
      `Task: ${task}`,
      figma ? `Figma: ${figma}` : '',
      `Routing: ${routing.problem_type} → ${experts.join(', ')}`,
      referencePack ? `Reference data (cite these directly, do not invent values):\n${referencePack.citations.join('\n')}` : '',
      `Session digest: ${JSON.stringify(state.digest || {}).slice(0, 1500)}`,
      '',
      `Produce your structured output block as defined in your card/skill.`,
    ].filter(Boolean).join('\n');

    console.log(`\n⏳ Running persona: ${id}...`);
    const tierConfig = config.orchestrator?.tiers?.[manifest.tier] || {};
    const callProvider = tierConfig.provider || provider;
    const callModel     = tierConfig.model    || model;
    const maxTokens = config.orchestrator?.max_tokens?.[manifest.tier] || manifest.max_output_tokens;

    const text = await callLlm({ provider: callProvider, model: callModel, system, user, maxTokens });
    persona_outputs[id] = { text, at: new Date().toISOString(), accepted: null };
    inputTokensEst += Math.ceil((system.length + user.length) / 4);
    outputTokensEst += Math.ceil(text.length / 4);
    console.log(`✅ ${id} complete (${text.length} chars)`);
  }

  // Verify gate: skip the browser-automation step (not available in this
  // standalone runtime) whenever we're in assess_only mode with no URL to
  // check — record it explicitly rather than leaving it unset.
  const verifyResults = figma
    ? { primary_task: 'not_run', screenshots: [], reason: 'browser automation unavailable in standalone runtime' }
    : { primary_task: 'not_run', screenshots: [], reason: 'assess_only, no URL' };

  const final = session.update({
    project: projectId,
    patch: {
      persona_outputs,
      verify_results: verifyResults,
      metrics: {
        llm_calls: experts.length,
        experts_run: experts,
        input_tokens_est: inputTokensEst,
        output_tokens_est: outputTokensEst,
        cache_hits: cacheHits,
        mode,
      },
    },
  });

  if (output) {
    fs.writeFileSync(path.resolve(output), JSON.stringify(final, null, 2));
    console.log(`\n✅ Wrote session state to ${path.resolve(output)}`);
  }

  console.log(`\n✅ Orchestrator run complete. Experts (${mode}): ${experts.join(', ')}`);
  console.log(`   Est. tokens: ${inputTokensEst} in / ${outputTokensEst} out`);
  console.log(`   Session: ${session.sessionPath(projectId)}\n`);
  return final;
}

module.exports = { run, classifyProblem, classifyProblems, resolveExperts, resolveExpertsForRules, loadManifest };

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
    experts: expertsArg ? expertsArg.split(',').map((s) => s.trim()).filter(Boolean) : null,
    project: get('project'),
    output: get('output'),
  }).catch((err) => {
    console.error(`\n  ✗  ${err.message}\n`);
    process.exit(1);
  });
}
