'use strict';

/**
 * Release B model calibration. State is separate from production telemetry;
 * public results never return benchmark prompts or raw model output.
 */

var fs = require('fs');
var path = require('path');
var os = require('os');
var crypto = require('crypto');
var chunkModels = require('./chunk-models');
var modelPolicy = require('./model-policy');
var modelRegistry = require('./model-registry');
var outputQuality = require('./output-quality');

var VERSION = 1;
var BENCHMARK_FILE = path.join(__dirname, '..', 'agents', 'calibration-benchmark.json');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { return fallback; }
}

function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}

function modelId(spec) {
  return modelRegistry.id(spec);
}

function family(spec) {
  return String(spec.family || spec.provider || '').toLowerCase();
}

function loadBenchmark(file) {
  var benchmark = readJson(file || BENCHMARK_FILE, null);
  if (!benchmark || !Array.isArray(benchmark.tasks) || !benchmark.tasks.length) {
    throw new Error('Calibration benchmark is missing or invalid.');
  }
  return benchmark;
}

function eligibleTasks(spec, tasks) {
  var efforts = spec.effort || ['trivial', 'standard', 'hard'];
  return tasks.filter(function(task) { return efforts.indexOf(task.effort) !== -1; });
}

function cleanPool(pool) {
  var seen = {};
  return (pool || []).map(modelRegistry.normalizeSpec).filter(function(spec) {
    var id = modelId(spec);
    if (!spec.provider || !spec.model || spec.provider === 'host' || seen[id]) return false;
    if (modelRegistry.isExpired(spec) || !chunkModels.isKeyAvailable(spec)) return false;
    seen[id] = true;
    return true;
  });
}

function validateOptions(opts) {
  opts = opts || {};
  var maxUsd = opts.maxUsd == null ? 5 : Number(opts.maxUsd);
  var maxCalls = opts.maxCalls == null ? 500 : Number(opts.maxCalls);
  var runs = opts.runs == null ? 3 : Number(opts.runs);
  var delta = opts.delta == null ? 0.05 : Number(opts.delta);
  var tokenOptions = ['inputTokens', 'outputTokens', 'judgeInputTokens', 'judgeOutputTokens'];
  if (!Number.isFinite(maxUsd) || maxUsd <= 0) throw new Error('--max-usd must be a finite number above 0.');
  if (!Number.isInteger(maxCalls) || maxCalls <= 0) throw new Error('--max-calls must be a positive integer.');
  if (!Number.isInteger(runs) || runs <= 0 || runs > 20) throw new Error('--runs must be an integer from 1 to 20.');
  if (!Number.isFinite(delta) || delta < 0 || delta > 1) throw new Error('--delta must be between 0 and 1.');
  tokenOptions.forEach(function(name) {
    if (opts[name] == null) return;
    var value = Number(opts[name]);
    if (!Number.isInteger(value) || value <= 0 || value > 1000000) {
      throw new Error(name + ' must be a positive integer.');
    }
  });
  return { maxUsd: maxUsd, maxCalls: maxCalls, runs: runs, delta: delta };
}

function estimatePlan(pool, benchmark, opts) {
  opts = opts || {};
  var inputTokens = Number(opts.inputTokens || 220);
  var outputTokens = Number(opts.outputTokens || 500);
  var judgeInputTokens = Math.max(Number(opts.judgeInputTokens || 1200), outputTokens * 8 + 200);
  var judgeOutputTokens = Number(opts.judgeOutputTokens || 20);
  var calls = 0;
  var usd = 0;
  var byEffort = {};
  var repeats = Number(opts.runs || 3);

  pool.forEach(function(spec) {
    eligibleTasks(spec, benchmark.tasks).forEach(function(task) {
      var taskInputTokens = Math.max(inputTokens, Buffer.byteLength(
        'Follow the requested design-review persona and output format. Return only the review.' + task.prompt,
        'utf8'
      ));
      calls += repeats;
      usd += modelRegistry.estimateCost(spec, taskInputTokens, outputTokens) * repeats;
      byEffort[task.effort] = (byEffort[task.effort] || 0) + repeats;
    });
  });

  if (opts.judge === true) {
    benchmark.tasks.forEach(function(task) {
      var candidates = pool.filter(function(spec) {
        return !spec.effort || spec.effort.indexOf(task.effort) !== -1;
      });
      for (var i = 1; i < candidates.length; i++) {
        var judge = pool.find(function(spec) {
          return modelId(spec) !== modelId(candidates[0]) &&
            modelId(spec) !== modelId(candidates[i]) &&
            family(spec) !== family(candidates[0]) &&
            family(spec) !== family(candidates[i]);
        });
        if (judge) {
          calls += repeats;
          usd += modelRegistry.estimateCost(judge, judgeInputTokens, judgeOutputTokens) * repeats;
        }
      }
    });
    (benchmark.alignment_cases || []).forEach(function() {
      pool.forEach(function(judge) {
        calls += 1;
        usd += modelRegistry.estimateCost(judge, judgeInputTokens, judgeOutputTokens);
      });
    });
  }

  var maxCalls = opts.maxCalls == null ? 500 : Number(opts.maxCalls);
  var maxUsd = opts.maxUsd == null ? 5 : Number(opts.maxUsd);
  var reasons = [];
  if (calls > maxCalls) reasons.push('max_calls');
  if (usd > maxUsd) reasons.push('max_usd');
  return {
    benchmark_version: benchmark.version,
    models: pool.length,
    tasks: benchmark.tasks.length,
    estimated_calls: calls,
    estimated_usd: Number(usd.toFixed(6)),
    calls_by_effort: byEffort,
    allowed: reasons.length === 0,
    reasons: reasons,
  };
}

async function discover(opts) {
  var discoverPoolFn = opts.discoverPoolFn || chunkModels.discoverPool;
  var pool = await discoverPoolFn(opts.discoveryOptions || {});
  return cleanPool(pool);
}

async function preview(opts) {
  opts = opts || {};
  validateOptions(opts);
  var benchmark = loadBenchmark(opts.benchmarkFile);
  var pool = opts.pool ? cleanPool(opts.pool) : await discover(opts);
  return estimatePlan(pool, benchmark, opts);
}

function seededRandom(seed) {
  var state = (Number(seed) || 1) >>> 0;
  return function() {
    state += 0x6D2B79F5;
    var value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function percentile(values, fraction) {
  if (!values.length) return 0;
  var sorted = values.slice().sort(function(a, b) { return a - b; });
  var index = Math.max(0, Math.min(sorted.length - 1, Math.floor(fraction * (sorted.length - 1))));
  return sorted[index];
}

function pairedBootstrap(candidate, reference, opts) {
  opts = opts || {};
  var pairs = [];
  var referenceById = {};
  (reference || []).forEach(function(item, index) {
    referenceById[item.id == null ? String(index) : String(item.id)] = Number(item.score || 0);
  });
  (candidate || []).forEach(function(item, index) {
    var id = item.id == null ? String(index) : String(item.id);
    if (Object.prototype.hasOwnProperty.call(referenceById, id)) {
      pairs.push(Number(item.score || 0) - referenceById[id]);
    }
  });
  if (!pairs.length) return { evidence: 0, mean_difference: 0, low: 0, high: 0 };

  var iterations = Number(opts.iterations || 2000);
  var random = seededRandom(opts.seed == null ? 1701 : opts.seed);
  var means = [];
  for (var i = 0; i < iterations; i++) {
    var total = 0;
    for (var j = 0; j < pairs.length; j++) {
      total += pairs[Math.floor(random() * pairs.length)];
    }
    means.push(total / pairs.length);
  }
  var mean = pairs.reduce(function(sum, value) { return sum + value; }, 0) / pairs.length;
  return {
    evidence: pairs.length,
    mean_difference: Number(mean.toFixed(6)),
    low: Number(percentile(means, 0.025).toFixed(6)),
    high: Number(percentile(means, 0.975).toFixed(6)),
  };
}

function sampleMean(samples) {
  if (!samples.length) return 0;
  return samples.reduce(function(sum, item) { return sum + Number(item.score || 0); }, 0) / samples.length;
}

function selectWinner(candidates, opts) {
  opts = opts || {};
  var delta = Number(opts.delta == null ? 0.05 : opts.delta);
  var passFloor = Number(opts.passRateFloor == null ? 0.7 : opts.passRateFloor);
  var minimumEvidence = Number(opts.minimumEvidence == null ? 3 : opts.minimumEvidence);
  var viable = (candidates || []).filter(function(candidate) {
    return candidate.samples.length >= minimumEvidence && candidate.pass_rate >= passFloor;
  });
  if (!viable.length) {
    return { winner: null, fallback: true, reason: 'pass_floor_or_evidence', comparisons: [] };
  }

  viable.sort(function(a, b) {
    var quality = sampleMean(b.samples) - sampleMean(a.samples);
    return quality || modelId(a.spec).localeCompare(modelId(b.spec));
  });
  var best = viable[0];
  var comparisons = viable.map(function(candidate) {
    var interval = pairedBootstrap(candidate.samples, best.samples, opts);
    return { id: modelId(candidate.spec), interval: interval, non_inferior: interval.evidence >= minimumEvidence && interval.low >= -delta };
  });
  var nonInferior = viable.filter(function(candidate) {
    return comparisons.find(function(item) { return item.id === modelId(candidate.spec); }).non_inferior;
  });
  if (!nonInferior.length) {
    return { winner: null, fallback: true, reason: 'low_confidence', comparisons: comparisons };
  }
  nonInferior.sort(function(a, b) {
    var cost = Number(a.estimated_cost || 0) - Number(b.estimated_cost || 0);
    return cost || modelId(a.spec).localeCompare(modelId(b.spec));
  });
  return { winner: nonInferior[0], fallback: false, reason: 'non_inferior', comparisons: comparisons };
}

function judgeAlignment(labels, opts) {
  opts = opts || {};
  var minimum = Number(opts.minimumJudgeLabels == null ? 10 : opts.minimumJudgeLabels);
  var threshold = Number(opts.judgeAlignmentFloor == null ? 0.7 : opts.judgeAlignmentFloor);
  var usable = (labels || []).filter(function(label) {
    return (label.expected === 'A' || label.expected === 'B') &&
      (label.judged === 'A' || label.judged === 'B');
  });
  var matches = usable.filter(function(label) { return label.expected === label.judged; }).length;
  var rate = usable.length ? matches / usable.length : 0;
  return {
    usable: usable.length,
    rate: Number(rate.toFixed(4)),
    aligned: usable.length >= minimum && rate >= threshold,
    fallback: usable.length < minimum || rate < threshold,
  };
}

function responseText(response) {
  if (typeof response === 'string') return response;
  if (response && typeof response.text === 'string') return response.text;
  if (response && typeof response.content === 'string') return response.content;
  return '';
}

function checkpointDirectory(opts) {
  return opts.runsDir || process.env.ANALYZTHIS_CALIBRATION_RUNS_DIR ||
    process.env.ANALYZTHIS_CALIBRATION_RUN_DIR ||
    path.join(os.homedir(), '.analyzthis_design', 'calibration-runs');
}

function writeCheckpoint(run, opts) {
  var directory = checkpointDirectory(opts);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  var file = path.join(directory, run.run_id + '.json');
  var temporary = file + '.tmp-' + process.pid;
  fs.writeFileSync(temporary, JSON.stringify(run, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, file);
  return file;
}

function safeRun(run) {
  return {
    version: run.version,
    run_id: run.run_id,
    status: run.status,
    started_at: run.started_at,
    completed_at: run.completed_at,
    benchmark_version: run.benchmark_version,
    benchmark_hash: run.benchmark_hash,
    preview: run.preview,
    calls: run.calls,
    spent_usd: run.spent_usd,
    summaries: run.summaries || {},
    selections: run.selections || {},
    judge_alignment: run.judge_alignment || null,
    official_benchmark: true,
    private_tasks: false,
    validator_version: outputQuality.VERSION,
    judge_policy_version: run.judge_policy_version || '1',
    community_rows: run.community_rows || [],
    calibration_results: run.calibration_results || [],
  };
}

function judgeChoice(text) {
  var match = String(text || '').trim().toUpperCase().match(/\b([AB])\b/);
  return match ? match[1] : null;
}

function findJudge(pool, first, second) {
  return pool.find(function(spec) {
    return modelId(spec) !== modelId(first) && modelId(spec) !== modelId(second) &&
      family(spec) !== family(first) && family(spec) !== family(second);
  }) || null;
}

async function callWithBudget(context, spec, args) {
  if (context.calls >= context.maxCalls) {
    var callError = new Error('Calibration call budget exhausted.');
    callError.code = 'CALIBRATION_BUDGET';
    throw callError;
  }
  var call = args.call || {};
  // UTF-8 byte count is a conservative upper bound for provider tokenizers.
  var actualInput = Buffer.byteLength(String(call.system || '') + String(call.user || ''), 'utf8');
  var reservedInput = Math.max(Number(args.inputTokens || 0), actualInput);
  var reservedOutput = Math.max(Number(args.outputTokens || 0), Number(call.maxTokens || 0));
  var estimated = modelRegistry.estimateCost(spec, reservedInput, reservedOutput);
  if (context.spentUsd + estimated > context.maxUsd) {
    var usdError = new Error('Calibration USD budget exhausted.');
    usdError.code = 'CALIBRATION_BUDGET';
    throw usdError;
  }
  context.calls += 1;
  context.spentUsd += estimated;
  return context.callLlmFn(call);
}

function summarize(results, pool, benchmark) {
  var summaries = {};
  benchmark.tasks.forEach(function(task) {
    summaries[task.persona] = summaries[task.persona] || {};
    if (summaries[task.persona][task.effort]) return;
    summaries[task.persona][task.effort] = pool.map(function(spec) {
      var allSamples = results.filter(function(result) {
        return result.persona === task.persona && result.effort === task.effort &&
          result.model === modelId(spec);
      });
      var samples = allSamples.filter(function(sample) { return sample.available !== false; });
      var passed = samples.filter(function(sample) { return sample.pass; }).length;
      var available = samples.length;
      return {
        id: modelId(spec),
        spec: spec,
        samples: samples.map(function(sample) {
          return { id: sample.sample_id, score: sample.score };
        }),
        evidence: samples.length,
        total_attempts: allSamples.length,
        pass_rate: samples.length ? Number((passed / samples.length).toFixed(4)) : 0,
        availability_rate: allSamples.length ? Number((available / allSamples.length).toFixed(4)) : 0,
        latency_ms: samples.length ? Math.round(samples.reduce(function(sum, sample) {
          return sum + Number(sample.latency_ms || 0);
        }, 0) / samples.length) : 0,
        mean_score: Number(sampleMean(samples).toFixed(4)),
        estimated_cost: allSamples.reduce(function(sum, sample) { return sum + sample.estimated_cost; }, 0),
      };
    }).filter(function(summary) { return summary.evidence > 0; });
  });
  return summaries;
}

function applyWinners(selections, benchmark, opts) {
  var file = opts.policyFile || modelPolicy.localFile();
  var policy = readJson(file, {});
  policy.version = modelPolicy.VERSION;
  policy.personas = policy.personas || {};
  var expires = new Date(Date.now() + Number(opts.expiryDays || 30) * 86400000).toISOString();
  benchmark.tasks.forEach(function(task) {
    var selection = selections[task.persona] && selections[task.persona][task.effort];
    if (!selection || !selection.winner || !selection.judge_authorized) return;
    policy.personas[task.persona] = policy.personas[task.persona] || {};
    var spec = selection.winner.spec;
    policy.personas[task.persona][task.effort] = {
      provider: spec.provider,
      model: spec.model,
      effort: spec.effort || [task.effort],
      prompt_hash: modelPolicy.promptHash(task.persona),
      validator_version: outputQuality.VERSION,
      benchmark_version: benchmark.version,
      benchmark_hash: stableHash(benchmark),
      judge_policy_version: benchmark.judge_version || 1,
      calibrated_at: new Date().toISOString(),
      expires_at: expires,
    };
  });
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  var temporary = file + '.tmp-' + process.pid;
  fs.writeFileSync(temporary, JSON.stringify(policy, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(temporary, file);
  return file;
}

async function calibrate(opts) {
  opts = opts || {};
  validateOptions(opts);
  var benchmark = loadBenchmark(opts.benchmarkFile);
  var pool = opts.pool ? cleanPool(opts.pool) : await discover(opts);
  var plan = estimatePlan(pool, benchmark, opts);
  var resumed = opts.resume ? readJson(path.resolve(String(opts.resume)), null) : null;
  var benchmarkHash = stableHash(benchmark);
  if (resumed && resumed.benchmark_hash !== benchmarkHash) {
    throw new Error('Cannot resume: calibration benchmark changed.');
  }
  var run = {
    version: VERSION,
    run_id: opts.runId || (resumed && resumed.run_id) || new Date().toISOString().replace(/[:.]/g, '-') + '-' + stableHash([Date.now(), process.pid]),
    status: 'running',
    started_at: resumed && resumed.started_at || new Date().toISOString(),
    benchmark_version: benchmark.version,
    benchmark_hash: benchmarkHash,
    preview: plan,
    calls: 0,
    spent_usd: 0,
  };
  if (!pool.length) {
    run.status = 'no_models';
    run.completed_at = new Date().toISOString();
    run.checkpoint = writeCheckpoint(safeRun(run), opts);
    var noModelsResult = safeRun(run);
    noModelsResult.checkpoint = run.checkpoint;
    return noModelsResult;
  }
  if (!plan.allowed) {
    run.status = 'budget_exceeded';
    run.completed_at = new Date().toISOString();
    run.checkpoint = writeCheckpoint(safeRun(run), opts);
    var budgetResult = safeRun(run);
    budgetResult.checkpoint = run.checkpoint;
    return budgetResult;
  }

  var callLlmFn = opts.callLlmFn;
  if (!callLlmFn) callLlmFn = require('./orchestrator/run').callLlm;
  var context = {
    callLlmFn: callLlmFn,
    calls: resumed ? Number(resumed.calls || 0) : 0,
    spentUsd: resumed ? Number(resumed.spent_usd || 0) : 0,
    maxCalls: opts.maxCalls == null ? 500 : Number(opts.maxCalls),
    maxUsd: opts.maxUsd == null ? 5 : Number(opts.maxUsd),
  };
  var results = resumed && (opts.judge !== true || resumed.private_outputs) && Array.isArray(resumed.calibration_results)
    ? resumed.calibration_results.slice() : [];
  var outputs = resumed && resumed.private_outputs ? resumed.private_outputs : {};
  var repeats = Number(opts.runs || 3);

  try {
    for (var p = 0; p < pool.length; p++) {
      var spec = pool[p];
      var tasks = eligibleTasks(spec, benchmark.tasks);
      for (var t = 0; t < tasks.length; t++) {
        var task = tasks[t];
        for (var repeat = 0; repeat < repeats; repeat++) {
          var sampleId = task.id + '#' + repeat;
          var alreadyDone = results.some(function(item) {
            return item.model === modelId(spec) && item.sample_id === sampleId;
          });
          if (alreadyDone) continue;
          var inputTokens = Number(opts.inputTokens || 220);
          var outputTokens = Number(opts.outputTokens || 500);
          var response;
          var available = true;
          var startedAt = Date.now();
          try {
            response = await callWithBudget(context, spec, {
              inputTokens: inputTokens,
              outputTokens: outputTokens,
              call: {
                provider: spec.provider,
                model: spec.model,
                system: 'Follow the requested design-review persona and output format. Return only the review.',
                user: task.prompt,
                maxTokens: outputTokens,
                personaId: task.persona,
                calibrationTaskId: task.id,
                calibrationRepeat: repeat,
              },
            });
          } catch (error) {
            if (error && error.code === 'CALIBRATION_BUDGET') throw error;
            response = '';
            available = false;
          }
          var text = responseText(response);
          var validation = (opts.validateOutputFn || outputQuality.validateOutput)(text, {
            persona: task.persona,
            outputFormat: task.output_format,
          });
          outputs[modelId(spec) + '|' + sampleId] = text;
          results.push({
            model: modelId(spec),
            task_id: task.id,
            sample_id: sampleId,
            persona: task.persona,
            output_format: task.output_format,
            effort: task.effort,
            pass: !!validation.pass,
            available: available,
            latency_ms: Date.now() - startedAt,
            score: Number(validation.score || 0),
            estimated_cost: modelRegistry.estimateCost(spec, inputTokens, outputTokens),
          });
          run.calls = context.calls;
          run.spent_usd = Number(context.spentUsd.toFixed(6));
          run.calibration_results = results;
          var baseCheckpoint = safeRun(run);
          if (opts.judge === true) baseCheckpoint.private_outputs = outputs;
          writeCheckpoint(baseCheckpoint, opts);
        }
      }
    }
  } catch (error) {
    run.status = error && error.code === 'CALIBRATION_BUDGET' ? 'budget_exceeded' : 'failed';
    run.error = String(error && error.message || error);
  }

  var summaries = summarize(results, pool, benchmark);
  var judgeVotes = resumed && Array.isArray(resumed.private_judge_votes)
    ? resumed.private_judge_votes.slice() : [];
  var alignmentLabels = resumed && Array.isArray(resumed.private_alignment_labels)
    ? resumed.private_alignment_labels.slice() : [];
  function checkpointJudgeProgress() {
    run.calls = context.calls;
    run.spent_usd = Number(context.spentUsd.toFixed(6));
    run.calibration_results = results;
    var data = safeRun(run);
    data.private_outputs = outputs;
    data.private_judge_votes = judgeVotes;
    data.private_alignment_labels = alignmentLabels;
    writeCheckpoint(data, opts);
  }
  if (opts.judge === true) {
    checkpointJudgeProgress();
  }
  var judgeStopped = false;
  if (run.status === 'running' && opts.judge === true) {
    for (var persona of Object.keys(summaries)) {
      if (judgeStopped) break;
      for (var effort of Object.keys(summaries[persona])) {
        if (judgeStopped) break;
        var ranked = summaries[persona][effort].slice().sort(function(a, b) {
          return b.mean_score - a.mean_score;
        });
        if (ranked.length < 2) continue;
        var reference = ranked[0];
        for (var c = 1; c < ranked.length; c++) {
          var candidate = ranked[c];
          var judge = findJudge(pool, reference.spec, candidate.spec);
          if (!judge) continue;
        var judgeId = modelId(judge);
        var completedAlignmentCases = alignmentLabels.filter(function(label) {
          return label.judge_id === judgeId;
        }).map(function(label) { return label.case_id; });
        if (completedAlignmentCases.length < (benchmark.alignment_cases || []).length) {
          for (var a = 0; a < (benchmark.alignment_cases || []).length; a++) {
            var alignmentCase = benchmark.alignment_cases[a];
            if (completedAlignmentCases.indexOf(alignmentCase.id) !== -1) continue;
            var alignmentAnswer;
            try {
              alignmentAnswer = await callWithBudget(context, judge, {
                inputTokens: Number(opts.judgeInputTokens || 1200),
                outputTokens: Number(opts.judgeOutputTokens || 20),
                call: {
                  provider: judge.provider,
                  model: judge.model,
                  system: 'Choose the more useful design review. Reply only A or B.',
                  user: 'A:\n' + alignmentCase.a + '\n\nB:\n' + alignmentCase.b,
                  maxTokens: Number(opts.judgeOutputTokens || 20),
                  personaId: 'calibration-judge-alignment',
                  calibrationTaskId: alignmentCase.id,
                },
              });
            } catch (alignmentError) {
              run.status = alignmentError && alignmentError.code === 'CALIBRATION_BUDGET'
                ? 'budget_exceeded' : 'failed';
              run.error = String(alignmentError && alignmentError.message || alignmentError);
              judgeStopped = true;
              break;
            }
            var alignmentChoice = judgeChoice(responseText(alignmentAnswer));
            if (!alignmentChoice) continue;
            alignmentLabels.push({
              judge_id: judgeId,
              judge_policy_version: benchmark.judge_version || 1,
              case_id: alignmentCase.id,
              expected: alignmentCase.expected,
              judged: alignmentChoice,
            });
            checkpointJudgeProgress();
          }
        }
        if (judgeStopped) break;
        var thisJudgeAlignment = judgeAlignment(alignmentLabels.filter(function(label) {
          return label.judge_id === judgeId &&
            label.judge_policy_version === (benchmark.judge_version || 1);
        }), opts);
        if (!thisJudgeAlignment.aligned) continue;
          for (var q = 0; q < candidate.samples.length; q++) {
            var sampleId = candidate.samples[q].id;
            var judgedBefore = judgeVotes.some(function(vote) {
              return vote.first_id === reference.id && vote.second_id === candidate.id &&
                vote.sample_id === sampleId;
            });
            if (judgedBefore) continue;
            var first = outputs[modelId(reference.spec) + '|' + sampleId];
            var second = outputs[modelId(candidate.spec) + '|' + sampleId];
            if (!first || !second) continue;
            var judged;
            try {
              judged = await callWithBudget(context, judge, {
                inputTokens: Number(opts.judgeInputTokens || 1200),
                outputTokens: Number(opts.judgeOutputTokens || 20),
                call: {
                  provider: judge.provider,
                  model: judge.model,
                  system: 'Blindly choose the more useful design review. Reply only A or B.',
                  user: 'A:\n' + first + '\n\nB:\n' + second,
                  maxTokens: Number(opts.judgeOutputTokens || 20),
                  personaId: 'calibration-judge',
                },
              });
            } catch (judgeError) {
              run.status = judgeError && judgeError.code === 'CALIBRATION_BUDGET'
                ? 'budget_exceeded' : 'failed';
              run.error = String(judgeError && judgeError.message || judgeError);
              judgeStopped = true;
              break;
            }
            var choice = judgeChoice(responseText(judged));
            if (!choice) continue;
            judgeVotes.push({
              judged: choice,
              first_id: reference.id,
              second_id: candidate.id,
              sample_id: sampleId,
            });
            checkpointJudgeProgress();
          }
        }
      }
    }
  }

  // Judge output affects winners only after separate designer-labelled checks align.
  var alignment = judgeAlignment(alignmentLabels, opts);
  if (alignment.aligned) {
    var votes = {};
    judgeVotes.forEach(function(label) {
      var firstKey = label.first_id + '|' + label.sample_id;
      var secondKey = label.second_id + '|' + label.sample_id;
      votes[firstKey] = votes[firstKey] || [];
      votes[secondKey] = votes[secondKey] || [];
      votes[firstKey].push(label.judged === 'A' ? 1 : 0);
      votes[secondKey].push(label.judged === 'B' ? 1 : 0);
    });
    Object.keys(summaries).forEach(function(persona) {
      Object.keys(summaries[persona]).forEach(function(effort) {
        summaries[persona][effort].forEach(function(summary) {
          summary.samples.forEach(function(sample) {
            var sampleVotes = votes[summary.id + '|' + sample.id] || [];
            if (!sampleVotes.length) return;
            var voteMean = sampleVotes.reduce(function(sum, vote) { return sum + vote; }, 0) / sampleVotes.length;
            sample.score = (sample.score + voteMean) / 2;
          });
          summary.mean_score = Number(sampleMean(summary.samples).toFixed(4));
        });
      });
    });
  }
  var selections = {};
  Object.keys(summaries).forEach(function(persona) {
    selections[persona] = {};
    Object.keys(summaries[persona]).forEach(function(effort) {
      var selection = selectWinner(summaries[persona][effort], opts);
      var winnerId = selection.winner && modelId(selection.winner.spec);
      selection.judge_authorized = !!winnerId && judgeVotes.some(function(vote) {
        var taskId = String(vote.sample_id || '').split('#')[0];
        var task = benchmark.tasks.find(function(item) { return item.id === taskId; });
        return task && task.persona === persona && task.effort === effort &&
          (vote.first_id === winnerId || vote.second_id === winnerId);
      });
      selections[persona][effort] = selection;
    });
  });
  run.calls = context.calls;
  run.spent_usd = Number(context.spentUsd.toFixed(6));
  run.calibration_results = results;
  run.summaries = {};
  Object.keys(summaries).forEach(function(persona) {
    run.summaries[persona] = {};
    Object.keys(summaries[persona]).forEach(function(effort) {
      run.summaries[persona][effort] = summaries[persona][effort].map(function(item) {
        return {
          id: item.id,
          evidence: item.evidence,
          total_attempts: item.total_attempts,
          pass_rate: item.pass_rate,
          availability_rate: item.availability_rate,
          latency_ms: item.latency_ms,
          mean_score: item.mean_score,
          estimated_cost: Number(item.estimated_cost.toFixed(6)),
        };
      });
    });
  });
  run.selections = {};
  Object.keys(selections).forEach(function(persona) {
    run.selections[persona] = {};
    Object.keys(selections[persona]).forEach(function(effort) {
      var selection = selections[persona][effort];
      run.selections[persona][effort] = {
        winner: selection.winner ? modelId(selection.winner.spec) : null,
        fallback: selection.fallback,
        reason: selection.reason,
        judge_authorized: selection.judge_authorized,
        comparisons: selection.comparisons,
      };
    });
  });
  run.judge_alignment = alignment;
  run.judge_policy_version = String(benchmark.judge_version || 1);
  run.community_rows = [];
  Object.keys(summaries).forEach(function(persona) {
    Object.keys(summaries[persona]).forEach(function(effort) {
      summaries[persona][effort].forEach(function(item) {
        var values = item.samples.map(function(sample) { return sample.score; });
        var mean = sampleMean(item.samples);
        var variance = values.length ? values.reduce(function(sum, value) {
          return sum + Math.pow(value - mean, 2);
        }, 0) / values.length : 0;
        var task = benchmark.tasks.find(function(candidate) {
          return candidate.persona === persona && candidate.effort === effort;
        });
        run.community_rows.push({
          persona: persona,
          effort: effort,
          output_format: task && task.output_format || 'generic',
          model_id: item.id,
          prompt_hash: modelPolicy.promptHash(persona),
          sample_count: item.total_attempts,
          score_mean: item.mean_score,
          score_variance: Number(variance.toFixed(6)),
          pass_rate: item.pass_rate,
          latency_ms: item.latency_ms,
          availability_rate: item.availability_rate,
          cost_usd: Number(item.estimated_cost.toFixed(6)),
        });
      });
    });
  });

  if (run.status === 'running') {
    var hasWinner = Object.keys(selections).some(function(persona) {
      return Object.keys(selections[persona]).some(function(effort) {
        return !!selections[persona][effort].winner;
      });
    });
    var allAuthorized = Object.keys(selections).every(function(persona) {
      return Object.keys(selections[persona]).every(function(effort) {
        var selection = selections[persona][effort];
        return !selection.winner || selection.judge_authorized;
      });
    });
    run.status = hasWinner && allAuthorized && opts.judge === true && alignment.aligned && judgeVotes.length
      ? 'completed' : 'low_confidence';
    if (opts.apply === true && run.status === 'completed') {
      run.policy_file = applyWinners(selections, benchmark, opts);
    }
  }
  run.completed_at = new Date().toISOString();
  var checkpointData = safeRun(run);
  if (opts.judge === true && run.status !== 'completed') {
    checkpointData.private_outputs = outputs;
    checkpointData.private_judge_votes = judgeVotes;
    checkpointData.private_alignment_labels = alignmentLabels;
  }
  run.checkpoint = writeCheckpoint(checkpointData, opts);
  var returned = safeRun(run);
  if (run.policy_file) returned.policy_file = run.policy_file;
  returned.checkpoint = run.checkpoint;
  return returned;
}

module.exports = {
  VERSION: VERSION,
  BENCHMARK_FILE: BENCHMARK_FILE,
  preview: preview,
  calibrate: calibrate,
  pairedBootstrap: pairedBootstrap,
  selectWinner: selectWinner,
  judgeAlignment: judgeAlignment,
  estimatePlan: estimatePlan,
};
