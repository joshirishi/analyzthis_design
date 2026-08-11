'use strict';

var fs = require('fs');
var path = require('path');
var os = require('os');
var crypto = require('crypto');
var cache = require('./cache');
var { resolvePackageRoot } = require('./platforms');

var PACKAGE_ROOT = resolvePackageRoot(__dirname);
var AGENTS_DIR = path.join(PACKAGE_ROOT, 'agents');
var CONFIG_FILE = path.join(os.homedir(), '.analyzthis_design', 'config.json');

function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
  catch { return {}; }
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadManifest(id) {
  var p = path.join(AGENTS_DIR, 'manifests', id + '.json');
  if (!fs.existsSync(p)) return null;
  return loadJson(p);
}

function loadRankerCard() {
  var cardPath = path.join(AGENTS_DIR, 'cards', 'ranker.md');
  if (!fs.existsSync(cardPath)) return '';
  return fs.readFileSync(cardPath, 'utf8');
}

function rankCandidates(opts) {
  var task = opts.task || '';
  var personaId = opts.personaId;
  var candidates = opts.candidates || [];
  var callLlmFn = opts.callLlmFn;
  var provider = opts.provider || 'host';
  var model = opts.model || 'devi';

  if (!personaId || !callLlmFn || !candidates.length) {
    return Promise.resolve({ ranked: candidates.slice(0, 5), cacheHit: false });
  }

  var manifest = loadManifest(personaId);
  var lens = manifest && manifest.allowed_jobs ? manifest.allowed_jobs.join('; ') : '';

  var cacheInput = { task: task, candidates: candidates.map(function(c) { return c.content; }) };
  var cacheKey = 'rank:' + personaId + ':' + crypto.createHash('sha1').update(JSON.stringify(cacheInput)).digest('hex').slice(0, 12);
  var cached = cache.get(cacheKey);
  if (cached) return Promise.resolve({ ranked: cached, cacheHit: true });

  var candidateList = '';
  for (var i = 0; i < candidates.length; i++) {
    var c = candidates[i];
    candidateList += (i + 1) + '. [' + c.source + (c.row ? ' row ' + c.row : '') + ': "' + c.content.slice(0, 200) + '"]\n';
  }

  var system = loadRankerCard();
  var user = 'Task: ' + task + '\nPersona: ' + personaId + '\nPersona lens: ' + lens + '\n\nCandidates:\n' + candidateList + '\nReturn JSON array of candidate numbers (1-indexed) in priority order (most relevant first), max 5.';

  return callLlmFn({
    provider: provider,
    model: model,
    system: system,
    user: user,
    maxTokens: 200,
    personaId: 'ranker',
    hostContext: null
  }).then(function(text) {
    try {
      var ranks = JSON.parse(text.trim());
      if (!Array.isArray(ranks)) ranks = [];
      var ranked = [];
      for (var j = 0; j < ranks.length && j < 5; j++) {
        var idx = ranks[j] - 1;
        if (idx >= 0 && idx < candidates.length) {
          var rc = candidates[idx];
          ranked.push({
            type: rc.type,
            source: rc.source,
            row: rc.row,
            content: rc.content,
            rank: j + 1,
            reason: ''
          });
        }
      }
      cache.set(cacheKey, ranked);
      return { ranked: ranked, cacheHit: false };
    } catch (e) {
      return { ranked: candidates.slice(0, 5), cacheHit: false };
    }
  }).catch(function(err) {
    return { ranked: candidates.slice(0, 5), cacheHit: false };
  });
}

module.exports = {
  rankCandidates: rankCandidates,
  loadRankerCard: loadRankerCard
};