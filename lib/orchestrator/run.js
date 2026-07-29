#!/usr/bin/env node
'use strict';

/**
 * Standalone persona orchestrator runtime (v2).
 * Loads agents/ manifests + router + chain, optionally calls an LLM per persona step.
 *
 * Usage:
 *   npx analyzthis_design run --task "..." [--figma URL] [--provider anthropic|openai] [--dry-run]
 *
 * Env / config (never committed):
 *   ANTHROPIC_API_KEY or OPENAI_API_KEY
 *   ~/.analyzthis_design/config.json → { "orchestrator": { "provider": "anthropic", "model": "..." } }
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const https = require('https');
const session = require('../session');

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

function classifyProblem(task) {
  const router = loadJson(path.join(AGENTS_DIR, 'router.json'));
  const lower = (task || '').toLowerCase();
  const matched = [];
  for (const rule of router.rules) {
    if (rule.signals.some((s) => lower.includes(s.toLowerCase()))) {
      matched.push(rule);
    }
  }
  if (matched.length === 0) {
    return router.rules.find((r) => r.problem_type === 'full_screen_review') || router.rules[0];
  }
  return matched[0];
}

function resolveExperts(rule) {
  const chain = loadJson(path.join(AGENTS_DIR, 'chain.json'));
  const routeTo = rule.route_to || [];

  // Full screen review → default chain
  if (routeTo.includes('design-critic_chain') || rule.problem_type === 'full_screen_review') {
    return chain.default_chain.map((s) => s.persona);
  }

  // Map special tokens to persona ids
  const experts = [];
  for (const token of routeTo) {
    if (token === 'ds_gate' || token === 'arjun_color_system_only') {
      if (!experts.includes('arjun')) experts.push('arjun');
    } else if (token !== 'direct_noor_without_gate') {
      experts.push(token);
    }
  }
  return experts.filter((id) => fs.existsSync(path.join(AGENTS_DIR, 'manifests', `${id}.json`)));
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

async function callLlm({ provider, model, system, user }) {
  if (provider === 'anthropic') {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error('ANTHROPIC_API_KEY not set');
    const json = await httpsJson('api.anthropic.com', '/v1/messages', {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    }, {
      model: model || 'claude-sonnet-4-20250514',
      max_tokens: 4096,
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
 * @param {{ task: string, figma?: string, provider?: string, model?: string, dryRun?: boolean, project?: string, output?: string }} opts
 */
async function run(opts = {}) {
  const { task, figma = '', dryRun = false, project, output } = opts;
  if (!task) throw new Error('--task is required');

  const config = loadConfig();
  const provider = opts.provider || config.orchestrator?.provider || 'anthropic';
  const model    = opts.model    || config.orchestrator?.model;

  // Ensure session exists
  let state = session.show({ project });
  if (!state) {
    const init = session.init({ project });
    state = session.show({ project: init.projectId });
  }
  const projectId = state.project_id;

  // Classify + route
  const rule = classifyProblem(task);
  const experts = resolveExperts(rule);
  const never = rule.never_route_to || [];

  const routing = {
    problem_type: rule.problem_type,
    experts,
    never_route_to: never,
    reason: `Matched signals for "${rule.problem_type}" from task text`,
  };

  session.update({
    project: projectId,
    patch: {
      routing_decision: routing,
      figma_node: figma ? { url: figma, confirmed: false } : state.figma_node,
      mode: 'assess_only',
      task_map: state.task_map?.length
        ? state.task_map
        : [{ task, frequency: 'unknown', priority: 'P0' }],
    },
  });

  const plan = {
    project_id: projectId,
    task,
    figma,
    routing,
    chain: experts,
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
  for (const id of experts) {
    const manifest = loadManifest(id);
    const skill = loadSkill(manifest);
    const system = [
      `You are the "${id}" persona. Follow the skill instructions exactly.`,
      `Allowed jobs: ${(manifest.allowed_jobs || []).join('; ')}`,
      `Forbidden jobs: ${(manifest.forbidden_jobs || []).join('; ')}`,
      `Assess-only mode is ON — do not propose code edits as applied; output critique only.`,
      '',
      skill.slice(0, 12000),
    ].join('\n');

    const user = [
      `Task: ${task}`,
      figma ? `Figma: ${figma}` : '',
      `Routing: ${routing.problem_type} → ${experts.join(', ')}`,
      `Prior persona outputs: ${JSON.stringify(persona_outputs).slice(0, 6000)}`,
      '',
      `Produce your structured output block as defined in your skill.`,
    ].filter(Boolean).join('\n');

    console.log(`\n⏳ Running persona: ${id}...`);
    const text = await callLlm({ provider, model, system, user });
    persona_outputs[id] = { text, at: new Date().toISOString() };
    console.log(`✅ ${id} complete (${text.length} chars)`);
  }

  const final = session.update({
    project: projectId,
    patch: { persona_outputs },
  });

  if (output) {
    fs.writeFileSync(path.resolve(output), JSON.stringify(final, null, 2));
    console.log(`\n✅ Wrote session state to ${path.resolve(output)}`);
  }

  console.log(`\n✅ Orchestrator run complete. Experts: ${experts.join(', ')}`);
  console.log(`   Session: ${session.sessionPath(projectId)}\n`);
  return final;
}

module.exports = { run, classifyProblem, resolveExperts, loadManifest };

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
  run({
    task: get('task'),
    figma: get('figma') || '',
    provider: get('provider'),
    model: get('model'),
    dryRun: args.includes('--dry-run'),
    project: get('project'),
    output: get('output'),
  }).catch((err) => {
    console.error(`\n  ✗  ${err.message}\n`);
    process.exit(1);
  });
}
