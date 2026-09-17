'use strict';

/**
 * Chunk telemetry (v2.0).
 *
 * Records per-chunk model performance so the router can learn which
 * model+persona combinations work best.
 *
 * CommonJS, 'use strict', var, try/catch around JSON.
 */

var fs = require('fs');
var path = require('path');
var os = require('os');

var DEFAULT_TELEMETRY_FILE = path.join(os.homedir(), '.analyzthis_design', 'chunk-telemetry.jsonl');
var MAX_LINES = 10000;

function telemetryFile() {
  return process.env.ANALYZTHIS_TELEMETRY_FILE || DEFAULT_TELEMETRY_FILE;
}

function ensureDir() {
  fs.mkdirSync(path.dirname(telemetryFile()), { recursive: true });
}

function loadLines() {
  var file = telemetryFile();
  if (!fs.existsSync(file)) return [];
  try {
    var text = fs.readFileSync(file, 'utf8');
    return text.trim().split('\n').filter(function(l) { return l.trim(); });
  } catch (e) { return []; }
}

function append(record) {
  ensureDir();
  var file = telemetryFile();
  var line = JSON.stringify(record);
  fs.appendFileSync(file, line + '\n');

  // Simple rotation: if file gets too large, keep last half.
  var lines = loadLines();
  if (lines.length > MAX_LINES) {
    var keep = lines.slice(Math.floor(MAX_LINES / 2));
    fs.writeFileSync(file, keep.join('\n') + '\n');
  }
}

function record(record) {
  var r = Object.assign({
    at: new Date().toISOString(),
  }, record);
  append(r);
}

function matchesScope(record, scope) {
  if (!record.scope_version) return false;
  if (scope.persona && record.persona !== scope.persona) return false;
  if (scope.effort && record.effort !== scope.effort) return false;
  if (scope.task_type && record.task_type !== scope.task_type) return false;
  if (scope.output_format && record.output_format !== scope.output_format) return false;
  return true;
}

function aggregate(records, confidence) {
  var byModel = {};
  for (var i = 0; i < records.length; i++) {
    var r = records[i];
    if (!r.model) continue;
    var key = r.model;
    if (!byModel[key]) {
      byModel[key] = {
        model: key,
        attempts: 0,
        transport_successful: 0,
        quality_attempts: 0,
        quality_successful: 0,
        rate_limits: 0,
        total_cost: 0,
        confidence: confidence,
      };
    }
    byModel[key].attempts++;
    if (r.transport_success === true || (r.transport_success == null && r.success)) {
      byModel[key].transport_successful++;
    }
    if (r.failure_kind === 'rate_limit') byModel[key].rate_limits++;
    if (r.quality_pass != null) {
      byModel[key].quality_attempts++;
      if (r.quality_pass) byModel[key].quality_successful++;
    } else if (r.success != null && !r.failure_kind) {
      // Legacy success means API availability only; retain it as low-confidence quality.
      byModel[key].quality_attempts++;
      if (r.success) byModel[key].quality_successful++;
    }
    byModel[key].total_cost += r.cost || 0;
  }
  return Object.keys(byModel).map(function(k) {
    var item = byModel[k];
    // Backward-compatible names for older callers.
    item.successful = item.quality_successful;
    return item;
  });
}

function getStatsForChunkType(chunkType, opts) {
  opts = opts || {};
  var scope = {
    persona: opts.persona || '',
    effort: opts.effort || '',
    task_type: opts.taskType || opts.task_type || chunkType || '',
    output_format: opts.outputFormat || opts.output_format || '',
  };
  var lines = loadLines();
  var parsed = [];
  for (var i = 0; i < lines.length; i++) {
    try {
      var r = JSON.parse(lines[i]);
      if (r.model) parsed.push(r);
    } catch (e) { /* skip corrupt line */ }
  }
  var scoped = parsed.filter(function(r) { return matchesScope(r, scope); });
  if (scoped.length) return aggregate(scoped, 'scoped');
  var legacy = parsed.filter(function(r) { return !r.scope_version; });
  return aggregate(legacy, 'legacy');
}

function getRecentFailures(limit) {
  limit = limit || 20;
  var lines = loadLines();
  var failures = [];
  for (var i = lines.length - 1; i >= 0 && failures.length < limit; i--) {
    try {
      var r = JSON.parse(lines[i]);
      if (!r.success) failures.push(r);
    } catch (e) { /* skip */ }
  }
  return failures;
}

module.exports = {
  record: record,
  getStatsForChunkType: getStatsForChunkType,
  getRecentFailures: getRecentFailures,
  telemetryFile: telemetryFile,
  TELEMETRY_FILE: DEFAULT_TELEMETRY_FILE,
};
