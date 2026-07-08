#!/usr/bin/env node
'use strict';

const path = require('path');
const os   = require('os');
const fs   = require('fs');
const { install, remove, SKILLS, TARGET_DIRS } = require('../lib/install');
const { connect, disconnect, sync, status }     = require('../lib/knowledge');

const HELP = `
Analyzthis_Design — 7 AI design personas with a personal knowledge bank

Usage:
  npx analyzthis_design [command] [options]

── Skill commands ───────────────────────────────────────────
  install    Copy all skills to the target AI tool's directory  (default)
  remove     Delete installed skills from the target AI tool's directory
  list       Show installed skills for a target

── Knowledge bank commands ──────────────────────────────────
  connect    Register a vault or knowledge folder as a source
  sync       Read all sources and build the knowledge-bank skill
  disconnect Remove a source from the registry
  status     Show connected sources and last sync time

── Options ──────────────────────────────────────────────────
  --target   AI tool: cursor | claude | codex | all  (default: cursor)
  --force    Overwrite existing skills on install
  --vault    Path to Obsidian vault or markdown folder (connect command)
  --tags     Comma-separated tags to filter by, e.g. design,brand,ux
  --include  Comma-separated sub-folder names to include, e.g. Design,Brand
  --help     Show this help message

── Examples ─────────────────────────────────────────────────
  npx analyzthis_design                                    # install for Cursor
  npx analyzthis_design --target all                       # install for all tools

  npx analyzthis_design connect --vault ~/Documents/MyVault
  npx analyzthis_design connect --vault ~/docs --tags design,brand,product
  npx analyzthis_design connect --vault ~/vault --include Design,Research
  npx analyzthis_design sync                               # sync to Cursor
  npx analyzthis_design sync --target all                  # sync to all tools
  npx analyzthis_design status                             # show sources
  npx analyzthis_design disconnect --vault ~/Documents/MyVault

── Install paths ────────────────────────────────────────────
  Cursor  → ~/.cursor/skills/
  Claude  → ~/.claude/commands/
  Codex   → ~/.codex/skills/

── Knowledge bank config ────────────────────────────────────
  Config  → ~/.analyzthis_design/config.json

Docs: https://github.com/rishikeshjoshi/analyzthis_design
`;

// ─── Parse args ──────────────────────────────────────────────────────────────

const [,, cmd, ...flags] = process.argv;

function getFlag(name) {
  // Supports both --flag=value and --flag value
  const eq = flags.find(f => f.startsWith(`--${name}=`));
  if (eq) return eq.split('=').slice(1).join('=');
  const idx = flags.indexOf(`--${name}`);
  if (idx !== -1 && flags[idx + 1] && !flags[idx + 1].startsWith('--')) return flags[idx + 1];
  return null;
}

const force      = flags.includes('--force');
const targetVal  = getFlag('target') || 'cursor';
const vaultVal   = getFlag('vault');
const tagsVal    = getFlag('tags');
const includeVal = getFlag('include');

// ─── Commands ────────────────────────────────────────────────────────────────

switch (cmd) {
  case undefined:
  case 'install':
    install({ force, target: targetVal });
    break;

  case 'remove':
  case 'uninstall':
    remove({ target: targetVal });
    break;

  case 'list': {
    const targets = targetVal === 'all' ? Object.keys(TARGET_DIRS) : [targetVal];
    for (const t of targets) {
      const dir = TARGET_DIRS[t];
      console.log(`\nInstalled Analyzthis_Design skills [${t}] (${dir}):\n`);
      for (const skill of SKILLS) {
        const asDir  = path.join(dir, skill);
        const asFile = path.join(dir, `${skill}.md`);
        const exists = fs.existsSync(asDir) || fs.existsSync(asFile);
        console.log(`  ${exists ? '✅' : '✗ '} ${skill}`);
      }
    }
    console.log('');
    break;
  }

  // ── Knowledge bank ──────────────────────────────────────────────────────

  case 'connect': {
    if (!vaultVal) {
      console.error('\n  ✗  --vault is required.  Example: npx analyzthis_design connect --vault ~/Documents/MyVault\n');
      process.exit(1);
    }
    try {
      const tags    = tagsVal    ? tagsVal.split(',').map(t => t.trim())    : [];
      const include = includeVal ? includeVal.split(',').map(t => t.trim()) : [];
      const abs = connect({ vaultPath: vaultVal, tags, include });
      console.log(`\n✅ Connected: ${abs}`);
      if (tags.length)    console.log(`   Tags filter:    ${tags.join(', ')}`);
      if (include.length) console.log(`   Folder filter:  ${include.join(', ')}`);
      console.log(`\n   Run "npx analyzthis_design sync" to build the knowledge bank.\n`);
    } catch (err) {
      console.error(`\n  ✗  ${err.message}\n`);
      process.exit(1);
    }
    break;
  }

  case 'disconnect': {
    if (!vaultVal) {
      console.error('\n  ✗  --vault is required.  Example: npx analyzthis_design disconnect --vault ~/Documents/MyVault\n');
      process.exit(1);
    }
    disconnect(vaultVal);
    console.log(`\n🗑  Disconnected: ${path.resolve(vaultVal)}\n`);
    break;
  }

  case 'sync': {
    const targets = targetVal === 'all' ? Object.keys(TARGET_DIRS) : [targetVal];
    console.log('\n⏳ Syncing knowledge bank...\n');
    try {
      const result = sync({ targets });
      if (result.message) {
        console.log(`  ⚠  ${result.message}\n`);
      } else {
        console.log(`✅ Synced ${result.synced} note(s) into the knowledge bank.`);
        for (const t of result.copiedTo) console.log(`   • ${t}`);
        console.log(`\n💡 The knowledge bank is now active. All personas will read it first.\n`);
      }
    } catch (err) {
      console.error(`\n  ✗  Sync failed: ${err.message}\n`);
      process.exit(1);
    }
    break;
  }

  case 'status': {
    const cfg = status();
    if (!cfg.sources || cfg.sources.length === 0) {
      console.log('\n  No knowledge sources connected.\n  Run: npx analyzthis_design connect --vault /path/to/vault\n');
    } else {
      console.log(`\n📚 Knowledge bank sources (${cfg.sources.length}):\n`);
      for (const s of cfg.sources) {
        console.log(`  • ${s.path}`);
        if (s.tags.length)    console.log(`    Tags:    ${s.tags.join(', ')}`);
        if (s.include.length) console.log(`    Folders: ${s.include.join(', ')}`);
        console.log(`    Added:   ${s.addedAt}`);
      }
      if (cfg.lastSync) console.log(`\n  Last sync: ${cfg.lastSync}`);
      console.log('');
    }
    break;
  }

  case '--help':
  case 'help':
  case '-h':
    console.log(HELP);
    break;

  default:
    console.error(`\nUnknown command: "${cmd}"\n`);
    console.log(HELP);
    process.exit(1);
}
