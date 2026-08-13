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
  arjun: [
    { file: 'styles.csv', column: 'Best For Tags', limit: 3 },
    { file: 'ux-guidelines.csv', column: 'Category', limit: 3 },
    { file: 'ui-reasoning.csv', column: 'UI Category', limit: 3 },
    { file: 'charts.csv', column: 'Data Type', limit: 3 },
  ],
  zara: [
    { file: 'colors.csv', column: 'Product Type', limit: 3 },
    { file: 'typography.csv', column: 'Best For Tags', limit: 3 },
    { file: 'styles.csv', column: 'Best For Tags', limit: 3 },
    { file: 'landing.csv', column: 'Keywords', limit: 3 },
    { file: 'icons.csv', column: 'Keywords', limit: 3 },
  ],
  meera: [
    { file: 'products.csv', column: 'Product Type', limit: 3 },
    { file: 'ui-reasoning.csv', column: 'UI Category', limit: 3 },
    { file: 'landing.csv', column: 'Keywords', limit: 3 },
  ],
  noor: [
    { file: 'ux-guidelines.csv', column: 'Category', limit: 3 },
    { file: 'ui-reasoning.csv', column: 'UI Category', limit: 3 },
    { file: 'app-interface.csv', column: 'Keywords', limit: 3 },
    { file: 'icons.csv', column: 'Keywords', limit: 3 },
  ],
  anuj: [
    { file: 'ux-guidelines.csv', column: 'Category', limit: 3 },
    { file: 'app-interface.csv', column: 'Keywords', limit: 3 },
    { file: 'stacks/shadcn.csv', column: 'Category', limit: 3 },
  ],
  priya: [
    { file: 'react-performance.csv', column: 'Category', limit: 3 },
  ],
  raj: [
    { file: 'products.csv', column: 'Product Type', limit: 3 },
    { file: 'landing.csv', column: 'Keywords', limit: 3 },
  ],
};

function extractKeywords(text) {
  var lower = (text || '').toLowerCase();
  return PRODUCT_KEYWORDS.filter(function(k) { return lower.indexOf(k) !== -1; });
}

function detectStack(vaultPath) {
  if (!vaultPath || !fs.existsSync(path.join(vaultPath, 'Tech'))) return null;
  var techNotes = fs.readdirSync(path.join(vaultPath, 'Tech')).map(function(f) { return f.toLowerCase(); });
  // Check all 16 stacks. Order matters for disambiguation:
  // nuxt-ui must be checked before nuxtjs (nuxt-ui notes may contain "nuxt")
  // shadcn must be checked before react (shadcn notes may contain "react")
  // react-native must be checked before react
  // jetpack-compose must be checked before other android
  var stacks = [
    'nuxt-ui', 'nuxtjs', 'nextjs', 'shadcn', 'react-native', 'react',
    'vue', 'angular', 'svelte', 'astro', 'html-tailwind',
    'flutter', 'swiftui', 'jetpack-compose', 'laravel', 'threejs',
  ];
  for (var i = 0; i < stacks.length; i++) {
    // Match if any tech note filename contains the stack name
    if (techNotes.some(function(n) { return n.indexOf(stacks[i]) !== -1; })) return stacks[i];
  }
  return null;
}

function getReferenceSpec(id, state) {
  var specs = REFERENCE_MAP[id];
  if (!specs) return null;
  if (!Array.isArray(specs)) specs = [specs];
  if (id === 'priya') {
    var stack = detectStack(state && state.vault_path);
    if (stack) return [{ file: 'stacks/' + stack + '.csv', column: 'Category', limit: 3 }];
  }
  return specs;
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
  var specs = getReferenceSpec(id, state);
  if (!specs || !specs.length) return null;

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

  // Pool rows from all specs (multi-file retrieval with shared ranker).
  var pool = [];
  var anyCacheHit = false;

  for (var s = 0; s < specs.length; s++) {
    var spec = specs[s];
    try {
      var result = retrieve.retrieve({
        file: spec.file,
        filters: [{ column: spec.column, anyOf: keywords }],
        limit: 10,
      });
      if (result.cacheHit) anyCacheHit = true;
      if (!result.rows.length) continue;

      for (var i = 0; i < result.rows.length; i++) {
        var row = result.rows[i];
        pool.push({
          type: 'reference',
          source: spec.file,
          row: row.__no,
          content: row[spec.column] || '',
        });
      }
    } catch (e) { /* file missing or unreadable — skip */ }
  }

  // Add knowledge-bank slice notes to the pool.
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

  if (!pool.length) return null;

  // Single ranker call across the merged pool (same cost as before, better coverage).
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
        cacheHit: anyCacheHit,
        citations: ranked.ranked.slice(0, 5).map(function(c) {
          return '[' + c.source + (c.row ? ', row ' + c.row : '') + ': "' + c.content + '"]';
        }),
      };
    } catch (e) { /* fall back to unranked */ }
  }

  // Fallback: first 5 from pool, unranked.
  return {
    cacheHit: anyCacheHit,
    citations: pool.slice(0, 5).map(function(c) {
      return '[' + c.source + (c.row ? ', row ' + c.row : '') + ': "' + c.content + '"]';
    }),
  };
}

module.exports = {
  buildReferencePack: buildReferencePack,
  getReferenceSpec: getReferenceSpec,
  extractKeywords: extractKeywords,
  detectStack: detectStack,
  REFERENCE_MAP: REFERENCE_MAP,
  PRODUCT_KEYWORDS: PRODUCT_KEYWORDS,
};