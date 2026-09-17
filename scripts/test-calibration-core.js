#!/usr/bin/env node
'use strict';

var assert = require('assert');
var fs = require('fs');
var os = require('os');
var path = require('path');

var temp = fs.mkdtempSync(path.join(os.tmpdir(), 'analyzthis-calibration-core-'));
process.env.ANALYZTHIS_TELEMETRY_FILE = path.join(temp, 'telemetry.jsonl');
process.env.ANALYZTHIS_CALIBRATION_FILE = path.join(temp, 'calibration.json');

var telemetry = require('../lib/chunk-telemetry');
var quality = require('../lib/output-quality');
var models = require('../lib/model-registry');
var policy = require('../lib/model-policy');
var session = require('../lib/session');
var accept = require('../lib/accept');
var orchestrator = require('../lib/orchestrator/run');

telemetry.record({ scope_version: 1, persona: 'arjun', effort: 'standard', task_type: 'audit', output_format: 'ux_audit', model: 'ollama/qwen2.5', transport_success: true, quality_pass: false });
telemetry.record({ scope_version: 1, persona: 'zara', effort: 'standard', task_type: 'delight', output_format: 'generic', model: 'ollama/qwen2.5', transport_success: true, quality_pass: true });
var arjunStats = telemetry.getStatsForChunkType('audit', { persona: 'arjun', effort: 'standard', outputFormat: 'ux_audit' });
assert.strictEqual(arjunStats[0].quality_attempts, 1);
assert.strictEqual(arjunStats[0].quality_successful, 0);
var zaraStats = telemetry.getStatsForChunkType('delight', { persona: 'zara', effort: 'standard', outputFormat: 'generic' });
assert.strictEqual(zaraStats[0].quality_successful, 1);

telemetry.record({ scope_version: 1, persona: 'arjun', effort: 'standard', task_type: 'audit', output_format: 'ux_audit', model: 'ollama/qwen2.5', transport_success: false, quality_pass: null, failure_kind: 'rate_limit' });
arjunStats = telemetry.getStatsForChunkType('audit', { persona: 'arjun', effort: 'standard', outputFormat: 'ux_audit' });
assert.strictEqual(arjunStats[0].quality_attempts, 1);
assert.strictEqual(arjunStats[0].rate_limits, 1);

assert.strictEqual(quality.validateOutput('', { persona: 'arjun', outputFormat: 'ux_audit' }).pass, false);
assert.strictEqual(quality.validateOutput('UX hierarchy is weak. Recommend moving the primary action above the fold for usability.', { persona: 'arjun', outputFormat: 'ux_audit' }).pass, true);
assert.strictEqual(quality.validateOutput('## Zara — Lite\nFix the token contrast ratio and --color-primary now.', { persona: 'zara', outputFormat: 'persona_lite' }).pass, false);

var sonnet = models.find('anthropic', 'claude-sonnet-4-20250514');
assert.strictEqual(Number(models.estimateCost(sonnet, 10000, 2000).toFixed(6)), 0.06);

var promptHash = policy.promptHash('arjun');
var contract = policy.calibrationContract();
fs.writeFileSync(process.env.ANALYZTHIS_CALIBRATION_FILE, JSON.stringify({
  personas: {
    arjun: {
      hard: {
        provider: 'ollama',
        model: 'qwen2.5',
        effort: ['trivial', 'standard', 'hard'],
        prompt_hash: promptHash,
        validator_version: 1,
        benchmark_version: contract.version,
        benchmark_hash: contract.hash,
        judge_policy_version: contract.judge_policy_version,
        expires_at: '2999-01-01T00:00:00.000Z'
      }
    }
  }
}));
var winner = policy.resolveAssignment({ persona: 'arjun', effort: 'hard', config: {} });
assert.strictEqual(winner.source, 'local_calibration');
assert.strictEqual(winner.spec.model, 'qwen2.5');
var prioritized = policy.prioritizePool([
  { provider: 'ollama', model: 'llama3.1', effort: ['hard'] },
  { provider: 'ollama', model: 'qwen2.5', effort: ['trivial', 'standard', 'hard'] },
], { persona: 'arjun', effort: 'hard', config: {} });
assert.strictEqual(prioritized.pool[0].model, 'qwen2.5');
var resolvedUnchunked = orchestrator.resolveModel({
  manifest: { id: 'arjun', tier: 'critique', effort_overrides: {} },
  effort: 'hard',
  chain: { effort_matrix: { hard: { provider: 'ollama', model: 'llama3.1' } } },
  config: {},
  defaultProvider: 'host',
  defaultModel: 'devi',
});
assert.strictEqual(resolvedUnchunked.model, 'qwen2.5');
assert.strictEqual(resolvedUnchunked.provider, 'ollama');
var gated = orchestrator.resolveModel({
  manifest: { id: 'arjun', tier: 'critique', effort_overrides: {} },
  effort: 'trivial',
  chain: {
    effort_matrix: { hard: { provider: 'ollama', model: 'qwen2.5' } },
    gate_override: { applies_to: ['ds_gate'], use_effort: 'hard' },
  },
  config: {},
  defaultProvider: 'host',
  defaultModel: 'devi',
  gateName: 'ds_gate',
});
assert.strictEqual(gated.effort, 'hard');
assert.strictEqual(gated.model, 'qwen2.5');
var providerOnly = orchestrator.resolveModel({
  manifest: { id: 'meera', tier: 'critique', effort_overrides: {} },
  effort: 'standard',
  chain: { effort_matrix: { standard: { provider: 'google', model: 'gemini-2.5-flash' } } },
  config: {},
  defaultProvider: 'host',
  defaultModel: 'devi',
  explicitProvider: 'ollama',
});
assert.strictEqual(providerOnly.provider, 'ollama');
assert.strictEqual(providerOnly.model, 'qwen2.5');
assert.throws(function() {
  policy.resolveAssignment({
    persona: 'arjun',
    effort: 'hard',
    config: {},
    explicitProvider: 'openai',
    explicitModel: 'gpt-4o-mini',
  });
}, /unavailable or not eligible/);
fs.writeFileSync(process.env.ANALYZTHIS_CALIBRATION_FILE, JSON.stringify({
  personas: {
    arjun: {
      hard: {
        provider: 'ollama',
        model: 'qwen2.5',
        effort: ['hard'],
        prompt_hash: promptHash,
        validator_version: 1,
        benchmark_version: 999,
        benchmark_hash: contract.hash,
        judge_policy_version: contract.judge_policy_version,
        expires_at: '2999-01-01T00:00:00.000Z'
      }
    }
  }
}));
assert.strictEqual(policy.resolveAssignment({ persona: 'arjun', effort: 'hard', config: {} }), null);

var project = 'stale-test-' + Date.now();
session.init({ project: project });
session.update({
  project: project,
  patch: {
    active_run: { id: 'new-run', mode: 'chunked', at: new Date().toISOString() },
    persona_outputs: {
      arjun: { text: 'old output', at: new Date().toISOString(), run_id: 'old-run', accepted: null }
    }
  }
});
assert.throws(function() {
  accept.keep({ project: project, persona: 'arjun' });
}, /older run/);

session.logHostTurn({ project: project, path: 'mcp', persona: 'zara', inferred_in: 20, verdicts: 1 });
var hostState = session.show({ project: project });
assert.strictEqual(hostState.persona_outputs.zara.run_id, hostState.active_run.id);
assert.strictEqual(session.markAccepted({ project: project, persona: 'zara', accepted: true }).updated, true);

console.log('ok  calibration core signals / policy / stale feedback');
