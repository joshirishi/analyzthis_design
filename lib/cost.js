'use strict';

/**
 * $-cost reporting for persona runs (v1.10).
 *
 * Reads the `metrics` block from session-state.json (tokens + effort_log) and
 * multiplies by per-model pricing from ~/.analyzthis_design/config.json:
 *
 *   config.pricing = {
 *     "<model-id>": { "input_per_m": 1.25, "output_per_m": 10 },
 *     ...
 *   }
 *
 * Missing pricing for a model → that call contributes $0 (best-effort: we never
 * block a report because a price wasn't seeded). The CLI `cost` command prints
 * the per-run breakdown; this module just computes it so it can be reused.
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const session = require('./session');

const CONFIG_FILE = path.join(os.homedir(), '.analyzthis_design', 'config.json');

function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
  catch { return {}; }
}

/**
 * Compute the $ cost of one run from its session state.
 * @param {object} state - a session-state.json object (with a `metrics` block)
 * @param {object} pricing - config.pricing map: { "<model>": { input_per_m, output_per_m } }
 * @returns {{ total: number, byExpert: Array<{persona, effort, model, inTok, outTok, cost}>, unpriced: string[] }}
 */
function computeRunCost(state, pricing = {}) {
  const m = state.metrics || {};
  const log = m.effort_log || [];
  const inTokTotal = m.input_tokens_est || 0;
  const outTokTotal = m.output_tokens_est || 0;
  const unpriced = [];

  // If there's an effort_log, attribute tokens evenly across the logged calls
  // (we don't store per-call token counts, only the run total). This keeps the
  // breakdown useful without inflating the session-state schema further.
  const calls = log.length || 1;
  const inPerCall  = Math.ceil(inTokTotal / calls);
  const outPerCall = Math.ceil(outTokTotal / calls);

  let total = 0;
  const byExpert = (log.length ? log : [{ persona: 'unknown', effort: m.mode || 'lite', model: null }]).map((entry) => {
    const price = entry.model ? pricing[entry.model] : null;
    let cost = 0;
    if (price) {
      cost = (inPerCall / 1e6) * (price.input_per_m || 0) + (outPerCall / 1e6) * (price.output_per_m || 0);
    } else if (entry.model) {
      unpriced.push(entry.model);
    }
    total += cost;
    return {
      persona: entry.persona,
      effort: entry.effort,
      model: entry.model,
      inTok: inPerCall,
      outTok: outPerCall,
      cost: Number(cost.toFixed(6)),
    };
  });

  return { total: Number(total.toFixed(6)), byExpert, unpriced: [...new Set(unpriced)] };
}

/**
 * Print the cost report for one or all projects.
 * @param {{ project?: string, all?: boolean }} opts
 */
function report({ project, all = false } = {}) {
  const config = loadConfig();
  const pricing = config.pricing || {};
  const projectIds = all ? session.listProjects() : [project || session.getProjectId()];
  if (!projectIds.length) {
    console.log('\n  No sessions found.\n');
    return { projects: [] };
  }

  console.log('\n💰 Run cost report\n');
  const projects = [];
  for (const projectId of projectIds) {
    const state = session.show({ project: projectId });
    if (!state) continue;
    const { total, byExpert, unpriced } = computeRunCost(state, pricing);
    const m = state.metrics || {};
    console.log(`  ${projectId}`);
    console.log(`    mode:              ${m.mode ?? 'n/a'}`);
    console.log(`    llm_calls:         ${m.llm_calls ?? 0}`);
    console.log(`    input_tokens_est:  ${m.input_tokens_est ?? 0}`);
    console.log(`    output_tokens_est: ${m.output_tokens_est ?? 0}`);
    console.log(`    est. cost:         $${total.toFixed(4)}`);
    if (m.deliberation_rounds != null) {
      console.log(`    deliberation_rounds: ${m.deliberation_rounds}`);
      console.log(`    objections:        ${m.objections_raised ?? 0} raised / ${m.objections_resolved ?? 0} resolved`);
    }
    if (byExpert.length && (byExpert.length > 1 || byExpert[0].model)) {
      for (const e of byExpert) {
        console.log(`      • ${e.persona} [${e.effort}] ${e.model || 'n/a'} → $${e.cost.toFixed(4)}`);
      }
    }
    if (unpriced.length) {
      console.log(`    unpriced models:   ${unpriced.join(', ')} (add to config.pricing)`);
    }
    console.log('');
    projects.push({ project: projectId, total, byExpert, unpriced });
  }
  return { projects };
}

module.exports = { computeRunCost, report, loadConfig, CONFIG_FILE };
