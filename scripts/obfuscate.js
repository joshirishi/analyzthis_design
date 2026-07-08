#!/usr/bin/env node
'use strict';

const JavaScriptObfuscator = require('javascript-obfuscator');
const fs   = require('fs');
const path = require('path');

// Files to obfuscate: [source, destination]
const FILES = [
  ['bin/cli.js',         'dist/bin/cli.js'],
  ['lib/install.js',     'dist/lib/install.js'],
  ['lib/knowledge.js',   'dist/lib/knowledge.js'],
];

const OPTIONS = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.75,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.4,
  identifierNamesGenerator: 'hexadecimal',
  numbersToExpressions: true,
  renameGlobals: false,        // keep require/module/exports intact
  selfDefending: true,         // breaks if code is reformatted/prettified
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 8,
  stringArray: true,
  stringArrayCallsTransform: true,
  stringArrayEncoding: ['base64'],
  stringArrayIndexShift: true,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayWrappersCount: 3,
  stringArrayWrappersType: 'function',
  transformObjectKeys: true,
  unicodeEscapeSequence: false,
};

const root = path.join(__dirname, '..');

for (const [src, dest] of FILES) {
  const srcPath  = path.join(root, src);
  const destPath = path.join(root, dest);

  const code = fs.readFileSync(srcPath, 'utf8');
  const result = JavaScriptObfuscator.obfuscate(code, OPTIONS);

  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, result.getObfuscatedCode());
  console.log(`  ✅ ${src}  →  ${dest}`);
}

console.log('\n✔ Obfuscation complete.\n');
