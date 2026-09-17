#!/usr/bin/env node
'use strict';

var assert = require('assert');
var submit = require('../lib/feedback-submit');

var cfg = { installId: 'dedupe-only', packageVersion: 'test' };
assert.throws(function() {
  submit.buildCalibrationPayloads({
    official_benchmark: false,
    private_tasks: true,
    community_rows: [{}],
  }, cfg);
}, /Private-task results stay local/);

var rows = submit.buildCalibrationPayloads({
  official_benchmark: true,
  private_tasks: false,
  benchmark_version: '1',
  validator_version: '1',
  judge_policy_version: '1',
  community_rows: [{
    persona: 'arjun',
    effort: 'hard',
    output_format: 'ux_audit',
    model_id: 'ollama/qwen2.5',
    prompt_hash: 'abc',
    sample_count: 3,
    score_mean: 0.8,
    score_variance: 0.01,
    pass_rate: 1,
    latency_ms: 20,
    availability_rate: 1,
    cost_usd: 0,
    private_prompt: 'must not leave machine',
  }],
}, cfg);

assert.strictEqual(rows.length, 1);
assert.strictEqual(rows[0].install_id, 'dedupe-only');
assert.strictEqual(rows[0].private_prompt, undefined);
assert.strictEqual(JSON.stringify(rows).includes('must not leave machine'), false);

console.log('ok  calibration community payload / privacy');
