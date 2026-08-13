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

var TELEMETRY_FILE = path.join(os.homedir(), '.analyzthis_design', 'chunk-telemetry.jsonl');
var MAX_LINES = 10000;

function ensureDir() {
  fs.mkdirSync(path.dirname(TELEMETRY_FILE), { recursive: true });
}

function loadLines() {
  if (!fs.existsSync(TELEMETRY_FILE)) return [];
  try {
    var text = fs.readFileSync(TELEMETRY_FILE, 'utf8');
    return text.trim().split('\n').filter(function(l) { return l.trim(); });
  } catch (e) { return []; }
}

function append(record) {
  ensureDir();
  var line = JSON.stringify(record);
  fs.appendFileSync(TELEMETRY_FILE, line + '\n');

  // Simple rotation: if file gets too large, keep last half.
  var lines = loadLines();
  if (lines.length > MAX_LINES) {
    var keep = lines.slice(Math.floor(MAX_LINES / 2));
    fs.writeFileSync(TELEMETRY_FILE, keep.join('\n') + '\n');
  }
}

function record(record) {
  var r = Object.assign({
    at: new Date().toISOString(),
  }, record);
  append(r);
}

function getStatsForChunkType(chunkType) {
  var lines = loadLines();
  var byModel = {};

  for (var i = 0; i < lines.length; i++) {
    try {
      var r = JSON.parse(lines[i]);
      if (!r.model) continue;
      var key = r.model;
      if (!byModel[key]) byModel[key] = { model: key, attempts: 0, successful: 0, total_cost: 0 };
      byModel[key].attempts++;
      if (r.success) byModel[key].successful++;
      byModel[key].total_cost += r.cost || 0;
    } catch (e) { /* skip corrupt line */ }
  }

  return Object.keys(byModel).map(function(k) { return byModel[k]; });
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
  TELEMETRY_FILE: TELEMETRY_FILE,
};
