#!/usr/bin/env node
'use strict';

var assert = require('assert');
var fs = require('fs');
var os = require('os');
var path = require('path');

var temp = fs.mkdtempSync(path.join(os.tmpdir(), 'analyzthis-chunk-quality-'));
process.env.ANALYZTHIS_TELEMETRY_FILE = path.join(temp, 'telemetry.jsonl');

var executor = require('../lib/chunk-executor');
var telemetry = require('../lib/chunk-telemetry');

(async function() {
  var calls = 0;
  var result = await executor.executeChunk({
    chunk: {
      id: 'audit',
      persona: 'arjun',
      goal: 'Review hierarchy',
      user_prompt: 'Review the screen',
      effort: 'standard',
      output_schema: 'ux_audit',
    },
    config: {
      ollama: { enabled: false },
      chunk_models: {
        pool: [
          { provider: 'ollama', model: 'bad', cost: 0, effort: ['standard'], context: 1000 },
          { provider: 'ollama', model: 'good', cost: 0, effort: ['standard'], context: 900 },
        ],
      },
    },
    maxQualityFailures: 1,
    callLlmFn: async function() {
      calls++;
      return calls === 1
        ? ''
        : 'UX hierarchy and usability need work. Recommend moving the primary action above the fold.';
    },
  });

  assert.strictEqual(calls, 2);
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.model_used.model, 'good');
  var stats = telemetry.getStatsForChunkType('audit', {
    persona: 'arjun',
    effort: 'standard',
    outputFormat: 'ux_audit',
  });
  assert.strictEqual(stats.reduce(function(sum, item) { return sum + item.quality_attempts; }, 0), 2);
  console.log('ok  bounded quality fallback / telemetry');
})().catch(function(error) {
  console.error(error);
  process.exit(1);
});
