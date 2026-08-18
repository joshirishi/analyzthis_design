#!/usr/bin/env node
'use strict';

/**
 * Build script for npm publish.
 *
 * Copies source JS files and static assets into dist/ without obfuscation.
 * The package is fully auditable — no minification, no obfuscation, no
 * dynamic require. Security tools can review every file as plain source.
 */

const fs   = require('fs');
const path = require('path');

// Files to copy: [source, destination]
const FILES = [
  ['bin/cli.js',              'dist/bin/cli.js'],
  ['lib/install.js',          'dist/lib/install.js'],
  ['lib/knowledge.js',        'dist/lib/knowledge.js'],
  ['lib/session.js',          'dist/lib/session.js'],
  ['lib/research.js',         'dist/lib/research.js'],
  ['lib/retrieve.js',         'dist/lib/retrieve.js'],
  ['lib/cache.js',            'dist/lib/cache.js'],
  ['lib/export.js',           'dist/lib/export.js'],
  ['lib/cost.js',             'dist/lib/cost.js'],
  ['lib/collect.js',          'dist/lib/collect.js'],
  ['lib/source-discovery.js', 'dist/lib/source-discovery.js'],
  ['lib/design-spec.js',      'dist/lib/design-spec.js'],
  ['lib/feedback.js',         'dist/lib/feedback.js'],
  ['lib/feedback-submit.js',  'dist/lib/feedback-submit.js'],
  ['lib/deliberation.js',     'dist/lib/deliberation.js'],
  ['lib/host-llm.js',         'dist/lib/host-llm.js'],
  ['lib/provider.js',         'dist/lib/provider.js'],
  ['lib/synthesis.js',        'dist/lib/synthesis.js'],
  ['lib/token-gate.js',       'dist/lib/token-gate.js'],
  ['lib/platforms.js',        'dist/lib/platforms.js'],
  ['lib/orchestrator/run.js', 'dist/lib/orchestrator/run.js'],
  ['lib/dedup.js',            'dist/lib/dedup.js'],
  ['lib/lessons.js',          'dist/lib/lessons.js'],
  ['lib/outcome.js',          'dist/lib/outcome.js'],
  ['lib/query-expander.js',   'dist/lib/query-expander.js'],
  ['lib/ranker.js',           'dist/lib/ranker.js'],
  ['lib/evolve.js',           'dist/lib/evolve.js'],
  ['lib/evolution-metrics.js','dist/lib/evolution-metrics.js'],
  ['lib/reference-pack.js',   'dist/lib/reference-pack.js'],
  ['lib/chunk-models.js',     'dist/lib/chunk-models.js'],
  ['lib/chunk-planner.js',    'dist/lib/chunk-planner.js'],
  ['lib/chunk-router.js',     'dist/lib/chunk-router.js'],
  ['lib/chunk-executor.js',   'dist/lib/chunk-executor.js'],
  ['lib/chunk-synthesis.js',  'dist/lib/chunk-synthesis.js'],
  ['lib/chunk-telemetry.js',  'dist/lib/chunk-telemetry.js'],
  ['lib/chunk-run.js',        'dist/lib/chunk-run.js'],
  ['lib/moodboard.js',        'dist/lib/moodboard.js'],
];

const root = path.join(__dirname, '..');

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// Copy JS files as plain source (no obfuscation)
for (const [src, dest] of FILES) {
  const srcPath  = path.join(root, src);
  const destPath = path.join(root, dest);

  if (!fs.existsSync(srcPath)) {
    console.log(`  WARN ${src} not found — skipping`);
    continue;
  }

  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.copyFileSync(srcPath, destPath);
  fs.chmodSync(destPath, 0o755);
  console.log(`  OK   ${src}  ->  ${dest}`);
}

// Copy static assets into dist/
copyDir(path.join(root, 'skills'),   path.join(root, 'dist/skills'));
copyDir(path.join(root, 'agents'),   path.join(root, 'dist/agents'));
copyDir(path.join(root, '.github'),  path.join(root, 'dist/.github'));
fs.copyFileSync(path.join(root, 'README.md'),     path.join(root, 'dist/README.md'));
fs.copyFileSync(path.join(root, 'HOW-TO-USE.md'), path.join(root, 'dist/HOW-TO-USE.md'));

console.log('\nBuild complete (plain source, no obfuscation).\n');