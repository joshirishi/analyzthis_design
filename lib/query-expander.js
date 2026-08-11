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

function loadExpanderCard() {
  var cardPath = path.join(AGENTS_DIR, 'cards', 'query-expander.md');
  if (!fs.existsSync(cardPath)) return '';
  return fs.readFileSync(cardPath, 'utf8');
}

function expandQuery(opts) {
  var task = opts.task || '';
  var personaId = opts.personaId;
  var callLlmFn = opts.callLlmFn;
  var provider = opts.provider || 'host';
  var model = opts.model || 'devi';

  if (!personaId || !callLlmFn) {
    return Promise.resolve({ terms: [], cacheHit: false });
  }

  var manifest = loadManifest(personaId);
  var lens = manifest && manifest.allowed_jobs ? manifest.allowed_jobs.join('; ') : '';

  var cacheKey = 'queryexpand:' + personaId + ':' + crypto.createHash('sha1').update(task).digest('hex').slice(0, 12);
  var cached = cache.get(cacheKey);
  if (cached) return Promise.resolve({ terms: cached, cacheHit: true });

  var system = loadExpanderCard();
  var user = 'Task: ' + task + '\nPersona: ' + personaId + '\nPersona lens: ' + lens + '\n\nReturn JSON array of 5-10 search terms only.';

  return callLlmFn({
    provider: provider,
    model: model,
    system: system,
    user: user,
    maxTokens: 200,
    personaId: 'query-expander',
    hostContext: null
  }).then(function(text) {
    try {
      var terms = JSON.parse(text.trim());
      if (!Array.isArray(terms)) terms = [];
      terms = terms.filter(function(t) { return typeof t === 'string' && t.length > 0; }).slice(0, 10);
      cache.set(cacheKey, terms);
      return { terms: terms, cacheHit: false };
    } catch (e) {
      return { terms: [], cacheHit: false };
    }
  }).catch(function(err) {
    return { terms: [], cacheHit: false };
  });
}

module.exports = {
  expandQuery: expandQuery,
  loadExpanderCard: loadExpanderCard
};