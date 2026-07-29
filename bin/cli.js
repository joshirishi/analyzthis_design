#!/usr/bin/env node
'use strict';

const path = require('path');
const os   = require('os');
const fs   = require('fs');
const { install, remove, SKILLS, TARGET_DIRS } = require('../lib/install');
const { connect, disconnect, sync, status }     = require('../lib/knowledge');
const session = require('../lib/session');
const research = require('../lib/research');
const { run: orchestratorRun } = require('../lib/orchestrator/run');

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

── Session commands (agentic orchestrator) ──────────────────
  session init    Create a fresh session-state.json for this project
  session show    Print the current session-state.json
  session reset   Delete the session state for this project (--all for every project)

── Research commands ────────────────────────────────────────
  research --url <url>       Fetch a URL and append to session web-context.md
  research --query <text>    Search stub (or provider) appended to web-context.md

── Orchestrator (standalone runtime) ────────────────────────
  run --task <text>          MoE route + persona chain via LLM API (or --dry-run)

── Options ──────────────────────────────────────────────────
  --target   AI tool: cursor | claude | codex | all  (default: cursor)
  --force    Overwrite existing skills on install
  --vault    Path to Obsidian vault or markdown folder (connect command)
  --tags     Comma-separated tags to filter by, e.g. design,brand,ux
  --include  Comma-separated sub-folder names to include, e.g. Design,Brand
  --project  Project id override for session/research/run commands (default: derived from cwd)
  --all      With "session reset", clear every project's session state
  --url      URL to fetch (research command)
  --query    Search query (research command)
  --task     Task description (run command)
  --figma    Figma URL (run command)
  --provider anthropic | openai (run command; default from config or anthropic)
  --model    Model override (run command)
  --dry-run  Print routing + chain without calling any LLM (run command)
  --output   Write final session-state.json to this path (run command)
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

  npx analyzthis_design session init                       # start a new session for this repo
  npx analyzthis_design session show                       # inspect current session state
  npx analyzthis_design session reset                       # clear session state for this repo

  npx analyzthis_design research --url https://example.com/design-tokens
  npx analyzthis_design research --query "EY design system tokens"

  npx analyzthis_design run --task "Fix contrast on landing page" --dry-run
  npx analyzthis_design run --task "Review this screen" --figma https://figma.com/... --provider anthropic

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
const projectVal = getFlag('project');
const allFlag    = flags.includes('--all');
const urlVal     = getFlag('url');
const queryVal   = getFlag('query');
const taskVal    = getFlag('task');
const figmaVal   = getFlag('figma');
const providerVal = getFlag('provider');
const modelVal   = getFlag('model');
const outputVal  = getFlag('output');
const dryRunFlag = flags.includes('--dry-run');

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

  // ── Session (agentic orchestrator) ──────────────────────────────────────

  case 'session': {
    const sub = flags.find(f => !f.startsWith('--'));
    switch (sub) {
      case 'init': {
        const { projectId, filePath } = session.init({ project: projectVal });
        console.log(`\n✅ Session initialized for project "${projectId}"`);
        console.log(`   ${filePath}\n`);
        break;
      }
      case 'show': {
        const state = session.show({ project: projectVal });
        if (!state) {
          console.log('\n  No session found. Run: npx analyzthis_design session init\n');
        } else {
          console.log(JSON.stringify(state, null, 2));
        }
        break;
      }
      case 'reset': {
        const result = session.reset({ project: projectVal, all: allFlag });
        console.log(`\n🗑  Session reset: ${result.removed}\n`);
        break;
      }
      default:
        console.error(`\nUnknown session subcommand: "${sub || ''}". Use: init | show | reset\n`);
        process.exit(1);
    }
    break;
  }

  // ── Research ────────────────────────────────────────────────────────────

  case 'research': {
    (async () => {
      try {
        if (urlVal) {
          console.log(`\n⏳ Fetching ${urlVal}...\n`);
          const result = await research.researchUrl({ url: urlVal, project: projectVal });
          console.log(`✅ Wrote ${result.chars} chars to ${result.filePath}\n`);
        } else if (queryVal) {
          console.log(`\n⏳ Researching "${queryVal}"...\n`);
          const result = await research.researchQuery({ query: queryVal, project: projectVal });
          if (result.mode === 'stub') {
            console.log(`⚠  No research.provider configured — wrote a stub for the host IDE to fill.`);
            console.log(`   ${result.filePath}`);
            console.log(`   Tip: set research.provider in ~/.analyzthis_design/config.json, or use WebSearch in Cursor.\n`);
          } else {
            console.log(`✅ Wrote ${result.chars} chars to ${result.filePath}\n`);
          }
        } else {
          console.error('\n  ✗  Provide --url <url> or --query <text>\n');
          process.exit(1);
        }
      } catch (err) {
        console.error(`\n  ✗  Research failed: ${err.message}\n`);
        process.exit(1);
      }
    })();
    break;
  }

  // ── Orchestrator run (standalone LLM runtime) ───────────────────────────

  case 'run': {
    if (!taskVal) {
      console.error('\n  ✗  --task is required.  Example: npx analyzthis_design run --task "Fix contrast" --dry-run\n');
      process.exit(1);
    }
    orchestratorRun({
      task: taskVal,
      figma: figmaVal || '',
      provider: providerVal,
      model: modelVal,
      dryRun: dryRunFlag,
      project: projectVal,
      output: outputVal,
    }).catch((err) => {
      console.error(`\n  ✗  Run failed: ${err.message}\n`);
      process.exit(1);
    });
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
