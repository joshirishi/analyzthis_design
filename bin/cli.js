#!/usr/bin/env node
'use strict';

const path = require('path');
const os   = require('os');
const fs   = require('fs');
const { install, remove, SKILLS, TARGET_DIRS, printWelcomeBanner } = require('../lib/install');
const { resolveTargets, ALL_TARGET_IDS } = require('../lib/platforms');
const { connect, disconnect, sync, status }     = require('../lib/knowledge');
const session = require('../lib/session');
const research = require('../lib/research');
const retrieve = require('../lib/retrieve');
const { exportTraining } = require('../lib/export');
const feedback = require('../lib/feedback');
const feedbackSubmit = require('../lib/feedback-submit');
const cost = require('../lib/cost');
const { collect } = require('../lib/collect');
const designSpec = require('../lib/design-spec');
const { run: orchestratorRun } = require('../lib/orchestrator/run');
const hostLlm = require('../lib/host-llm');
const moodboard = require('../lib/moodboard');
const calibrator = require('../lib/calibrate');

const HELP = `
Analyzthis_Design — 8 AI design personas with a personal knowledge bank

Usage:
  npx analyzthis_design [command] [options]

── Skill commands ───────────────────────────────────────────
  install    Copy all skills to the target AI tool's directory  (default)
  remove     Delete installed skills from the target AI tool's directory
  list       Show installed skills for a target
  welcome    Print getting-started banner for your AI tool (--target)

── Knowledge bank commands ──────────────────────────────────
  connect    Register a vault or knowledge folder as a source (scoped to cwd project)
  sync       Read this project's sources and build the knowledge-bank skill
  disconnect Remove a source from this project's registry
  status     Show this project's sources and last sync time
  collect    Kavi: scan codebase → Obsidian vault → enrich → sync knowledge bank
             (--vault path, --dry-run, --no-enrich, --no-web, --no-discover,
              --web-limit N, --target cursor|claude|codex|grok|windsurf|agents|all)

  Scope flags (connect/sync/disconnect/status):
  --project <id>   Explicit project id (overrides cwd-derived id)
  --global         Use the legacy merged pool (config.sources → ~/.claude/skills/...)
                   instead of per-project scoping. Only use when you want
                   multiple projects' notes blended together.

── Design spec commands ─────────────────────────────────────
  spec show      Print design_spec from session state
  spec validate  Validate a DesignSpec JSON file (--file) or session
  spec save      Save DesignSpec JSON to session (--file required)
  spec template  Print empty DesignSpec template block

── Session commands (agentic orchestrator) ──────────────────
  session init    Create a fresh session-state.json for this project
  session show    Print the current session-state.json
  session reset   Delete the session state for this project (--all for every project)
  session accept  Mark a persona's last output accepted, for training export
                  (--persona <id>, optional --reject to unmark)
                  Optional feedback: --comment, --correction, --rating 1-5, --tags a,b
  accept          Designer keep / skip (same as /accept). --keep or --fix
                  Optional: --persona, --because "one sentence", --liked (keep, not shipped)
  share           Designer send-to-package (same as /share). Preview, then --send
                  Optional: --because "one sentence", --persona

── Persona feedback commands ─────────────────────────────────
  feedback record   Record unhappiness or a correction for a persona output
                    (--persona <id>, --comment, --correction, --rating 1-5, --tags)
  feedback list     List feedback entries for this project (--all for every project)
  feedback export   Export rejected + correction JSONL pairs for training
                    (--persona <id>, --all, --output <path>, --include-positive)
  feedback submit   Opt-in: send anonymized corrections to a community store (HTTP endpoint)
                    (--yes skip prompt, --dry-run preview, --all unsent across projects)
  feedback status   Show submit consent, endpoint config, unsent count
  feedback revoke   Revoke opt-in consent for community submit

── Efficiency / cost commands ────────────────────────────────
  metrics             Print the last run's cost metrics (--all for every project)
  cost                Print the last run's $ cost from config.pricing (--all for every project)
  calibrate           Compare available models on the fixed persona benchmark
                      (--max-usd 5, --max-calls 500, --runs 3, --judge, --apply)
                      Preview only with --dry-run; share text-free results with --share
  receipt             Inferred token receipt for host (slash/MCP) turns — not a bill
  export-training     Write accepted-output JSONL pairs for LoRA prep
                      (--persona <id>, --all, --output <path>)
  feedback export     Write rejected + correction JSONL pairs (DPO / negative examples)

── Research commands ────────────────────────────────────────
  research --url <url>       Fetch a URL and append to session web-context.md
  research --query <text>    Search stub (or provider) appended to web-context.md

── MCP server (for any AI IDE: Cursor, Claude Desktop, Lovable, v0, Bolt) ──
  mcp                       Start the MCP server on stdio (for MCP client config)
  mcp --configure cursor    Write MCP config to ~/.cursor/mcp.json
  mcp --configure claude    Write MCP config to Claude Desktop + Claude Code
  mcp --configure windsurf   Write MCP config to Windsurf
  mcp --configure <tool>    Print manual MCP config for any other tool
  mcp --catalog lite|full   Lite (default): router + retrieve + session + receipt
                            full: all 19 named tools. Or ANALYZTHIS_MCP_CATALOG=full

── Mood board commands ─────────────────────────────────────
  moodboard create --task <text>   Start a visual mood board (Zara scouts element crops)
                                    [--adjectives a,b,c] [--not "..."] [--sections components,typography]
                                    [--kind mood] for the older link-and-tag board
  moodboard brief --board <id>     Edit the brief [--adjectives] [--not] [--sections] [--yes]
  moodboard capture-script          Print the page script that reads real colours/fonts
                                    [--selector ".pricing-card"]
  moodboard tile --board <id>      Add one element crop: --page <url> --image <file|url>
                                    --element "<what>" --section <id> [--steal] [--refuse]
                                    [--peak] [--colors #hex,..] [--fonts a,b] [--concept]
                                    [--video film.webm] [--stills a.png,b.png]
  moodboard film --board <id>      Record real sites scrolling as motion tiles: --url <url>
                                    (repeatable) [--section motion] [--steal] [--refuse]
                                    Needs playwright-core + Google Chrome
  moodboard critique --board <id>  Team votes on each tile (advice only)
  moodboard votes --board <id>     Save team votes from a JSON file --votes votes.json
  moodboard show --board <id>      Open the clickable board on 127.0.0.1 [--port 4317]
  moodboard decide --board <id>    Your choice: --tile <n> --decision keep|maybe|reject|clear
  moodboard rescout --board <id>   Send Zara back with your note [--note "..."]
  moodboard lock --board <id>      Lock your direction for every persona [--note "..."]
  moodboard add --board <id>       Add a reference to a link board and rerun critique
  moodboard list                   List mood boards for this project

── Reference data (retrieve-on-demand) ───────────────────────
  retrieve --file <csv> --column <col> --keywords a,b   Filtered, citation-ready rows
                              --limit N   (default 3)

── Orchestrator (standalone runtime) ────────────────────────
  run --task <text>          DEFAULT v2.0: frontier planner → cheap chunk models → synthesis
                               --budget free    only zero-cost models (Ollama, free APIs)
                               --budget cheap   include cheap cloud models with user keys
                               --sequential     run chunks sequentially (default)
                               --max-chunks N   cap chunks (default 6)
                               --dry-run        show planner output without executing chunks
                               --unchunked      use the legacy single-pass orchestrator

  run-unchunked --task <text>  Legacy non-chunked orchestrator
                               --continue     resume after /devi fills pending responses
                               --lite (default) MoE subset only | --full allow full chain
                               --experts a,b    explicit override, skips the router entirely
                               --deliberate     adversarial satisfaction loops (default on)
                               --no-deliberate  legacy sequential pass-the-parcel mode
                               --max-rounds N   cap deliberation rounds (default 3)
                               --satisfaction X satisfaction threshold 0.0-1.0 (default 0.4)

── Devi (host LLM — no API keys) ────────────────────────────
  devi status                List pending persona prompts awaiting host LLM responses
                              (--run path to a specific run directory)
  devi respond               Submit a persona response file
                              (--run path, --step 001-arjun, --file response.md)

── Options ──────────────────────────────────────────────────
  --target   Platform: cursor | claude | codex | grok | windsurf | agents | all  (default: cursor)
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
  --provider anthropic | openai | google | zai | ollama | groq | together | openrouter | deepseek | host (default: auto)
  --model    Model override (run / run-unchunked command)
  --continue With "run-unchunked", resume host-mode run after devi respond
  --dry-run  Print routing + chain without calling any LLM (run / run-unchunked command); or show planner output
  --lite     Force MoE subset only, even for full_screen_review (run-unchunked command; default)
  --full     Allow the full design-critic chain for full_screen_review (run-unchunked command)
  --experts  Comma-separated persona ids, bypasses the router entirely (run-unchunked command)
  --budget   free | cheap | auto — chunk model budget (run command; default: auto)
  --sequential  Run chunks sequentially (run command; default on)
  --max-chunks  Cap number of planner chunks (run command; default 6)
  --max-usd  Calibration hard spending limit in USD (default 5)
  --max-calls Calibration hard model-call limit (default 500)
  --runs     Calibration repeats per fixed task/model (default 3)
  --delta    Non-inferiority margin on the 0-1 score scale (default 0.05)
  --judge    Enable blind cross-family calibration judges
  --apply    Write qualified calibration winners to the local policy
  --resume   Resume a calibration checkpoint path
  --share    Opt-in submission of text-free fixed-benchmark aggregates
  --unchunked   Force legacy single-pass orchestrator (run command)
  --output   Write final session-state.json to this path (run / run-unchunked command); or JSONL path (export-training)
  --persona  Persona id (session accept; export-training; feedback commands)
  --reject   With "session accept", mark the output rejected instead of accepted
  --comment  What was wrong or what you liked (session accept / feedback record)
  --correction  How you fixed it or what you wanted instead (session accept / feedback record)
  --rating   1 (very unhappy) to 5 (very happy) — feedback record / session accept
  --include-positive  With "feedback export", include satisfied entries too
  --yes      With "feedback submit", accept consent prompt without asking again
  --deliberate  With "run", force adversarial deliberation loops
  --no-deliberate  With "run", legacy sequential handoff (no objection rounds)
  --max-rounds  With "run", cap deliberation rounds (default 3)
  --satisfaction  With "run", satisfaction threshold 0.0-1.0 (default 0.4)
  --no-enrich  With "collect", write draft vault + sync without LLM enrichment
  --no-web     With "collect", skip fetching URLs from config/PRDs/README
  --no-discover With "collect", skip Obsidian/vault/knowledge-graph discovery
  --web-limit  Cap external URLs fetched during collect (default: 10)
  --limit    Cap notes enriched (collect) or retrieve rows (retrieve)
  --board    Mood board id (moodboard critique / add)
  --title    Reference title (moodboard add)
  --desc     Reference description (moodboard add)
  --auto     With moodboard create, discover references without explicit URLs
  --help     Show this help message

── Examples ─────────────────────────────────────────────────
  npx analyzthis_design                                    # install for Cursor
  npx analyzthis_design --target all                       # install for all tools
  npx analyzthis_design welcome                            # re-print getting-started help
  npx analyzthis_design welcome --target claude

  npx analyzthis_design collect                            # Kavi: scan → vault → enrich → sync
  npx analyzthis_design collect --dry-run                  # preview classification + web URLs
  npx analyzthis_design collect --no-enrich --limit 50
  npx analyzthis_design collect --no-web                   # skip external URL fetch
  npx analyzthis_design collect --vault ~/Documents/MyVault --target all

  npx analyzthis_design connect --vault ~/Documents/MyVault
  npx analyzthis_design connect --vault ~/docs --tags design,brand,product
  npx analyzthis_design connect --vault ~/vault --include Design,Research
  npx analyzthis_design sync                               # sync to Cursor (project-scoped)
  npx analyzthis_design sync --target all                  # sync to all tools (project-scoped)
  npx analyzthis_design sync --global                      # legacy: blend all projects into ~/.claude/skills/
  npx analyzthis_design status                             # show this project's sources
  npx analyzthis_design status --global                    # show the legacy merged pool
  npx analyzthis_design disconnect --vault ~/Documents/MyVault

  npx analyzthis_design session init                       # start a new session for this repo
  npx analyzthis_design session show                       # inspect current session state
  npx analyzthis_design session reset                       # clear session state for this repo

  npx analyzthis_design research --url https://example.com/design-tokens
  npx analyzthis_design research --query "EY design system tokens"

  npx analyzthis_design moodboard create --task "B2B fintech dashboard, trustworthy, high-contrast" --auto
  npx analyzthis_design moodboard create --task "Invoice approval, partner signs" --adjectives calm,precise,trusted --not "AI purple hero"
  npx analyzthis_design moodboard tile --board <id> --page https://linear.app/pricing --image ./crop.png --element "Pricing card" --section components --steal "one quiet CTA"
  npx analyzthis_design moodboard critique --board <boardId>
  npx analyzthis_design moodboard show --board <boardId>
  npx analyzthis_design moodboard add --board <boardId> --url https://dribbble.com/shots/example --title "Alt hero" --tags "landing,trust"

  npx analyzthis_design retrieve --file colors.csv --column "Product Type" --keywords saas,dashboard
  npx analyzthis_design retrieve --file styles.csv --column "Best For" --keywords b2b --limit 3

  npx analyzthis_design run --task "Fix contrast on landing page" --dry-run
  npx analyzthis_design run --task "Review this screen" --budget free
  npx analyzthis_design run --task "Review this screen" --budget cheap --sequential
  npx analyzthis_design run-unchunked --task "Just check spacing" --experts arjun
  npx analyzthis_design devi status
  npx analyzthis_design devi respond --run ~/.analyzthis_design/runs/... --step 001-arjun --file out.md
  npx analyzthis_design run-unchunked --task "Review this screen" --provider anthropic

  npx analyzthis_design accept --keep --persona zara
  npx analyzthis_design accept --fix --persona zara --because "too much motion on the table"
  npx analyzthis_design share
  npx analyzthis_design share --send
  npx analyzthis_design session accept --persona arjun
  npx analyzthis_design session accept --persona arjun --reject \\
    --comment "Invented tokens not in our DS" \\
    --correction "Use --color-primary and spacing-4 from tokens.css" \\
    --rating 2 --tags invented_tokens,missed_ds
  npx analyzthis_design feedback record --persona arjun --rating 2 --comment "..." --correction "..."
  npx analyzthis_design feedback list
  npx analyzthis_design feedback export --persona arjun --all
  npx analyzthis_design feedback submit --dry-run
  npx analyzthis_design feedback submit --all --yes
  npx analyzthis_design feedback status
  npx analyzthis_design metrics
  npx analyzthis_design cost
  npx analyzthis_design export-training --persona arjun --all

── Install paths ────────────────────────────────────────────
  Cursor     → ~/.cursor/skills/
  Claude     → ~/.claude/skills/ (+ legacy ~/.claude/commands/)
  Codex      → ~/.codex/skills/
  Grok       → ~/.grok/skills/
  Windsurf   → ~/.codeium/windsurf/skills/
  agents     → ~/.agents/skills/  (cross-tool discovery)

── Knowledge bank config ────────────────────────────────────
  Config  → ~/.analyzthis_design/config.json

Docs: https://github.com/rishikeshjoshi/analyzthis_design
`;

// ─── Parse args ──────────────────────────────────────────────────────────────

let [, , cmd, ...flags] = process.argv;
// Leading flags mean install: `npx analyzthis_design --target claude`
// Keep --help / -h as help, not install.
if (cmd && cmd.startsWith('-') && cmd !== '--help' && cmd !== '-h') {
  flags = [cmd, ...flags];
  cmd = 'install';
}

function getFlag(name) {
  // Supports both --flag=value and --flag value
  const eq = flags.find(f => f.startsWith(`--${name}=`));
  if (eq) return eq.split('=').slice(1).join('=');
  const idx = flags.indexOf(`--${name}`);
  if (idx !== -1 && flags[idx + 1] && !flags[idx + 1].startsWith('--')) return flags[idx + 1];
  return null;
}

function parseFeedbackTags(raw) {
  if (!raw) return [];
  return raw.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
}

const force      = flags.includes('--force');
const targetVal  = getFlag('target') || 'cursor';
const vaultVal   = getFlag('vault');
const tagsVal    = getFlag('tags');
const includeVal = getFlag('include');
const projectVal = getFlag('project');
const globalFlag = flags.includes('--global');
const allFlag    = flags.includes('--all');
const urlVal     = getFlag('url');
const queryVal   = getFlag('query');
const taskVal    = getFlag('task');
const figmaVal   = getFlag('figma');
const providerVal = getFlag('provider');
const modelVal   = getFlag('model');
const outputVal  = getFlag('output');
const dryRunFlag = flags.includes('--dry-run');
const liteFlag   = flags.includes('--lite');
const fullFlag   = flags.includes('--full');
const expertsVal = getFlag('experts');
const fileVal    = getFlag('file');
const columnVal  = getFlag('column');
const keywordsVal = getFlag('keywords');
const limitVal   = getFlag('limit');
const personaVal = getFlag('persona');
const rejectFlag = flags.includes('--reject');
const commentVal = getFlag('comment');
const correctionVal = getFlag('correction');
const ratingVal = getFlag('rating');
const includePositiveFlag = flags.includes('--include-positive');
const yesFlag = flags.includes('--yes');
const deliberateFlag = flags.includes('--deliberate');
const noDeliberateFlag = flags.includes('--no-deliberate');
const maxRoundsVal = getFlag('max-rounds');
const satisfactionVal = getFlag('satisfaction');
const continueFlag = flags.includes('--continue');
const runDirVal = getFlag('run');
const stepVal = getFlag('step');
const noEnrichFlag = flags.includes('--no-enrich');
const noWebFlag    = flags.includes('--no-web');
const noDiscoverFlag = flags.includes('--no-discover');
const webLimitVal  = getFlag('web-limit');
const boardVal     = getFlag('board');
const titleVal     = getFlag('title');
const descVal      = getFlag('desc');
const autoFlag     = flags.includes('--auto');
const kindVal      = getFlag('kind');
const stealVal     = getFlag('steal');
const refuseVal    = getFlag('refuse');
const peakVal      = getFlag('peak');
const budgetVal    = getFlag('budget');
const sequentialFlag = flags.includes('--sequential');
const maxChunksVal = getFlag('max-chunks');
const unchunkedFlag = flags.includes('--unchunked');
const keepFlag = flags.includes('--keep');
const fixFlag = flags.includes('--fix') || flags.includes('--no');
const likedFlag = flags.includes('--liked');
const becauseVal = getFlag('because');
const sendFlag = flags.includes('--send');
const applyFlag = flags.includes('--apply');
const shareFlag = flags.includes('--share');
const judgeFlag = flags.includes('--judge');
const maxUsdVal = getFlag('max-usd');
const maxCallsVal = getFlag('max-calls');
const runsVal = getFlag('runs');
const deltaVal = getFlag('delta');
const resumeVal = getFlag('resume');
const sectionVal = getFlag('section');
const sectionsVal = getFlag('sections');
const elementVal = getFlag('element');
const imageVal = getFlag('image');
const tileVal = getFlag('tile');
const decisionVal = getFlag('decision');
const noteVal = getFlag('note');
const portVal = getFlag('port');
const selectorVal = getFlag('selector');
const adjectivesVal = getFlag('adjectives');
const notThisVal = getFlag('not');
const colorsVal = getFlag('colors');
const fontsVal = getFlag('fonts');
const votesVal = getFlag('votes');
const conceptFlag = flags.includes('--concept');
const videoVal = getFlag('video');
const stillsVal = getFlag('stills');
const splitList = (raw) => (raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : undefined);

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

  case 'welcome': {
    const targets = resolveTargets(targetVal) || ['cursor'];
    for (const tId of targets) printWelcomeBanner(tId);
    break;
  }

  case 'list': {
    const { TARGETS } = require('../lib/platforms');
    const targets = resolveTargets(targetVal);
    if (!targets) {
      console.error(`\n  ✗  Unknown target "${targetVal}". Choose: ${ALL_TARGET_IDS.join(', ')}, all\n`);
      process.exit(1);
    }
    for (const tId of targets) {
      const t = TARGETS[tId];
      console.log(`\nInstalled Analyzthis_Design skills [${t.label}] (${t.root}):\n`);
      for (const skill of SKILLS) {
        const asDir  = path.join(t.root, skill);
        const asFile = path.join(t.root, `${skill}.md`);
        let exists = fs.existsSync(asDir) || fs.existsSync(asFile);
        if (!exists && t.also) {
          exists = fs.existsSync(path.join(t.also.root, skill)) ||
            fs.existsSync(path.join(t.also.root, `${skill}.md`));
        }
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
      const abs = connect({ vaultPath: vaultVal, tags, include, project: projectVal, global: globalFlag });
      const scopeLabel = globalFlag ? 'global (merged across projects)' : (projectVal || `project derived from ${path.resolve(process.cwd())}`);
      console.log(`\n✅ Connected: ${abs}`);
      console.log(`   Scope: ${scopeLabel}`);
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
    disconnect(vaultVal, { project: projectVal, global: globalFlag });
    console.log(`\n🗑  Disconnected: ${path.resolve(vaultVal)}\n`);
    break;
  }

  case 'sync': {
    const { resolveTargets, ALL_TARGET_IDS } = require('../lib/platforms');
    const targets = resolveTargets(targetVal);
    if (!targets) {
      console.error(`\n  ✗  Unknown target "${targetVal}". Choose: ${ALL_TARGET_IDS.join(', ')}, all\n`);
      process.exit(1);
    }
    const scopeLabel = globalFlag ? 'global (merged across projects)' : (projectVal || `project derived from ${path.resolve(process.cwd())}`);
    console.log(`\n⏳ Syncing knowledge bank (${scopeLabel})...\n`);
    try {
      const result = sync({ targets, project: projectVal, global: globalFlag });
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
    const view = status({ project: projectVal, global: globalFlag });
    if (!view.sources || view.sources.length === 0) {
      const scopeHint = view.scope === 'global'
        ? 'Run: npx analyzthis_design connect --vault /path/to/vault --global'
        : 'Run: npx analyzthis_design collect (from inside the project) or npx analyzthis_design connect --vault /path/to/vault';
      console.log(`\n  No knowledge sources connected for this ${view.scope} scope.\n  ${scopeHint}\n`);
    } else {
      const scopeLabel = view.scope === 'global' ? 'global (merged across projects)' : `project: ${view.projectId}`;
      console.log(`\n📚 Knowledge bank sources (${view.sources.length}) — ${scopeLabel}:\n`);
      for (const s of view.sources) {
        console.log(`  • ${s.path}`);
        if (s.tags && s.tags.length)    console.log(`    Tags:    ${s.tags.join(', ')}`);
        if (s.include && s.include.length) console.log(`    Folders: ${s.include.join(', ')}`);
        console.log(`    Added:   ${s.addedAt}`);
      }
      if (view.lastSync) console.log(`\n  Last sync: ${view.lastSync}`);
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
      case 'accept': {
        if (!personaVal) {
          console.error('\n  ✗  --persona is required.  Example: npx analyzthis_design session accept --persona arjun\n');
          process.exit(1);
        }
        if (commentVal || correctionVal || ratingVal) {
          try {
            const fb = feedback.recordFeedback({
              project: projectVal,
              persona: personaVal,
              satisfied: !rejectFlag,
              rating: ratingVal != null ? Number(ratingVal) : undefined,
              comment: commentVal || '',
              correction: correctionVal || '',
              tags: parseFeedbackTags(tagsVal),
              markRejected: true,
            });
            console.log(`\n✅ Marked "${personaVal}" as ${rejectFlag ? 'rejected' : 'accepted'} with feedback (${fb.entry.id}).\n`);
          } catch (err) {
            console.error(`\n  ✗  ${err.message}\n`);
            process.exit(1);
          }
        } else {
          const result = session.markAccepted({ project: projectVal, persona: personaVal, accepted: !rejectFlag });
          if (!result.updated) {
            console.log(`\n  ⚠  ${result.reason}\n`);
          } else {
            console.log(`\n✅ Marked "${personaVal}" output as ${rejectFlag ? 'rejected' : 'accepted'}.\n`);
          }
        }
        break;
      }
      default:
        console.error(`\nUnknown session subcommand: "${sub || ''}". Use: init | show | reset | accept\n`);
        process.exit(1);
    }
    break;
  }

  // ── Design spec ─────────────────────────────────────────────────────────

  case 'spec': {
    const sub = flags[0] || 'show';
    if (sub === 'template') {
      console.log('\n' + designSpec.templateMarkdown() + '\n');
      break;
    }
    if (sub === 'show') {
      const row = designSpec.showFromSession({ project: projectVal });
      if (!row) {
        console.log('\n  No design_spec in session. Run /design-director or /ux-ideator Phase 7 first.\n');
        break;
      }
      console.log('\n── design_spec ──────────────────────────────────────');
      console.log(JSON.stringify(row.design_spec, null, 2));
      console.log('');
      break;
    }
    if (sub === 'save') {
      if (!fileVal) {
        console.error('\n  ✗  spec save requires --file <path.json>\n');
        process.exit(1);
      }
      try {
        const raw = fs.readFileSync(path.resolve(fileVal), 'utf8');
        const spec = JSON.parse(raw);
        const validation = designSpec.validateDesignSpec(spec);
        if (!validation.valid) {
          console.log('\n✗  Cannot save invalid spec:\n');
          for (const e of validation.errors) console.log(`   • ${e}`);
          console.log('');
          process.exit(1);
        }
        const saved = designSpec.saveToSession(spec, { project: projectVal, merge: false });
        console.log(`\n✅ Saved design_spec to session (${saved.projectId})\n`);
      } catch (err) {
        console.error(`\n  ✗  ${err.message}\n`);
        process.exit(1);
      }
      break;
    }
    if (sub === 'validate') {
      try {
        let result;
        if (fileVal) {
          result = designSpec.validateFile(fileVal);
        } else {
          const row = designSpec.showFromSession({ project: projectVal });
          if (!row) {
            console.error('\n  ✗  No design_spec in session and no --file provided.\n');
            process.exit(1);
          }
          result = { spec: row.design_spec, ...designSpec.validateDesignSpec(row.design_spec) };
        }
        if (result.valid) {
          console.log('\n✅ DesignSpec is valid.\n');
          if (result.spec && !fileVal) {
            console.log(`   status: ${result.spec.status} | screen: ${result.spec.screen_name}\n`);
          }
        } else {
          console.log('\n✗  DesignSpec validation failed:\n');
          for (const e of result.errors) console.log(`   • ${e}`);
          console.log('');
          process.exit(1);
        }
      } catch (err) {
        console.error(`\n  ✗  ${err.message}\n`);
        process.exit(1);
      }
      break;
    }
    console.error('\n  ✗  Unknown spec subcommand. Use: spec show | validate | save | template\n');
    process.exit(1);
  }

  // ── Collect knowledge (Kavi) ────────────────────────────────────────────

  case 'collect': {
    collect({
      project: projectVal,
      vault: vaultVal || undefined,
      dryRun: dryRunFlag,
      enrich: !noEnrichFlag,
      web: !noWebFlag,
      discoverSources: !noDiscoverFlag,
      webLimit: webLimitVal ? parseInt(webLimitVal, 10) : null,
      limit: limitVal ? parseInt(limitVal, 10) : null,
      target: targetVal,
      provider: providerVal,
      model: modelVal,
    }).catch((err) => {
      console.error(`\n  ✗  Collect failed: ${err.message}\n`);
      process.exit(1);
    });
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

  // ── Mood board ───────────────────────────────────────────────────────────

  case 'moodboard': {
    const msub = flags.find((f) => !f.startsWith('--')) || 'create';
    if (msub === 'create') {
      if (!taskVal) {
        console.error('\n  ✗  --task is required.  Example: npx analyzthis_design moodboard create --task "B2B fintech dashboard" --adjectives calm,dense,trusted\n');
        process.exit(1);
      }
      (async () => {
        try {
          const urls = [];
          const raw = flags.filter((f) => f.startsWith('--url=')).map((f) => f.split('=').slice(1).join('='));
          for (let i = 0; i < flags.length; i++) {
            if (flags[i] === '--url' && flags[i + 1] && !flags[i + 1].startsWith('--')) urls.push(flags[i + 1]);
          }
          for (const u of raw) if (urls.indexOf(u) === -1) urls.push(u);
          const result = await moodboard.buildMoodBoard({
            project: projectVal,
            task: taskVal,
            urls: urls,
            kind: kindVal || 'ui',
            discover: autoFlag || urls.length > 0,
            dryRun: dryRunFlag,
            brief: { adjectives: splitList(adjectivesVal), not_this: notThisVal || '', sections: splitList(sectionsVal) },
          });
          console.log(`\n✅ ${result.board.kind === 'ui' ? 'Mood board (visual)' : 'Link mood board'} created: ${result.board.board_id}`);
          if (result.board.kind === 'ui') {
            console.log(`   Sections: ${result.board.brief.sections.join(', ')}`);
            console.log(`   Scout:    Zara round ${result.board.scout.round} — ${result.board.scout.status}`);
            console.log(`   Next:     Zara crops elements, then moodboard tile --board ${result.board.board_id} --page <url> --image <file> --element "<what>" --section components`);
            console.log(`   Then:     moodboard show --board ${result.board.board_id}  (you decide in the browser)`);
            console.log('');
            console.log(result.board.scout.brief);
            console.log('');
          } else {
            console.log(`   References: ${result.board.references.length}`);
          }
          console.log(`   Board dir:  ${result.boardDir}`);
          console.log(`   Workspace:  ${result.workspacePath}\n`);
          if (dryRunFlag) {
            console.log(JSON.stringify(result.board, null, 2).slice(0, 2000));
            console.log('');
          }
        } catch (err) {
          console.error(`\n  ✗  Mood board create failed: ${err.message}\n`);
          process.exit(1);
        }
      })();
      break;
    }
    if (msub === 'critique') {
      if (!boardVal) {
        console.error('\n  ✗  --board is required.  Example: npx analyzthis_design moodboard critique --board <id>\n');
        process.exit(1);
      }
      (async () => {
        try {
          const result = await moodboard.critiqueMoodBoard({
            project: projectVal,
            boardId: boardVal,
            provider: providerVal,
            model: modelVal,
            dryRun: dryRunFlag,
            noDeliberate: noDeliberateFlag,
            maxRounds: maxRoundsVal,
            satisfaction: satisfactionVal,
          });
          console.log(`\n✅ Mood board critique complete: ${result.board.board_id}`);
          console.log(`   Verdict: ${result.board.synthesis?.verdict || 'n/a'}`);
          if (result.board.kind === 'ui' && result.board.scout) {
            console.log(`   Scout:   round ${result.board.scout.round} — ${result.board.scout.status}`);
            console.log(`   Team votes are advice. You decide: moodboard show --board ${result.board.board_id}`);
          }
          console.log(`   Rounds:  ${result.board.deliberation?.round || 0}`);
          console.log(`   Board:   ${result.boardDir || path.join(session.sessionDir(projectVal || session.getProjectId()), 'moodboard', boardVal)}`);
          console.log(`   Workspace: ${result.workspacePath}\n`);
        } catch (err) {
          if (err.name === 'HostLlmPendingError') {
            hostLlm.printDeviInstructions(err);
            process.exit(2);
          }
          console.error(`\n  ✗  Mood board critique failed: ${err.message}\n`);
          process.exit(1);
        }
      })();
      break;
    }
    if (msub === 'film') {
      const urls = flags.filter((f, i) => i > 0 && flags[i - 1] === '--url' && !f.startsWith('--'))
        .concat(flags.filter((f) => f.startsWith('--url=')).map((f) => f.slice(6)));
      if (!boardVal || !urls.length) {
        console.error('\n  ✗  --board and --url are required.  Example: npx analyzthis_design moodboard film --board <id> --url https://osmo.supply --steal "easing taste"\n');
        process.exit(1);
      }
      (async () => {
        try {
          console.log(`\n  🎬 Filming ${urls.length} site${urls.length === 1 ? '' : 's'} (about 15 seconds each)…`);
          const out = await require('../lib/moodboard-film').filmTiles({
            project: projectVal, boardId: boardVal, urls,
            section: sectionVal, element: elementVal, steal: stealVal, refuse: refuseVal, peak: peakVal,
          });
          out.failed.forEach((f) => console.error(`  ✗  ${f.url}: ${f.reason}`));
          const added = out.saved ? out.saved.added : [];
          (out.saved ? out.saved.skipped : []).forEach((s) => console.error(`  ✗  ${s.element}: ${s.reason}`));
          if (!added.length) process.exit(1);
          console.log(`\n✅ ${added.length} film tile${added.length === 1 ? '' : 's'} added: ${added.map((t) => '#' + t.n + ' ' + t.site).join(', ')}`);
          console.log(`   Next: moodboard show --board ${boardVal}\n`);
        } catch (err) {
          console.error(`\n  ✗  ${err.message}\n`);
          process.exit(1);
        }
      })();
      break;
    }
    if (msub === 'tile' || msub === 'frames') {
      const pageUrl = getFlag('page') || urlVal;
      if (!boardVal || !pageUrl) {
        console.error('\n  ✗  --board and --page are required.  Example: npx analyzthis_design moodboard tile --board <id> --page https://linear.app/pricing --image ./crop.png --element "Pricing card" --section components --steal "one quiet CTA"\n');
        process.exit(1);
      }
      try {
        const result = moodboard.addTiles({
          project: projectVal,
          boardId: boardVal,
          tile: {
            page_url: pageUrl,
            element: elementVal || titleVal || '',
            section: sectionVal || 'components',
            image_path: imageVal && !/^https?:\/\//i.test(imageVal) ? imageVal : undefined,
            image_url: imageVal && /^https?:\/\//i.test(imageVal) ? imageVal : (msub === 'frames' ? urlVal : undefined),
            video_path: videoVal,
            stills: splitList(stillsVal),
            tokens: { colors: splitList(colorsVal), fonts: splitList(fontsVal) },
            steal: stealVal || '',
            refuse: refuseVal || '',
            peak: peakVal || '',
            concept: conceptFlag,
          },
        });
        if (result.skipped.length) {
          console.error(`\n  ✗  Not added: ${result.skipped.map((s) => s.reason).join('; ')}\n`);
          process.exit(1);
        }
        console.log(`\n✅ Tile #${result.added[0].n} added (${result.board.tiles.length} on the board)`);
        console.log(`   Next: more tiles, then moodboard critique or moodboard show --board ${result.board.board_id}\n`);
      } catch (err) {
        console.error(`\n  ✗  ${err.message}\n`);
        process.exit(1);
      }
      break;
    }
    if (msub === 'brief') {
      try {
        const result = moodboard.setBrief({
          project: projectVal, boardId: boardVal,
          adjectives: splitList(adjectivesVal), not_this: notThisVal, sections: splitList(sectionsVal),
          confirmed_by_user: yesFlag ? true : undefined,
        });
        console.log(`\n✅ Brief saved: ${JSON.stringify(result.board.brief)}\n`);
      } catch (err) {
        console.error(`\n  ✗  ${err.message}\n`);
        process.exit(1);
      }
      break;
    }
    if (msub === 'votes') {
      try {
        const raw = JSON.parse(fs.readFileSync(votesVal, 'utf8'));
        const result = moodboard.recordPersonaVotes({ project: projectVal, boardId: boardVal, votes: raw.votes || [], verdict: raw.verdict, summary: raw.summary });
        console.log(`\n✅ Team advice saved. ${result.ignored.length} ignored. Next: moodboard show --board ${result.board.board_id}\n`);
      } catch (err) {
        console.error(`\n  ✗  ${err.message}  (usage: moodboard votes --board <id> --votes votes.json)\n`);
        process.exit(1);
      }
      break;
    }
    if (msub === 'decide') {
      try {
        moodboard.recordUserDecision({ project: projectVal, boardId: boardVal, tile: tileVal, decision: decisionVal, note: noteVal || '' });
        console.log(`\n✅ Tile ${tileVal}: ${decisionVal}. Your choice overrides every persona.\n`);
      } catch (err) {
        console.error(`\n  ✗  ${err.message}  (usage: moodboard decide --board <id> --tile 3 --decision keep|maybe|reject|clear --note "...")\n`);
        process.exit(1);
      }
      break;
    }
    if (msub === 'rescout') {
      try {
        const result = moodboard.requestRescout({ project: projectVal, boardId: boardVal, note: noteVal || '' });
        console.log(`\n✅ Zara goes back out (round ${result.board.scout.round}).\n\n${result.board.scout.brief}\n`);
      } catch (err) {
        console.error(`\n  ✗  ${err.message}\n`);
        process.exit(1);
      }
      break;
    }
    if (msub === 'lock') {
      try {
        const result = moodboard.lockDirection({ project: projectVal, boardId: boardVal, note: noteVal || '' });
        const d = result.board.direction;
        console.log(`\n✅ Direction locked: ${d.kept.length} kept, ${d.rejected.length} rejected. Saved to session as design_direction.`);
        if (d.palette.length) console.log(`   Palette: ${d.palette.join(' ')}`);
        if (d.fonts.length) console.log(`   Fonts:   ${d.fonts.join(', ')}`);
        console.log('');
      } catch (err) {
        console.error(`\n  ✗  ${err.message}\n`);
        process.exit(1);
      }
      break;
    }
    if (msub === 'show') {
      if (!boardVal) {
        console.error('\n  ✗  --board is required.  Example: npx analyzthis_design moodboard show --board <id>\n');
        process.exit(1);
      }
      require('../lib/moodboard-view').serveBoard({ project: projectVal, boardId: boardVal, port: portVal != null ? portVal : undefined, onChange: (what, b) => {
        console.log(`   ${new Date().toLocaleTimeString()}  ${what}  — scout: ${b.scout && b.scout.status}`);
      } }).then((live) => {
        console.log(`\n✅ Mood board live at ${live.url}`);
        console.log('   Open it in the browser. Keep / maybe / reject saves instantly. Ctrl+C to stop.\n');
      }).catch((err) => {
        console.error(`\n  ✗  ${err.message}\n`);
        process.exit(1);
      });
      break;
    }
    if (msub === 'capture-script') {
      console.log(moodboard.captureScript(selectorVal || 'body', getFlag('text') || ''));
      break;
    }
    if (msub === 'add') {
      if (!boardVal) {
        console.error('\n  ✗  --board is required.  Example: npx analyzthis_design moodboard add --board <id> --url <url>\n');
        process.exit(1);
      }
      (async () => {
        try {
          const tags = tagsVal ? tagsVal.split(',').map((t) => t.trim()).filter(Boolean) : [];
          const result = await moodboard.addUserReferenceAndRerun({
            project: projectVal,
            boardId: boardVal,
            reference: {
              url: urlVal || '',
              title: titleVal || '',
              description: descVal || '',
              tags: tags,
              note: commentVal || '',
            },
            provider: providerVal,
            model: modelVal,
            dryRun: dryRunFlag,
            noDeliberate: noDeliberateFlag,
            maxRounds: maxRoundsVal,
            satisfaction: satisfactionVal,
          });
          console.log(`\n✅ Added reference to board ${result.board.board_id}: ${result.added.id}`);
          console.log(`   Total references: ${result.board.references.length}`);
          console.log(`   Verdict: ${result.board.synthesis?.verdict || 'n/a'}\n`);
        } catch (err) {
          if (err.name === 'HostLlmPendingError') {
            hostLlm.printDeviInstructions(err);
            process.exit(2);
          }
          console.error(`\n  ✗  Mood board add failed: ${err.message}\n`);
          process.exit(1);
        }
      })();
      break;
    }
    if (msub === 'list') {
      const boards = moodboard.listBoards(projectVal);
      if (!boards.length) {
        console.log('\n  No mood boards found for this project.\n');
      } else {
        console.log(`\n── Mood boards (${boards.length}) ──`);
        for (const b of boards) console.log(`  • ${b}`);
        console.log('');
      }
      break;
    }
    console.error('\n  Unknown moodboard subcommand. Use: create | brief | tile | critique | votes | show | decide | rescout | lock | capture-script | add | list\n');
    process.exit(1);
  }

  // ── MCP server ─────────────────────────────────────────────────────────

  case 'mcp': {
    const mcpServer = require('../lib/mcp-server');
    const configureTarget = getFlag('configure');
    const catalogVal = getFlag('catalog');
    if (configureTarget) {
      mcpServer.writeMcpConfig(configureTarget, { catalog: catalogVal });
      break;
    }
    mcpServer.startStdioServer(catalogVal);
    break;
  }

  // ── Retrieve-on-demand reference rows ───────────────────────────────────

  case 'retrieve': {
    if (!fileVal) {
      console.error('\n  ✗  --file is required.  Example: npx analyzthis_design retrieve --file colors.csv --column "Product Type" --keywords saas\n');
      process.exit(1);
    }
    try {
      const keywords = keywordsVal ? keywordsVal.split(',').map(s => s.trim()).filter(Boolean) : [];
      const filters = columnVal && keywords.length ? [{ column: columnVal, anyOf: keywords }] : [];
      const limit = limitVal ? parseInt(limitVal, 10) : 3;
      const result = retrieve.retrieve({ file: fileVal, filters, limit });
      if (!result.rows.length) {
        console.log(`\n  No rows matched in ${fileVal}${columnVal ? ` for column "${columnVal}"` : ''}${keywords.length ? ` with keywords: ${keywords.join(', ')}` : ''}.\n`);
      } else {
        console.log(`\n📋 ${result.rows.length}/${result.matched} matching row(s) in ${fileVal}${result.cacheHit ? ' (cache hit)' : ''}:\n`);
        for (const row of result.rows) {
          console.log(`  Row ${row.__no}:`);
          for (const [k, v] of Object.entries(row)) {
            if (k.startsWith('__') || !v) continue;
            console.log(`    ${k}: ${v}`);
          }
          console.log('');
        }
        if (columnVal) console.log(`  Citation format: [${fileVal}, row N: "${columnVal} value"]\n`);
      }
    } catch (err) {
      console.error(`\n  ✗  ${err.message}\n`);
      process.exit(1);
    }
    break;
  }

  // ── Orchestrator run (chunked by default, v2.0) ───────────────────────────

  case 'run': {
    if (!taskVal) {
      console.error('\n  ✗  --task is required.  Example: npx analyzthis_design run --task "Review onboarding flow" --budget free\n');
      process.exit(1);
    }
    (async () => {
      try {
        const result = await orchestratorRun({
          task: taskVal,
          figma: figmaVal || '',
          project: projectVal,
          provider: providerVal,
          model: modelVal,
          dryRun: dryRunFlag,
          budget: budgetVal || 'auto',
          sequential: sequentialFlag || !flags.includes('--parallel'),
          maxChunks: maxChunksVal ? parseInt(maxChunksVal, 10) : null,
          unchunked: unchunkedFlag,
          output: outputVal,
          continueRun: continueFlag,
        });
        if (dryRunFlag) {
          console.log('\n── Chunk plan (dry run) ──');
          console.log(JSON.stringify(result.plan || result, null, 2).slice(0, 3000));
          console.log('');
          return;
        }
        if (result.mode === 'host_pending' || result.host_pending) {
          const pending = result.host_pending;
          console.log('\n╔══════════════════════════════════════════════════════════════════════╗');
          console.log('║  DEVI — Host LLM pending (chunk planner)                             ║');
          console.log('╚══════════════════════════════════════════════════════════════════════╝\n');
          console.log(`  Step:             ${pending.step_id}`);
          console.log(`  Prompt file:      ${path.join(pending.run_dir, 'pending', pending.step_id + '.json')}`);
          console.log(`  Run directory:    ${pending.run_dir}`);
          console.log('\n  In Cursor, invoke:  /devi');
          console.log('  Or submit response:');
          console.log(`    npx analyzthis_design devi respond --run ${pending.run_dir} --step ${pending.step_id} --file response.md`);
          console.log('  Then continue:');
          console.log(`    npx analyzthis_design run --continue --task "${taskVal}"\n`);
          process.exit(2);
          return;
        }
      } catch (err) {
        if (err.name === 'HostLlmPendingError') {
          hostLlm.printDeviInstructions(err);
          process.exit(2);
        }
        console.error(`\n  ✗  Run failed: ${err.message}\n`);
        process.exit(1);
      }
    })();
    break;
  }

  case 'run-unchunked': {
    let runTask = taskVal;
    if (!runTask && continueFlag) {
      const st = session.show({ project: projectVal });
      runTask = st?.host_run?.task || hostLlm.loadManifest(st?.host_run?.run_dir || '')?.task || st?.digest?.task_map_summary;
    }
    if (!runTask) {
      console.error('\n  ✗  --task is required.  Example: npx analyzthis_design run-unchunked --task "Fix contrast" --dry-run\n');
      process.exit(1);
    }
    orchestratorRun({
      task: runTask,
      figma: figmaVal || '',
      provider: providerVal,
      model: modelVal,
      dryRun: dryRunFlag,
      lite: liteFlag,
      full: fullFlag,
      deliberate: deliberateFlag ? true : null,
      noDeliberate: noDeliberateFlag,
      maxRounds: maxRoundsVal,
      satisfaction: satisfactionVal,
      continueRun: continueFlag,
      experts: expertsVal ? expertsVal.split(',').map((s) => s.trim()).filter(Boolean) : null,
      project: projectVal,
      output: outputVal,
      unchunked: true,
    }).catch((err) => {
      if (err.name === 'HostLlmPendingError') process.exit(2);
      console.error(`\n  ✗  Run failed: ${err.message}\n`);
      process.exit(1);
    });
    break;
  }

  case 'devi': {
    const sub = flags[0];
    if (sub === 'status') {
      let runDir = runDirVal;
      if (!runDir) {
        const st = session.show({ project: projectVal });
        runDir = st?.host_run?.run_dir || hostLlm.findLatestRun(st?.project_id || session.getProjectId())?.runDir;
      }
      if (!runDir || !fs.existsSync(runDir)) {
        console.log('\n  No host run found. Start one: npx analyzthis_design run --task "..." --full\n');
        break;
      }
      const pending = hostLlm.listPending(runDir);
      console.log(`\n📋 Devi — host run: ${runDir}\n`);
      for (const p of pending) {
        console.log(`  ${p.hasResponse ? '✅' : '⏳'} ${p.stepId} (${p.personaId})`);
      }
      const waiting = pending.filter((p) => !p.hasResponse);
      if (waiting.length) {
        console.log(`\n  ${waiting.length} pending — invoke /devi in Cursor or devi respond for each step.\n`);
      } else {
        console.log('\n  All responses present — run: npx analyzthis_design run --continue --task "..."\n');
      }
      break;
    }
    if (sub === 'respond') {
      if (!runDirVal || !stepVal || !fileVal) {
        console.error('\n  ✗  devi respond requires --run, --step, and --file\n');
        process.exit(1);
      }
      const text = fs.readFileSync(path.resolve(fileVal), 'utf8');
      hostLlm.submitResponse(path.resolve(runDirVal), stepVal, text);
      console.log(`\n✅ Wrote response for ${stepVal}\n`);
      break;
    }
    console.log('\n  Usage: devi status | devi respond --run <dir> --step <id> --file <path>\n');
    break;
  }

  // ── Efficiency / cost metrics ────────────────────────────────────────────

  case 'metrics': {
    const projectIds = allFlag ? session.listProjects() : [projectVal || session.getProjectId()];
    if (!projectIds.length) {
      console.log('\n  No sessions found.\n');
      break;
    }
    console.log('\n📊 Last-run metrics\n');
    for (const projectId of projectIds) {
      const state = session.show({ project: projectId });
      if (!state) continue;
      const m = state.metrics || {};
      console.log(`  ${projectId}`);
      console.log(`    mode:              ${m.mode ?? 'n/a'}`);
      console.log(`    llm_calls:         ${m.llm_calls ?? 0}`);
      console.log(`    experts_run:       ${(m.experts_run || []).join(', ') || 'none'}`);
      console.log(`    input_tokens_est:  ${m.input_tokens_est ?? 0}`);
      console.log(`    output_tokens_est: ${m.output_tokens_est ?? 0}`);
      console.log(`    cache_hits:        ${m.cache_hits ?? 0}`);
      console.log(`    deliberation_rounds: ${m.deliberation_rounds ?? 0}`);
      console.log(`    objections_raised: ${m.objections_raised ?? 0}`);
      console.log(`    objections_resolved: ${m.objections_resolved ?? 0}`);
      console.log(`    raj_escalations:   ${m.raj_escalations ?? 0}`);
      console.log(`    host_turns:        ${(m.host_turns || []).length}`);
      console.log(`    tokens_per_verdict: ${m.tokens_per_verdict ?? 'n/a'}`);
      const d = state.deliberation;
      if (d?.mode) {
        console.log(`    deliberation_mode: ${d.mode}, consensus=${d.consensus_reached}`);
      }
      console.log('');
    }
    break;
  }

  // ── $-cost report (v1.10) ────────────────────────────────────────────────

  case 'cost': {
    cost.report({ project: projectVal, all: allFlag });
    break;
  }

  case 'calibrate': {
    (async () => {
      try {
        if (shareFlag && dryRunFlag && resumeVal) {
          const saved = JSON.parse(fs.readFileSync(path.resolve(resumeVal), 'utf8'));
          const shared = await feedbackSubmit.submitCalibration(saved, { dryRun: true, yes: yesFlag });
          console.log(`\n── Calibration share preview (${shared.rows.length} text-free rows) ──`);
          console.log(JSON.stringify(shared.rows[0], null, 2));
          console.log('');
          return;
        }

        const options = {
          maxUsd: maxUsdVal == null ? 5 : Number(maxUsdVal),
          maxCalls: maxCallsVal == null ? 500 : Number(maxCallsVal),
          runs: runsVal == null ? 3 : Number(runsVal),
          delta: deltaVal == null ? 0.05 : Number(deltaVal),
          judge: judgeFlag,
          apply: applyFlag,
          resume: resumeVal || null,
        };
        const preview = await calibrator.preview(options);
        console.log('\n── Calibration preview ─────────────────────────────');
        console.log(`  Models:          ${preview.models}`);
        console.log(`  Fixed tasks:     ${preview.tasks}`);
        console.log(`  Planned calls:   ${preview.estimated_calls}/${options.maxCalls}`);
        console.log(`  Worst-case cost: $${preview.estimated_usd.toFixed(4)}/$${options.maxUsd.toFixed(2)}`);
        if (!preview.allowed) {
          console.error(`  Blocked by:      ${preview.reasons.join(', ')}\n`);
          process.exitCode = 1;
          return;
        }
        if (dryRunFlag) {
          console.log('  Preview only: no model calls or policy writes.\n');
          return;
        }

        if (!yesFlag) {
          if (!process.stdin.isTTY) {
            throw new Error('Non-interactive terminal. Pass --yes after reviewing the cost preview.');
          }
          const readline = require('readline');
          const approved = await new Promise((resolve) => {
            const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
            rl.question('Run this calibration? [y/N] ', (answer) => {
              rl.close();
              resolve(/^y(es)?$/i.test(String(answer || '').trim()));
            });
          });
          if (!approved) {
            console.log('\n  Calibration cancelled.\n');
            return;
          }
        }

        const result = await calibrator.calibrate(options);
        console.log(`\n── Calibration ${result.status} ─────────────────────`);
        console.log(`  Calls:      ${result.calls}`);
        console.log(`  Cost:       $${Number(result.spent_usd || 0).toFixed(4)}`);
        console.log(`  Checkpoint: ${result.checkpoint}`);
        Object.entries(result.selections || {}).forEach(([persona, efforts]) => {
          Object.entries(efforts).forEach(([effort, selection]) => {
            console.log(`  ${persona}/${effort}: ${selection.winner || 'keep current'} (${selection.reason})`);
          });
        });
        if (result.policy_file) console.log(`  Local policy: ${result.policy_file}`);

        if (shareFlag) {
          const shared = await feedbackSubmit.submitCalibration(result, { dryRun: false, yes: yesFlag });
          console.log(`  Shared:      ${shared.submitted || 0} fixed-benchmark rows`);
        }
        console.log('');
      } catch (error) {
        console.error(`\n  ✗  ${error.message}\n`);
        process.exitCode = 1;
      }
    })();
    break;
  }

  case 'scores': {
    const em = require('../lib/evolution-metrics');
    if (flags.includes('--submit') || flags.includes('--submit-dry-run')) {
      const submitter = require('../lib/feedback-submit');
      const dry = flags.includes('--submit-dry-run');
      submitter.submitScores({ dryRun: dry })
        .then((r) => {
          if (r.skipped) console.log(`\n  Not sent: ${r.skipped}\n`);
          else if (r.dryRun) console.log(`\n  Would send ${r.rows.length} persona score row(s). Counts only — no note text.\n`);
          else console.log(`\n  Sent ${r.sent} persona score row(s).\n`);
        })
        .catch((e) => console.log(`\n  Submit failed: ${e.message}\n`));
      break;
    }
    const metrics = em.computeEvolutionMetrics(projectVal ? { project: projectVal } : undefined);
    if (personaVal) {
      const m = metrics.personas[personaVal];
      if (!m) {
        console.log(`\n  Unknown persona "${personaVal}". Use: ${em.PERSONAS.join(', ')}\n`);
        break;
      }
      console.log(`\n  ${personaVal}: ${m.score}/100 ${m.level}` +
        (m.sufficient_evidence ? '' : ' (insufficient evidence)'));
      console.log(`  ${m.evidence_count} signal(s) · shipped ${m.outcome_breakdown.shipped}` +
        ` · revised ${m.outcome_breakdown.revised} · missed ${m.outcome_breakdown.missed}` +
        (m.avg_rating != null ? ` · avg rating ${m.avg_rating}` : ''));
      console.log(`  contributions: ${JSON.stringify(m.contributions)}\n`);
      break;
    }
    console.log('\n' + em.formatEvolutionSummary(metrics));
    break;
  }

  case 'system-prompt': {
    // The only path into the personas for browser-only tools (Lovable, v0, Bolt,
    // Replit, ChatGPT). They cannot reach the MCP server — it speaks stdio, and a
    // cloud-hosted tool cannot spawn a process on the user's machine.
    const builder = require('../lib/system-prompt');
    const mode = getFlag('mode') || 'both';
    if (!['create', 'critique', 'both'].includes(mode)) {
      console.log(`\n  Unknown mode "${mode}". Use: create, critique, or both.\n`);
      break;
    }
    const prompt = builder.buildPrompt({ mode });
    const out = getFlag('out');
    if (out) {
      require('fs').writeFileSync(out, prompt);
      console.log(`\n  Wrote ${prompt.length} chars to ${out}\n  Paste it into your tool's system instructions.\n`);
    } else {
      console.log(prompt);
    }
    break;
  }

  case 'receipt': {
    const receipt = require('../lib/receipt');
    console.log('\n' + receipt.report({ project: projectVal }) + '\n');
    break;
  }

  case 'accept': {
    const accept = require('../lib/accept');
    const wantKeep = keepFlag || yesFlag;
    const wantFix = fixFlag;
    try {
      if (wantKeep && wantFix) {
        console.error('\n  ✗  Use --keep or --fix, not both.\n');
        process.exit(1);
      }
      if (!wantKeep && !wantFix) {
        const peek = accept.preview({ project: projectVal });
        console.log('\n  Keep the last note?');
        console.log('    Yes:  npx analyzthis_design accept --keep' + (peek.persona ? ` --persona ${peek.persona}` : ''));
        console.log('    No:   npx analyzthis_design accept --fix --because "one sentence"');
        if (peek.persona) console.log(`  Last persona: ${peek.persona}`);
        else console.log('  Last persona: not sure — add --persona zara (or arjun, meera, …)');
        console.log('');
        break;
      }
      if (wantKeep) {
        const result = accept.keep({
          project: projectVal,
          persona: personaVal,
          comment: commentVal || becauseVal || '',
          shipped: !likedFlag,
          note: commentVal || '',
        });
        console.log(`\n✅ Kept ${result.persona}'s note.` + (result.shipped ? ' Marked as shipped for evolution.' : ' Saved as liked (not shipped).') + '\n');
        break;
      }
      const result = accept.fix({
        project: projectVal,
        persona: personaVal,
        because: becauseVal || commentVal || '',
        correction: correctionVal || '',
        rating: ratingVal,
        tags: parseFeedbackTags(tagsVal),
      });
      console.log(`\n✅ Logged your fix for ${result.persona}. The team can learn from it.\n`);
    } catch (err) {
      if (err.code === 'NEED_PERSONA') {
        console.error('\n  ✗  Which note? Add --persona zara (or arjun, meera, priya, noor, anuj, raj).\n');
        process.exit(1);
      }
      if (err.code === 'NEED_BECAUSE') {
        console.error('\n  ✗  Add one sentence: --because "what was wrong or what you did instead"\n');
        process.exit(1);
      }
      console.error(`\n  ✗  ${err.message}\n`);
      process.exit(1);
    }

    break;
  }

  case 'share': {
    const share = require('../lib/share');
    const acceptMod = require('../lib/accept');
    const wantSend = sendFlag || yesFlag;
    (async () => {
      try {
        if (!wantSend) {
          if (becauseVal || commentVal) {
            acceptMod.fix({
              project: projectVal,
              persona: personaVal,
              because: becauseVal || commentVal,
              correction: correctionVal || becauseVal || commentVal,
            });
          }
          const peek = share.preview({ project: projectVal, persona: personaVal, all: allFlag });
          if (!peek.count) {
            console.log('\n  Nothing to send yet. After a critique: /accept no plus one sentence, then /share.\n');
            return;
          }
          console.log(`\n  Ready to send ${peek.count} note(s) to the package (redacted — no folders, emails, or keys).`);
          peek.rows.slice(0, 5).forEach((r) => {
            console.log(`    • ${r.persona}: ${(r.comment || r.correction || '').slice(0, 100)}`);
          });
          if (peek.rows.length > 5) console.log(`    … and ${peek.rows.length - 5} more`);
          console.log(peek.hasHttp ? '  Path: configured HTTP endpoint.' : '  Path: GitHub issue on joshirishi/analyzthis_design.');
          console.log('  Send?  Run: npx analyzthis_design share --send\n');
          return;
        }
        const result = await share.send({
          project: projectVal,
          persona: personaVal,
          because: becauseVal || commentVal || '',
          correction: correctionVal || '',
          all: allFlag,
        });
        if (result.via === 'github-link') {
          console.log(`\n  ${result.message}`);
          console.log(`  ${result.url}\n`);
          return;
        }
        console.log(`\n✅ ${result.message}` + (result.url ? `\n   ${result.url}` : '') + '\n');
      } catch (err) {
        if (err.code === 'NOTHING') {
          console.error('\n  ✗  Nothing to send yet. /accept no plus one sentence, then /share.\n');
          process.exit(1);
        }
        if (err.code === 'NEED_PERSONA') {
          console.error('\n  ✗  Which note? Add --persona zara (or arjun, meera, priya, noor, anuj, raj).\n');
          process.exit(1);
        }
        if (err.code === 'NEED_BECAUSE') {
          console.error('\n  ✗  Add one sentence: --because "what was wrong or what you did instead"\n');
          process.exit(1);
        }
        console.error(`\n  ✗  ${err.message}\n`);
        process.exit(1);
      }
    })();
    break;
  }

  // ── Persona feedback (v1.16) ────────────────────────────────────────────

  case 'feedback': {
    const sub = flags[0] || 'record';
    if (sub === 'record') {
      if (!personaVal) {
        console.error('\n  ✗  --persona is required.\n');
        console.error('  Example: npx analyzthis_design feedback record --persona arjun --rating 2 \\\n');
        console.error('    --comment "Invented tokens" --correction "Use tokens.css primary + spacing-4"\n');
        process.exit(1);
      }
      const ratingNum = ratingVal != null ? Number(ratingVal) : undefined;
      const satisfied = ratingNum != null ? ratingNum >= 4 : false;
      try {
        const result = feedback.recordFeedback({
          project: projectVal,
          persona: personaVal,
          satisfied,
          rating: ratingNum,
          comment: commentVal || '',
          correction: correctionVal || '',
          tags: parseFeedbackTags(tagsVal),
          markRejected: !satisfied,
        });
        console.log(`\n📝 Feedback recorded for "${personaVal}" (${result.entry.id}).`);
        console.log(`   Global log: ${result.globalFile}\n`);
      } catch (err) {
        console.error(`\n  ✗  ${err.message}\n`);
        process.exit(1);
      }
      break;
    }
    if (sub === 'list') {
      const items = feedback.listFeedback({ project: projectVal, all: allFlag });
      if (!items.length) {
        console.log('\n  No feedback entries yet.\n');
        console.log('  Record one: npx analyzthis_design feedback record --persona arjun --rating 2 --comment "..."\n');
        break;
      }
      console.log(`\n── Feedback (${items.length}) ───────────────────────────────`);
      for (const e of items) {
        const mood = e.satisfied ? '✅' : '⚠️';
        const rating = e.rating != null ? ` rating=${e.rating}` : '';
        const tags = e.tags?.length ? ` [${e.tags.join(', ')}]` : '';
        const sent = e.submitted_at ? ' 📤' : '';
        console.log(`${mood} ${e.at}  ${e.persona}${rating}${tags}${sent}`);
        if (e.comment) console.log(`   comment: ${e.comment.slice(0, 120)}${e.comment.length > 120 ? '…' : ''}`);
        if (e.correction) console.log(`   correction: ${e.correction.slice(0, 120)}${e.correction.length > 120 ? '…' : ''}`);
      }
      console.log('');
      break;
    }
    if (sub === 'export') {
      try {
        const result = feedback.exportCorrections({
          persona: personaVal,
          project: projectVal,
          all: allFlag,
          output: outputVal,
          includePositive: includePositiveFlag,
        });
        console.log(`\n✅ Wrote ${result.pairs} correction pair(s) to ${result.filePath}`);
        if (!result.pairs) {
          console.log('   No entries with comment/correction found. Record feedback first.');
          console.log(`   Tags hint: ${feedback.ISSUE_TAG_HINTS.slice(0, 6).join(', ')}, …`);
        }
        console.log('');
      } catch (err) {
        console.error(`\n  ✗  ${err.message}\n`);
        process.exit(1);
      }
      break;
    }
    if (sub === 'submit') {
      (async () => {
        try {
          const result = await feedbackSubmit.submitFeedback({
            project: projectVal,
            all: allFlag,
            persona: personaVal,
            includePositive: includePositiveFlag,
            dryRun: dryRunFlag,
            yes: yesFlag,
            limit: limitVal,
          });
          if (result.cancelled) {
            console.log(`\n  ${result.message}\n`);
            process.exit(0);
          }
          if (result.dryRun && result.payloads) {
            console.log(`\n── Dry run: ${result.payloads.length} row(s) ─────────────────`);
            console.log(`   Endpoint: ${result.endpoint}`);
            console.log(JSON.stringify(result.payloads[0], null, 2));
            if (result.payloads.length > 1) {
              console.log(`   … and ${result.payloads.length - 1} more`);
            }
            console.log('');
            return;
          }
          console.log(`\n✅ ${result.message}`);
          if (result.endpoint) console.log(`   Endpoint: ${result.endpoint}`);
          console.log('');
        } catch (err) {
          console.error(`\n  ✗  ${err.message}\n`);
          process.exit(1);
        }
      })();
      break;
    }
    if (sub === 'status') {
      const st = feedbackSubmit.submitStatus();
      console.log('\n── Feedback submit status ───────────────────────────');
      console.log(`  Consent:     ${st.consent}`);
      console.log(`  Endpoint:    ${st.endpoint}`);
      console.log(`  Anon key:    ${st.anonKey}`);
      console.log(`  Unsent:      ${st.unsentCount} entr${st.unsentCount === 1 ? 'y' : 'ies'}`);
      console.log(`  Install id:  ${st.installId} (anonymous)`);
      console.log(`  Package:     ${st.packageVersion}`);
      console.log('');
      break;
    }
    if (sub === 'revoke') {
      feedbackSubmit.revokeConsent();
      console.log('\n🛑 Opt-in consent revoked. Run feedback submit again to re-consent.\n');
      break;
    }
    console.error(`\nUnknown feedback subcommand: "${sub}". Use: record | list | export | submit | status | revoke\n`);
    process.exit(1);
  }

  // ── LoRA readiness: training-pair export (Phase 5, hook only) ──────────

  case 'export-training': {
    if (!personaVal) {
      console.error('\n  ✗  --persona is required.  Example: npx analyzthis_design export-training --persona arjun\n');
      process.exit(1);
    }
    try {
      const result = exportTraining({ persona: personaVal, project: projectVal, all: allFlag, output: outputVal });
      console.log(`\n✅ Wrote ${result.pairs} accepted training pair(s) for "${personaVal}" to ${result.filePath}`);
      if (!result.pairs) {
        console.log(`   No accepted outputs found. Mark one first: npx analyzthis_design session accept --persona ${personaVal}`);
      }
      console.log('');
    } catch (err) {
      console.error(`\n  ✗  ${err.message}\n`);
      process.exit(1);
    }
    break;
  }

  case 'evolve': {
    const evolve = require('../lib/evolve');
    const windowArg = getFlag('window');
    const windowDays = windowArg ? parseInt(windowArg, 10) : 7;
    if (flags.includes('--extract')) {
      (async () => {
        try {
          const report = await evolve.runEvolution({ windowDays, dryRun: dryRunFlag });
          console.log('\n── Evolution report ' + (dryRunFlag ? '(dry run)' : '') + ' ──');
          console.log('  Lessons extracted:  ' + report.extracted_lessons);
          console.log('  Outcomes inferred:  ' + report.inferred_outcomes);
          console.log('  Prompt patches:     ' + report.prompt_patches.length);
          console.log('  Reference proposals:' + report.reference_proposals.length);
          console.log('  Router patches:     ' + report.router_patches.length);
          for (const p of report.prompt_patches) {
            console.log('\n  Patch: ' + p.id + ' — ' + p.persona + ' — ' + p.description);
          }
          for (const p of report.reference_proposals) {
            console.log('\n  Reference: ' + p.id + ' — ' + p.persona + ' — ' + p.description);
          }
          for (const p of report.router_patches) {
            console.log('\n  Router: ' + p.id + ' — ' + p.task_type + ' → ' + p.suggested_route_to.join(', '));
          }
          console.log('');
        } catch (err) {
          console.error(`\n  ✗  ${err.message}\n`);
          process.exit(1);
        }
      })();
      break;
    }
if (flags.includes('--apply')) {
      const applyId = getFlag('apply');
      if (!applyId) {
        console.error('\n  ��  --apply requires a patch id\n');
        process.exit(1);
      }
      try {
        const result = evolve.applyPatch({ patchId: applyId, dryRun: dryRunFlag });
        if (result.preview) {
          console.log('\n── Dry-run patch preview ──');
          console.log('  Target: ' + result.targetFile);
          console.log('  Preview:\n' + result.preview.slice(0, 1200));
        } else {
          console.log('\n��� Patch ' + (result.applied ? 'applied' : 'previewed') + ': ' + applyId);
          if (result.targetFile) console.log('   Target: ' + result.targetFile);
          if (result.message) console.log('   Note: ' + result.message);
        }
        console.log('');
      } catch (err) {
        console.error(`\n  ��  ${err.message}\n`);
        process.exit(1);
      }
      break;
    }
    if (flags.includes('--metrics')) {
      const em = require('../lib/evolution-metrics');
      const m = em.computeEvolutionMetrics(projectVal);
      console.log('\n' + em.formatEvolutionSummary(m));
      break;
    }
    if (flags.includes('--ready')) {
      const em = require('../lib/evolution-metrics');
      const ready = em.checkEvolutionReady(projectVal);
      console.log('\n' + (ready.ready ? '[READY] ' : '[PENDING] ') + ready.reason);
      console.log('');
      console.log(em.formatEvolutionSummary(ready.metrics));
      break;
    }
    console.log('\n  Usage: evolve --extract [--window N] [--dry-run] | evolve --apply <patchId> [--dry-run] | evolve --metrics | evolve --ready\n');
    break;
  }

  case 'outcome': {
    const outcome = require('../lib/outcome');
    if (flags.includes('--infer')) {
      const windowArg2 = getFlag('window');
      const wd = windowArg2 ? parseInt(windowArg2, 10) : 7;
      try {
        const result = outcome.inferAllOutcomes({ windowDays: wd });
        console.log('\n✅ Inferred ' + result.inferred + ' outcome(s), ' + result.confirmed + ' confirmed, ' + result.unknown + ' unknown.\n');
      } catch (err) {
        console.error(`\n  ✗  ${err.message}\n`);
        process.exit(1);
      }
      break;
    }
    if (flags.includes('--pending')) {
      const pending = outcome.listPendingConfirmations();
      if (!pending.length) {
        console.log('\n  No pending outcome confirmations.\n');
      } else {
        console.log('\n── Pending outcome confirmations (' + pending.length + ') ──');
        for (const p of pending) {
          console.log('  ' + p.project + ' / ' + p.persona + ': ' + p.inferred + ' (' + p.reason + ')');
        }
        console.log('');
      }
      break;
    }
    if (flags.includes('--confirm')) {
      if (!personaVal) {
        console.error('\n  ✗  --persona is required for --confirm\n');
        process.exit(1);
      }
      const resultVal = getFlag('result');
      if (!resultVal) {
        console.error('\n  ✗  --result is required (shipped | revised | blocked_correctly | missed)\n');
        process.exit(1);
      }
      try {
        outcome.confirmOutcome({ project: projectVal, persona: personaVal, outcome: resultVal });
        console.log('\n✅ Outcome confirmed: ' + personaVal + ' = ' + resultVal + '\n');
      } catch (err) {
        console.error(`\n  ✗  ${err.message}\n`);
        process.exit(1);
      }
      break;
    }
    console.log('\n  Usage: outcome --infer [--window N] | outcome --pending | outcome --confirm --persona X --result Y\n');
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
