'use strict';

/**
 * Reference pack builder (v2.0).
 *
 * Extracted from lib/orchestrator/run.js so both the chunked path
 * (chunk-executor) and the legacy unchunked path can share the same
 * CSV + vault retrieval pipeline.
 *
 * Builds a ranked, citation-ready reference pack for one persona:
 *   1. Query expansion (LLM, cached) → broadened keywords
 *   2. CSV retrieve (file I/O, cached by mtime) → filtered rows
 *   3. Knowledge-bank slice read (cached) → per-persona vault notes
 *   4. LLM ranker → top-5 citations
 *
 * Falls back to static keywords + unranked rows on any error.
 *
 * CommonJS, 'use strict', var.
 */

var fs = require('fs');
var path = require('path');
var retrieve = require('./retrieve');
var knowledge = require('./knowledge');
var queryExpander = require('./query-expander');
var ranker = require('./ranker');

var PRODUCT_KEYWORDS = [
  'saas', 'b2b', 'b2c', 'dashboard', 'analytics', 'e-commerce', 'ecommerce',
  'fintech', 'healthcare', 'crm', 'marketplace', 'admin', 'enterprise',
  'consumer', 'mobile', 'productivity', 'social', 'education', 'finance',
];

var REFERENCE_MAP = {
  arjun: { file: 'styles.csv', column: 'Best For', limit: 3 },
  zara:  { file: 'colors.csv', column: 'Product Type', limit: 3 },
  meera: { file: 'products.csv', column: 'Product Type', limit: 3 },
  noor:  { file: 'ux-guidelines.csv', column: 'Category', limit: 3 },
  anuj:  { file: 'ux-guidelines.csv', column: 'Category', limit: 3 },
  priya: { file: 'react-performance.csv', column: 'Category', limit: 3 },
  raj:   { file: 'products.csv', column: 'Product Type', limit: 3 },
};

function extractKeywords(text) {
  var lower = (text || '').toLowerCase();
  return PRODUCT_KEYWORDS.filter(function(k) { return lower.indexOf(k) !== -1; });
}

function detectStack(vaultPath) {
  if (!vaultPath || !fs.existsSync(path.join(vaultPath, 'Tech'))) return null;
  var techNotes = fs.readdirSync(path.join(vaultPath, 'Tech')).map(function(f) { return f.toLowerCase(); });
  var stacks = ['nextjs', 'react', 'shadcn', 'vue', 'angular', 'svelte', 'nuxtjs', 'astro'];
  for (var i = 0; i < stacks.length; i++) {
    if (techNotes.some(function(n) { return n.indexOf(stacks[i]) !== -1; })) return stacks[i];
  }
  return null;
}

function getReferenceSpec(id, state) {
  var spec = REFERENCE_MAP[id];
  if (!spec) return null;
  if (id === 'priya') {
    var stack = detectStack(state && state.vault_path);
    if (stack) return { file: 'stacks/' + stack + '.csv', column: 'Category', limit: 3 };
  }
  return spec;
}

/**
 * Build a ranked reference pack for one persona.
 *
 * @param {string} id — persona id
 * @param {string} task — task text
 * @param {object} state — session state
 * @param {function} [callLlmFn] — LLM caller (defaults to orchestrator.callLlm)
 * @returns {Promise<{cacheHit: boolean, citations: string[]} | null>}
 */
async function buildReferencePack(id, task, state, callLlmFn) {
  var spec = getReferenceSpec(id, state);
  if (!spec) return null;

  var keywords = extractKeywords(task);

  if (!callLlmFn) {
    try { callLlmFn = require('./orchestrator/run').callLlm; }
    catch (e) { callLlmFn = null; }
  }

  if (callLlmFn) {
    try {
      var expanded = await queryExpander.expandQuery({
        task: task, personaId: id,
        callLlmFn: callLlmFn,
        provider: 'host', model: 'devi',
      });
      if (expanded && expanded.terms && expanded.terms.length) {
        keywords = expanded.terms;
      }
    } catch (e) { /* fall back to static keywords */ }
  }

  if (!keywords.length) return null;

  try {
    var result = retrieve.retrieve({
      file: spec.file,
      filters: [{ column: spec.column, anyOf: keywords }],
      limit: 10,
    });
    if (!result.rows.length) return null;

    var pool = [];
    for (var i = 0; i < result.rows.length; i++) {
      var row = result.rows[i];
      pool.push({
        type: 'reference',
        source: spec.file,
        row: row.__no,
        content: row[spec.column] || '',
      });
    }

    try {
      var kbNotes = knowledge.getPersonaSliceForPrompt(state, id);
      for (var j = 0; j < Math.min(kbNotes.length, 5); j++) {
        pool.push({
          type: 'knowledge',
          source: kbNotes[j].title,
          row: 0,
          content: kbNotes[j].content.slice(0, 200),
        });
      }
    } catch (e) { /* knowledge slices unavailable */ }

    if (callLlmFn) {
      try {
        var ranked = await ranker.rankCandidates({
          personaId: id,
          task: task,
          candidates: pool,
          callLlmFn: callLlmFn,
          provider: 'host', model: 'devi',
        });
        return {
          cacheHit: result.cacheHit,
          citations: ranked.ranked.slice(0, 5).map(function(c) {
            return '[' + c.source + (c.row ? ', row ' + c.row : '') + ': "' + c.content + '"]';
          }),
        };
      } catch (e) { /* fall back to unranked */ }
    }

    return {
      cacheHit: result.cacheHit,
      citations: result.rows.slice(0, 5).map(function(row) {
        return retrieve.cite(spec.file, row, spec.column);
      }),
    };
  } catch (e) {
    return null;
  }
}

module.exports = {
  buildReferencePack: buildReferencePack,
  getReferenceSpec: getReferenceSpec,
  extractKeywords: extractKeywords,
  detectStack: detectStack,
  REFERENCE_MAP: REFERENCE_MAP,
  PRODUCT_KEYWORDS: PRODUCT_KEYWORDS,
};