#!/usr/bin/env node
'use strict';

var assert = require('assert');
var fs = require('fs');
var os = require('os');
var path = require('path');
var calibrator = require('../lib/calibrate');

var goodByTask = {
  t01: '## Arjun — Lite\nVerdict: revise. Top 2 fixes: rename the action to Save changes; confirm success clearly.',
  t02: 'UX audit: the visual hierarchy makes every action compete. Recommend grouping secondary actions and keeping one primary action.',
  t03: 'The premise and problem framing are unproven. Revise the assumption and request evidence before proceeding.',
  t04: 'REVISE. Top 3 fixes: remove the delay, keep payment immediate, and use restrained feedback as the next action.',
  t05: 'UX audit: this creates usability friction before value is clear. Recommend progressive onboarding and fewer required fields.',
  t06: '## Meera — Lite\nVerdict: revise. Top 2 fixes: keep row actions visible and provide a clear mobile action menu.',
  t07: 'REVISE. Top 3 actions: explain the empty state, suggest queries, and provide a useful next step.',
  t08: 'The premise targets tokens before proving the problem. Revise the framing and gather evidence before proceeding.',
  t09: 'BLOCK. Top 3 actions: add explicit review, summarize permission impact, and require confirmation before the change.',
  t10: 'The navigation premise lacks evidence and may frame the wrong problem. Revise the assumption and test activation barriers.',
  t11: 'UX audit: changing totals breaks trust and usability. Block release and recommend showing the final total before confirmation.',
  t12: '## Zara — Lite\nVerdict: revise. Top 2 fixes: reserve motion for urgent transitions and keep routine status updates calm.',
  t13: '## Noor — Lite\nVerdict: revise. Top 2 fixes: rank one primary action and move the rest into a secondary menu.',
  t14: 'UX audit: the hierarchy is overloaded and usability suffers. Recommend keeping filters and one result summary above the fold.',
  t15: 'REVISE. Top 3 actions: rank the primary task, group secondary controls, and disclose advanced settings progressively.',
  t16: '## Anuj — Lite\nVerdict: revise. Top 2 fixes: add keyboard navigation and expose multi-select bulk actions.',
  t17: 'UX audit: scanning and usability break at this density. Recommend sticky headers, bulk actions, and recoverable errors.',
  t18: 'REVISE. Top 3 actions: add conflict grouping, preview bulk changes, and provide undo as the next step.',
  t19: 'The dashboard premise lacks evidence and may frame the wrong problem. Revise the assumption before proceeding.',
  t20: 'REVISE. Top 3 actions: keep the fast path, add risk-based checks, and measure completion and compliance.',
  t21: 'BLOCK. Top 3 actions: meet accessibility first, narrow business scope, and sequence the engineering work.',
  t22: '## Kavi — Lite\nVerdict: revise. Top 2 fixes: add an owner and record the source date.',
  t23: 'UX audit: conflicting source hierarchy harms trust. Recommend naming authority, freshness, and the durable decision.',
  t24: 'REVISE. Top 3 actions: rank source authority, preserve dissent, and record the governed next decision.'
};

var pool = [
  {
    provider: 'alpha',
    model: 'steady',
    input_per_m: 1,
    output_per_m: 1,
    effort: ['trivial', 'standard', 'hard']
  },
  {
    provider: 'beta',
    model: 'cheap',
    input_per_m: 0.1,
    output_per_m: 0.1,
    effort: ['trivial', 'standard', 'hard']
  },
  {
    provider: 'gamma',
    model: 'judge',
    input_per_m: 0.2,
    output_per_m: 0.2,
    effort: ['trivial', 'standard', 'hard']
  }
];

async function main() {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), 'analyzthis-calibrate-'));
  var runs = path.join(root, 'runs');
  var policyFile = path.join(root, 'policy', 'calibration.json');
  var calls = 0;
  process.env.ANALYZTHIS_CALIBRATION_RUNS_DIR = runs;
  process.env.ANALYZTHIS_CALIBRATION_FILE = policyFile;

  await assert.rejects(function() {
    return calibrator.preview({ pool: pool, maxUsd: Number.NaN });
  }, /max-usd/);

  var budget = await calibrator.calibrate({
    pool: pool,
    maxCalls: 1,
    maxUsd: 10,
    callLlmFn: function() {
      calls += 1;
      throw new Error('must not be called after failed preview');
    }
  });
  assert.strictEqual(budget.status, 'budget_exceeded');
  assert.strictEqual(calls, 0);
  assert.strictEqual(budget.preview.models, 3);
  assert.ok(budget.preview.reasons.indexOf('max_calls') !== -1);

  var floor = calibrator.selectWinner([
    {
      spec: pool[0],
      samples: [{ id: 'a', score: 1 }, { id: 'b', score: 1 }, { id: 'c', score: 0 }],
      pass_rate: 0.66,
      estimated_cost: 1
    }
  ], { minimumEvidence: 3, passRateFloor: 0.7 });
  assert.strictEqual(floor.winner, null);
  assert.strictEqual(floor.reason, 'pass_floor_or_evidence');

  var paired = calibrator.selectWinner([
    {
      spec: pool[0],
      samples: [{ id: 'a', score: 0.9 }, { id: 'b', score: 0.9 }, { id: 'c', score: 0.9 }],
      pass_rate: 1,
      estimated_cost: 0.9
    },
    {
      spec: pool[1],
      samples: [{ id: 'a', score: 0.89 }, { id: 'b', score: 0.89 }, { id: 'c', score: 0.89 }],
      pass_rate: 1,
      estimated_cost: 0.1
    }
  ], { minimumEvidence: 3, delta: 0.05, seed: 42 });
  assert.strictEqual(paired.winner.spec.model, 'cheap');

  var lowConfidence = calibrator.selectWinner([
    {
      spec: pool[0],
      samples: [{ id: 'a', score: 1 }],
      pass_rate: 1,
      estimated_cost: 0.9
    }
  ], { minimumEvidence: 3 });
  assert.strictEqual(lowConfidence.fallback, true);
  assert.strictEqual(lowConfidence.winner, null);

  var tooFewLabels = calibrator.judgeAlignment(new Array(9).fill({ expected: 'A', judged: 'A' }));
  assert.strictEqual(tooFewLabels.fallback, true);
  var alignedLabels = new Array(7).fill({ expected: 'A', judged: 'A' })
    .concat(new Array(3).fill({ expected: 'A', judged: 'B' }));
  assert.strictEqual(calibrator.judgeAlignment(alignedLabels).aligned, true);

  var result = await calibrator.calibrate({
    pool: pool,
    apply: true,
    judge: true,
    maxCalls: 500,
    maxUsd: 1,
    minimumEvidence: 3,
    callLlmFn: function(request) {
      calls += 1;
      var alignmentExpected = {
        j01: 'A', j02: 'B', j03: 'A', j04: 'B', j05: 'A',
        j06: 'B', j07: 'A', j08: 'B', j09: 'A', j10: 'B'
      };
      if (alignmentExpected[request.calibrationTaskId]) {
        return Promise.resolve(alignmentExpected[request.calibrationTaskId]);
      }
      if (request.personaId === 'calibration-judge') return Promise.resolve('A');
      return Promise.resolve(goodByTask[request.calibrationTaskId]);
    }
  });
  assert.strictEqual(result.status, 'completed');
  assert.ok(result.calls > 216 && result.calls <= 500);
  assert.strictEqual(result.policy_file, policyFile);
  assert.ok(fs.existsSync(policyFile));

  var policy = JSON.parse(fs.readFileSync(policyFile, 'utf8'));
  assert.strictEqual(policy.personas.arjun.trivial.model, 'steady');
  assert.strictEqual(policy.personas.zara.hard.provider, 'alpha');
  assert.ok(policy.personas.priya.standard.prompt_hash);
  assert.strictEqual(policy.personas.priya.standard.validator_version, 1);
  assert.strictEqual(policy.personas.priya.standard.benchmark_version, 1);
  assert.strictEqual(policy.personas.priya.standard.judge_policy_version, 1);
  assert.ok(policy.personas.priya.standard.expires_at);

  assert.ok(result.checkpoint.indexOf(runs + path.sep) === 0);
  assert.ok(fs.existsSync(result.checkpoint));
  var checkpointText = fs.readFileSync(result.checkpoint, 'utf8');
  assert.strictEqual(checkpointText.indexOf('A save button says Done'), -1);
  assert.strictEqual(checkpointText.indexOf('Top 2 fixes: rename'), -1);
  assert.strictEqual(fs.existsSync(path.join(root, 'telemetry.json')), false);

  var resumedCalls = 0;
  var resumed = await calibrator.calibrate({
    pool: pool,
    resume: result.checkpoint,
    maxCalls: 500,
    maxUsd: 1,
    minimumEvidence: 3,
    callLlmFn: function() {
      resumedCalls += 1;
      throw new Error('completed samples should not rerun');
    }
  });
  assert.strictEqual(resumedCalls, 0);
  assert.strictEqual(resumed.calls, result.calls);

  delete process.env.ANALYZTHIS_CALIBRATION_RUNS_DIR;
  delete process.env.ANALYZTHIS_CALIBRATION_FILE;
  console.log('ok  calibration budget / floor / paired / fallback / apply / isolation');
}

main().catch(function(error) {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
