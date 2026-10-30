#!/usr/bin/env node
'use strict';

/**
 * MCP (Model Context Protocol) server for Analyzthis Design.
 *
 * Exposes every persona, combination pass, and utility as an MCP tool
 * that any MCP-compatible client can discover and call — Cursor, Claude
 * Desktop, Lovable, v0, Bolt, Replit, ChatGPT, Windsurf, etc.
 *
 * Runs locally via stdio. No hosting, no API keys, no network calls.
 *
 * Protocol: JSON-RPC 2.0 over stdio (MCP spec)
 * Zero external dependencies.
 *
 * Usage:
 *   npx analyzthis_design mcp                    # start stdio server
 *   npx analyzthis_design mcp --configure cursor # write MCP config
 *   npx analyzthis_design mcp --configure claude  # write Claude Desktop config
 */

var fs = require('fs');
var path = require('path');
var os = require('os');
var readline = require('readline');

var { resolvePackageRoot } = require('./platforms');
var PACKAGE_ROOT = resolvePackageRoot(__dirname);
var VERSION = '2.2.1';
try { VERSION = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8')).version; } catch (e) {}

// ── Tool definitions ─────────────────────────────────────────────────────

var TOOLS = [
  // ── Individual personas ──
  {
    name: 'analyzthis_arjun',
    description: 'Arjun — UX + Visual Design audit. Runs the UX Honeycomb (Useful, Usable, Findable, Credible, Accessible, Desirable, Valuable) AND a full Visual Design Audit (hierarchy, color, typography, spacing, components, style fit, micro-interactions). Use for any visual or UX critique.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'What to critique (e.g., "Review the login page contrast and hierarchy")' },
        context: { type: 'string', description: 'Additional context: design system tokens, product type, user role, screenshot description' },
      },
      required: ['task'],
    },
  },
  {
    name: 'analyzthis_meera',
    description: 'Meera — Business / Retention / GTM lens. Evaluates whether a design moves the north-star metric, assesses adoption risk, and checks competitive parity vs differentiation. Use for business-impact critiques.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'What to evaluate (e.g., "Does this onboarding flow improve activation rate?")' },
        context: { type: 'string', description: 'Business context: north-star metric, target segment, competitive landscape' },
      },
      required: ['task'],
    },
  },
  {
    name: 'analyzthis_priya',
    description: 'Priya — Feasibility / Engineering effort. Sizes technical complexity (S/M/L/XL), identifies hard blockers, flags implementation risks, and suggests simpler 80% alternatives. Stack-specific guidance for 16 frameworks. Use for effort estimation.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'What to assess (e.g., "How much effort to build this settings page in Next.js?")' },
        stack: { type: 'string', description: 'Tech stack (e.g., "nextjs", "react", "vue", "flutter", "swiftui")' },
        context: { type: 'string', description: 'Technical context: existing components, API constraints, team size' },
      },
      required: ['task'],
    },
  },
  {
    name: 'analyzthis_zara',
    description: 'Zara — Delight moments, and scout for UI image boards. Identifies exactly ONE structural or surface delight moment. On a UI board she browses real shipped screens, picks 3-5 frames, and re-scouts if the jury skips. Use after the core critique, or when the user wants a UI image board.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'What to find delight in (e.g., "Find a delight moment in the empty state")' },
        surface_type: { type: 'string', description: 'Surface type: onboarding, empty_state, error_state, success_state, peak_moment, first_impression' },
        high_frequency: { type: 'boolean', description: 'If true, Zara may say "speed is the craft" instead of adding delight' },
      },
      required: ['task'],
    },
  },
  {
    name: 'analyzthis_noor',
    description: 'Noor — Minimalist IA. Designs task-first information architecture with progressive disclosure, single primary actions, and ≤3 navigation levels. Produces Concept A (minimalist wireframe). Use for IA design and wireframe generation.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'What to design (e.g., "Design a settings page for B2B SaaS")' },
        context: { type: 'string', description: 'Product context: user role, frequency, entity volume, existing nav structure' },
      },
      required: ['task'],
    },
  },
  {
    name: 'analyzthis_anuj',
    description: 'Anuj — Power-user IA. Designs dense, expert-optimized information architecture with bulk operations, keyboard shortcuts, and full data density. Produces Concept B (power-user wireframe). Use for expert-user interface design.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'What to design (e.g., "Design a power-user settings page with bulk actions")' },
        context: { type: 'string', description: 'Power-user context: daily frequency, entity volume, keyboard-first, bulk operations needed' },
      },
      required: ['task'],
    },
  },
  {
    name: 'analyzthis_raj',
    description: 'Raj — Product strategy and stalemate arbitrator. Resolves disagreements between personas using 5 ranked product principles. Also challenges the task premise — "are we solving the right problem?" Use when personas disagree or to validate the framing.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'What to arbitrate or validate (e.g., "Noor and Anuj disagree on navigation depth")' },
        contested_dimensions: { type: 'array', items: { type: 'string' }, description: 'Dimensions being contested' },
        context: { type: 'string', description: 'PRD evidence, user data, or prior persona outputs' },
      },
      required: ['task'],
    },
  },
  {
    name: 'analyzthis_kavi',
    description: 'Kavi — Knowledge archivist. Scans the codebase, discovers Obsidian vaults, fetches web references, builds a vault, enriches notes, and syncs the knowledge bank. Use to index a project for personas.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['collect', 'sync', 'status', 'connect', 'disconnect'], description: 'Action to perform' },
        vault_path: { type: 'string', description: 'Path to Obsidian vault (for connect/disconnect)' },
        tags: { type: 'string', description: 'Comma-separated tags to filter by (for connect)' },
        include: { type: 'string', description: 'Comma-separated sub-folders to include (for connect)' },
      },
      required: ['action'],
    },
  },

  // ── Combination passes ──
  {
    name: 'analyzthis_ux_ideator',
    description: 'UX Ideator — 6-phase ideation workflow. Meera (business reframe) → Noor + Anuj (IA audit + two competing wireframes) → Deliberation (Noor vs Anuj, Raj on standby) → Arjun (UX validation) → Zara (delight) → Priya (feasibility). Output: one deliberated, implementation-ready concept. Use for "design a new screen" or "wireframe a feature".',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'What to design (e.g., "Design a notifications settings page for our B2B SaaS")' },
        product_name: { type: 'string', description: 'Product name' },
        primary_user: { type: 'string', description: 'Primary user role and session frequency' },
        north_star: { type: 'string', description: 'North-star metric' },
        tech_stack: { type: 'string', description: 'Tech stack + design system' },
        high_frequency: { type: 'boolean', description: 'Is this a high-frequency working surface?' },
        out_of_scope: { type: 'string', description: 'What is out of scope' },
      },
      required: ['task'],
    },
  },
  {
    name: 'analyzthis_persona_orchestrator',
    description: 'Persona Orchestrator — Full MoE critique. Routes to the right personas based on the task, runs adversarial deliberation, and produces a composite score + SHIP/REVISE/BLOCK verdict + top 3 fixes. Use for "review this screen" or "critique this design".',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'What to critique (e.g., "Review this onboarding flow for UX friction and hierarchy")' },
        figma_url: { type: 'string', description: 'Figma URL (optional)' },
        full: { type: 'boolean', description: 'Run full 4-persona chain (default: lite MoE subset)' },
        context: { type: 'string', description: 'Additional context: design system, product type, known issues' },
      },
      required: ['task'],
    },
  },
  {
    name: 'analyzthis_design_critic',
    description: 'Design Critic — 4-persona scored review. Arjun (UX + Visual) + Meera (Business) + Priya (Feasibility) + Zara (Delight) each score the design, deliberate, and produce a composite score with hierarchy gate. Use for structured, scored critiques.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'What to critique' },
        full: { type: 'boolean', description: 'Run all 4 personas in full mode (default: lite)' },
        context: { type: 'string', description: 'Design context: tokens, components, product type' },
      },
      required: ['task'],
    },
  },
  {
    name: 'analyzthis_ux_story_gate',
    description: 'UX Story Gate — Task-first screen review. Discovers PRDs and user stories from the knowledge bank, runs a design-system/Figma discovery pass, routes to the right personas, and ends with a browser verify gate. Use when you want a task-grounded review tied to user stories.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'What to review' },
        figma_url: { type: 'string', description: 'Figma URL (optional)' },
        context: { type: 'string', description: 'PRDs, user stories, design system info' },
      },
      required: ['task'],
    },
  },
  {
    name: 'analyzthis_design_director',
    description: 'Design Director — Full producer path. Ideation → DesignSpec (tokens + components + states) → spec gates (DS + hierarchy + visual) → implement when approved. Use for end-to-end design + spec + build.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'What to design (e.g., "Design a notifications settings page with our shadcn components")' },
        build_approved: { type: 'boolean', description: 'If true, implementation begins after spec gates pass' },
        context: { type: 'string', description: 'Design system tokens, component library, tech stack' },
      },
      required: ['task'],
    },
  },
  {
    name: 'analyzthis_mood_board',
    description: 'Visual mood board. Zara crops 20-24 real UI elements (cards, tables, type, colour, nav) from 6+ live sites into a sectioned collage with real colours and fonts. Arjun/Noor/Priya/Meera vote as advice. The board opens in the browser and the USER clicks keep / maybe / reject — the user\'s choice overrides every persona, and the locked direction is saved for all personas. kind=mood keeps the older link-and-tag board.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Visual direction brief (e.g., "B2B fintech dashboard, trustworthy, high-contrast, data-dense")' },
        kind: { type: 'string', enum: ['ui', 'mood'], description: 'ui = visual element board (default). mood = older tagged-URL board.' },
        action: { type: 'string', enum: ['create', 'brief', 'capture_script', 'tiles', 'jury', 'votes', 'show', 'decide', 'rescout', 'lock', 'status', 'frames', 'verdict'], description: 'create (default) → brief → tiles (Zara crops) → jury → votes (advice) → show (user decides in browser) → rescout or lock. decide records a user choice from chat. frames/verdict are older names for tiles/votes.' },
        board: { type: 'string', description: 'Board id' },
        adjectives: { type: 'array', items: { type: 'string' }, description: 'Three feel words for the brief' },
        not_this: { type: 'string', description: 'One thing this board must not look like' },
        sections: { type: 'array', items: { type: 'string', enum: ['first_screen', 'typography', 'color', 'components', 'imagery', 'motion'] }, description: 'Sections this board needs' },
        confirmed_by_user: { type: 'boolean', description: 'User approved the brief (action=brief)' },
        selector: { type: 'string', description: 'CSS selector for action=capture_script' },
        text: { type: 'string', description: 'Visible text that narrows the selector match (action=capture_script)' },
        tiles: {
          type: 'array',
          description: 'Element crops (action=tiles)',
          items: {
            type: 'object',
            properties: {
              page_url: { type: 'string', description: 'Exact page the element came from (required)' },
              image_path: { type: 'string', description: 'Local image file, or the saved Page.captureScreenshot JSON file' },
              image_base64: { type: 'string', description: 'Inline Page.captureScreenshot data when no file was written' },
              image_url: { type: 'string', description: 'Remote image URL if no local crop' },
              section: { type: 'string', enum: ['first_screen', 'typography', 'color', 'components', 'imagery', 'motion'] },
              element: { type: 'string', description: 'What the element is, e.g. "pricing card"' },
              tokens: { type: 'object', description: 'From capture_script: colors, fonts, radius, spacing, font_size' },
              steal: { type: 'string' }, refuse: { type: 'string' }, peak: { type: 'string' },
              concept: { type: 'boolean', description: 'True if this is a concept shot, not shipped product' },
            },
          },
        },
        votes: {
          type: 'array',
          description: 'Persona advice (action=votes): [{tile, persona, vote: keep|skip, because}]',
          items: { type: 'object' },
        },
        verdict: { type: 'string', enum: ['SHIP', 'REVISE', 'BLOCK'], description: 'Team advice verdict (action=votes)' },
        summary: { type: 'string', description: 'Team because-lines (action=votes)' },
        tile: { type: 'string', description: 'Tile number or id (action=decide)' },
        decision: { type: 'string', enum: ['keep', 'maybe', 'reject', 'clear'], description: 'User decision (action=decide)' },
        note: { type: 'string', description: 'User note (decide, rescout, lock)' },
        urls: { type: 'array', items: { type: 'string' }, description: 'Reference URLs (kind=mood)' },
        auto: { type: 'boolean', description: 'Auto-collect references (kind=mood only)' },
      },
    },
  },
  {
    name: 'analyzthis_evolve_check',
    description: 'Evolve Check — Team evolution dashboard. Shows per-persona evolution scores (0-100, Novice → Expert), checks if enough data exists to propose patches, and summarizes pending patches. Use after critique runs to track team growth.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['metrics', 'ready', 'extract', 'apply'], description: 'metrics: show dashboard; ready: check if evolution is ready; extract: propose patches; apply: apply a patch' },
        patch_id: { type: 'string', description: 'Patch ID (for apply action)' },
      },
      required: ['action'],
    },
  },

  // ── Utility tools ──
  {
    name: 'analyzthis_collect',
    description: 'Kavi collect — Scan the codebase, discover knowledge sources (Obsidian vaults, wikis), fetch web URLs, enrich notes with LLM, and sync everything into the knowledge bank. Run once per project before using personas.',
    inputSchema: {
      type: 'object',
      properties: {
        vault_path: { type: 'string', description: 'Path to an existing Obsidian vault to connect' },
        no_web: { type: 'boolean', description: 'Skip web URL fetching' },
        no_enrich: { type: 'boolean', description: 'Skip LLM enrichment' },
        dry_run: { type: 'boolean', description: 'Preview what would be collected' },
      },
    },
  },
  {
    name: 'analyzthis_retrieve',
    description: 'Retrieve on demand: CSV rows, a skill reference file, or one knowledge-bank persona slice. Do not load the full bank.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['csv', 'skill', 'knowledge'], description: 'csv (default), skill (references/*.md), or knowledge (one persona slice)' },
        file: { type: 'string', description: 'CSV filename, or skill id (e.g. arjun), or knowledge/<persona>' },
        column: { type: 'string', description: 'CSV column to filter on' },
        keywords: { type: 'string', description: 'Comma-separated CSV keywords' },
        limit: { type: 'number', description: 'Max CSV rows (default: 3)' },
        persona: { type: 'string', description: 'Persona id for knowledge slice (arjun, zara, …)' },
        ref: { type: 'string', description: 'Skill reference filename without path (e.g. lens.md)' },
      },
    },
  },
  {
    name: 'analyzthis_session',
    description: 'Read or write shared session state. The session holds persona outputs, routing decisions, synthesis results, metrics, and evolution data. Use to check what a previous run produced.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['show', 'init', 'reset', 'accept'], description: 'show: display current state; init: create fresh; reset: delete; accept: keep or skip a persona note (designer /accept)' },
        persona: { type: 'string', description: 'Persona ID (for accept action). Optional — last persona if omitted.' },
        reject: { type: 'boolean', description: 'Skip / fix instead of keep (for accept action)' },
        because: { type: 'string', description: 'One sentence: what was wrong or what you did instead (when reject is true)' },
        comment: { type: 'string', description: 'Optional note on keep, or alias for because on skip' },
        shipped: { type: 'boolean', description: 'On keep: mark shipped (default true). False = liked only.' },
      },
      required: ['action'],
    },
  },
  {
    name: 'analyzthis_system_prompt',
    description: 'Generate a consolidated system prompt for AI tools that do not support MCP. Produces a single text block containing all 8 personas, deliberation rules, premise-challenge logic, and output formats. Paste into Lovable, v0, Bolt, ChatGPT, or any tool\'s system instructions.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['create', 'critique', 'both'], description: 'Which mode to include (default: both)' },
      },
    },
  },
];

// The one line every persona closes with. Deliberately host-neutral: the
// designer answers in plain language and the agent picks the transport
// (Bash on Claude Code/Cursor, analyzthis_accept on Desktop).
var ASK_LINE = '\u2014\nWas this right? Say yes, or no plus one sentence. I\'ll record it.';

var ACCEPT_TOOL = {
  name: 'analyzthis_accept',
  description: 'Record the designer\'s reaction to a persona note. Call this whenever they approve, '
    + 'push back on, or correct a persona (\"that\'s right\", \"no, the hierarchy is backwards\"). '
    + 'This is how personas earn or lose trust — without it they never improve. '
    + 'persona is optional: the last one that spoke is inferred.',
  inputSchema: {
    type: 'object',
    properties: {
      keep: { type: 'boolean', description: 'true = the note was right; false = it was wrong or needed rework' },
      persona: { type: 'string', description: 'Optional. zara, arjun, meera, priya, noor, anuj, raj, kavi. Inferred if omitted.' },
      because: { type: 'string', description: 'Required when keep is false: one sentence on what was wrong or what they did instead' },
      comment: { type: 'string', description: 'Optional note when keep is true' },
    },
    required: ['keep'],
  },
};

var ROUTER_TOOL = {
  name: 'analyzthis_design',
  description: 'Design team router. Set who to zara, arjun, noor, anuj, meera, priya, raj, kavi, orchestrator, ux-ideator, design-critic, ux-story-gate, design-director, or mood-board. Returns a short skill front — call analyzthis_retrieve for the rest.',
  inputSchema: {
    type: 'object',
    properties: {
      who: { type: 'string', description: 'Persona or pass name (e.g. zara, arjun, orchestrator)' },
      task: { type: 'string', description: 'What to design or critique' },
      context: { type: 'string', description: 'Optional extra context' },
    },
    required: ['who', 'task'],
  },
};

var RECEIPT_TOOL = {
  name: 'analyzthis_receipt',
  description: 'Show inferred token receipt for this project, and optionally how much each persona is worth listening to. Not a bill. Do not invent a dollar figure.',
  inputSchema: {
    type: 'object',
    properties: {
      project: { type: 'string', description: 'Optional project id' },
      scores: { type: 'boolean', description: 'Include the persona trust scoreboard' },
    },
  },
  inputSchema: {
    type: 'object',
    properties: {
      project: { type: 'string', description: 'Optional project id override' },
    },
  },
};

function resolveCatalog(explicit) {
  var raw = explicit || process.env.ANALYZTHIS_MCP_CATALOG || 'lite';
  return String(raw).toLowerCase() === 'full' ? 'full' : 'lite';
}

function listedTools(catalog) {
  if (resolveCatalog(catalog) === 'full') {
    return TOOLS.concat([ROUTER_TOOL, ACCEPT_TOOL, RECEIPT_TOOL]);
  }
  return [ROUTER_TOOL, ACCEPT_TOOL, TOOLS.find(function (t) { return t.name === 'analyzthis_retrieve'; }), TOOLS.find(function (t) { return t.name === 'analyzthis_session'; }), RECEIPT_TOOL].filter(Boolean);
}

// ── Tool handlers ────────────────────────────────────────────────────────

function handleToolCall(name, args) {
  switch (name) {

    // ── Individual personas ──
    case 'analyzthis_arjun':
    case 'analyzthis_meera':
    case 'analyzthis_priya':
    case 'analyzthis_zara':
    case 'analyzthis_noor':
    case 'analyzthis_anuj':
    case 'analyzthis_raj':
    case 'analyzthis_kavi':
      return handleSinglePersona(name.replace('analyzthis_', ''), args);

    // ── Combination passes ──
    case 'analyzthis_ux_ideator':
      return handleCombinationPass('ux-ideator', args);
    case 'analyzthis_persona_orchestrator':
      return handleCombinationPass('persona-orchestrator', args);
    case 'analyzthis_design_critic':
      return handleCombinationPass('design-critic', args);
    case 'analyzthis_ux_story_gate':
      return handleCombinationPass('ux-story-gate', args);
    case 'analyzthis_design_director':
      return handleCombinationPass('design-director', args);
    case 'analyzthis_mood_board':
      return handleMoodBoard(args);
    case 'analyzthis_evolve_check':
      return handleEvolveCheck(args);

    // ── Utility ──
    case 'analyzthis_collect':
      return handleCollect(args);
    case 'analyzthis_retrieve':
      return handleRetrieve(args);
    case 'analyzthis_session':
      return handleSession(args);
    case 'analyzthis_system_prompt':
      return handleSystemPrompt(args);
    case 'analyzthis_design':
      return handleRouter(args);
    case 'analyzthis_receipt':
      return handleReceipt(args);
    case 'analyzthis_accept':
      return handleAccept(args);

    default:
      return { error: 'Unknown tool: ' + name };
  }
}

function handleSinglePersona(personaId, args) {
  var card = readSkillFront(personaId);
  if (!card) return { error: 'Persona not found: ' + personaId };

  var task = args.task || '';
  var context = args.context || '';
  var extra = '';

  // Persona-specific context
  if (personaId === 'priya' && args.stack) extra = '\nStack: ' + args.stack;
  if (personaId === 'zara' && args.surface_type) extra = '\nSurface type: ' + args.surface_type;
  if (personaId === 'zara' && args.high_frequency) extra += '\nHigh-frequency surface: yes';
  if (personaId === 'raj' && args.contested_dimensions) extra = '\nContested dimensions: ' + args.contested_dimensions.join(', ');

  var prompt = 'You are activated as the ' + personaId + ' persona.\n\n' +
    card + '\n\n' +
    '## Task\n' + task + '\n' +
    (context ? '\n## Context\n' + context : '') +
    extra + '\n\n' +
    'Use the lite output contract. Call analyzthis_retrieve (kind=skill, file=' + personaId + ') only if you need the full lens. ' +
    'Be specific — cite components, zones, and fixes. Do not give generic advice.\n\n' +
    'End your reply with this line, exactly:\n' + ASK_LINE;

  return { prompt: prompt, persona: personaId, task: task, verdicts: 1 };
}

function handleCombinationPass(skillId, args) {
  var skill = readSkill(skillId);
  if (!skill) return { error: 'Skill not found: ' + skillId };

  var task = args.task || '';
  var context = '';

  // Build context from args
  var contextParts = [];
  for (var key in args) {
    if (key === 'task') continue;
    if (args[key] !== undefined && args[key] !== null && args[key] !== '') {
      var label = key.replace(/_/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
      contextParts.push(label + ': ' + (typeof args[key] === 'boolean' ? (args[key] ? 'yes' : 'no') : args[key]));
    }
  }
  if (contextParts.length) context = contextParts.join('\n');

  var prompt = 'Follow the workflow defined in this skill.\n\n' +
    '# Skill: ' + skillId + '\n\n' +
    skill + '\n\n' +
    '## Task\n' + task + '\n' +
    (context ? '\n## Context\n' + context : '') + '\n\n' +
    'Run the smallest useful team. Challenge the premise first. ' +
    'Call analyzthis_retrieve (kind=skill, file=' + skillId + ') if the front is not enough. ' +
    'Lite default: verdict + top 3 + one evidence line. Expand only if the user says expand.';

  return { prompt: prompt, skill: skillId, task: task, persona: skillId, verdicts: 1 };
}

// One live board server per board id, kept for the life of the MCP process.
var moodBoardServers = {};

function tileCountLine(board) {
  var sites = {};
  board.tiles.forEach(function(t) { if (t.site) sites[t.site] = true; });
  return board.tiles.length + ' tile(s) from ' + Object.keys(sites).length + ' site(s)';
}

function handleMoodBoard(args) {
  var task = args.task || '';
  var kind = args.kind === 'mood' ? 'mood' : 'ui';
  var action = args.action || 'create';
  var mb = require('./moodboard');
  var view = require('./moodboard-view');
  var ref = { boardId: args.board };
  var zaraNext = function(board) {
    return 'You are Zara on a Scout Pass. Open real pages in the browser. Do not invent URLs.\n\n' + board.scout.brief +
      '\n\nBoard id: ' + board.board_id +
      '\nToken script for Runtime.evaluate: call analyzthis_mood_board action=capture_script selector=<css>.' +
      '\nSave tiles with action=tiles, board=' + board.board_id + ', tiles=[{page_url,image_path,section,element,tokens,steal,refuse,peak}].' +
      '\nThen action=jury for advice, then action=show and open the URL so the user decides.';
  };

  try {
    if (action === 'capture_script') {
      return { result: mb.captureScript(args.selector || 'body', args.text || '') };
    }

    if (action === 'brief') {
      var briefed = mb.setBrief({
        boardId: args.board, adjectives: args.adjectives, not_this: args.not_this,
        sections: args.sections, confirmed_by_user: args.confirmed_by_user,
      });
      return { result: 'Brief saved.', board_id: briefed.board.board_id, brief: briefed.board.brief };
    }

    if (action === 'tiles' || action === 'frames') {
      var tiles = args.tiles || args.frames || [{
        page_url: args.page_url || args.url, element: args.element || args.title, section: args.section,
        image_path: args.image_path, image_url: args.image_url, tokens: args.tokens,
        steal: args.steal, refuse: args.refuse, peak: args.peak,
      }];
      var added = mb.addTiles({ boardId: args.board, tiles: tiles });
      return {
        result: 'Saved ' + added.added.length + ' tile(s). Board now has ' + tileCountLine(added.board) +
          '. Target ' + mb.TILE_TARGET.min + '-' + mb.TILE_TARGET.max + ' from ' + mb.TILE_TARGET.sites + '+ sites.' +
          (added.skipped.length ? ' Skipped: ' + JSON.stringify(added.skipped) : ''),
        board_id: added.board.board_id,
        skipped: added.skipped,
      };
    }

    if (action === 'jury') {
      var juryBoard = mb.loadUiBoard(ref);
      if (!juryBoard.tiles.length) return { error: 'NEED_SCOUT: Zara has not added tiles yet.' };
      return { prompt: mb.juryPrompt(juryBoard, ''), board_id: juryBoard.board_id };
    }

    if (action === 'votes' || action === 'verdict') {
      var voted = mb.recordPersonaVotes({
        boardId: args.board, votes: args.votes || [], verdict: args.verdict, summary: args.summary,
      });
      return {
        result: 'Team advice saved' + (voted.ignored.length ? ' (ignored: ' + JSON.stringify(voted.ignored) + ')' : '') +
          '. The user decides next: call action=show and open the URL in the browser.',
        board_id: voted.board.board_id,
        scout: voted.board.scout,
      };
    }

    if (action === 'show') {
      var existing = moodBoardServers[args.board];
      if (existing) return { result: 'Board is live at ' + existing.url + ' — open it with browser_navigate.', url: existing.url };
      return view.serveBoard({ boardId: args.board }).then(function(live) {
        moodBoardServers[args.board] = live;
        return {
          result: 'Board is live at ' + live.url + ' — open it with browser_navigate. The user clicks keep / maybe / reject; their choice overrides every persona.',
          url: live.url,
        };
      }).catch(function(e) { return { error: e.message }; });
    }

    if (action === 'decide') {
      var decided = mb.recordUserDecision({ boardId: args.board, tile: args.tile, decision: args.decision, note: args.note });
      return { result: 'User decision saved on tile ' + args.tile + '. It outranks every persona vote.', board_id: decided.board.board_id };
    }

    if (action === 'rescout') {
      var again = mb.requestRescout({ boardId: args.board, note: args.note });
      return { prompt: zaraNext(again.board), board_id: again.board.board_id, scout: again.board.scout };
    }

    if (action === 'lock') {
      var locked = mb.lockDirection({ boardId: args.board, note: args.note });
      return { result: 'Direction locked by the user and saved to the session as design_direction. Every persona must follow it.', direction: locked.board.direction };
    }

    if (action === 'status') {
      var b = mb.loadUiBoard(ref);
      return { result: JSON.stringify({ board_id: b.board_id, scout: b.scout, brief: b.brief, tiles: tileCountLine(b), direction: mb.computeDirection(b) }, null, 2) };
    }
  } catch (e) {
    return { error: e.message };
  }

  if (kind === 'ui') {
    if (!task) return { error: 'task is required to open a mood board' };
    return mb.buildMoodBoard({
      task: task, kind: 'ui', discover: false,
      brief: { adjectives: args.adjectives, not_this: args.not_this, sections: args.sections },
    }).then(function(created) {
      return {
        prompt: 'First show the user this brief (job, 3 adjectives, one "not this", sections) and let them correct it with action=brief confirmed_by_user=true.\n\n' + zaraNext(created.board),
        board_id: created.board.board_id,
        brief: created.board.brief,
      };
    }).catch(function(e) { return { error: e.message }; });
  }

  return handleLinkMoodBoard(args);
}

function handleLinkMoodBoard(args) {
  var skill = readSkill('mood-board');
  var task = args.task || '';
  var urls = (args.urls || []).join('\n');
  var prompt = 'Build a mood board.\n\n' +
    (skill ? skill.slice(0, 3000) : '') + '\n\n' +
    '## Task\n' + task + '\n' +
    (urls ? '\n## Reference URLs\n' + urls : '') + '\n\n' +
    'Collect references, tag them, and run team deliberation using the UX Honeycomb matrix.';

  return { prompt: prompt, task: task };
}

function handleEvolveCheck(args) {
  var action = args.action || 'metrics';
  try {
    if (action === 'metrics' || action === 'ready') {
      var em = require('./evolution-metrics');
      var sessionMod = require('./session');
      var projectId = sessionMod.getProjectId();
      if (action === 'metrics') {
        var m = em.computeEvolutionMetrics(projectId);
        return { result: em.formatEvolutionSummary(m), action: 'metrics' };
      } else {
        var ready = em.checkEvolutionReady(projectId);
        return { result: em.formatEvolutionSummary(ready.metrics), ready: ready.ready, reason: ready.reason };
      }
    }
    if (action === 'extract') {
      var evolve = require('./evolve');
      return { result: 'Run: npx analyzthis_design evolve --extract --dry-run to propose patches', action: 'extract' };
    }
    if (action === 'apply') {
      return { result: 'Run: npx analyzthis_design evolve --apply ' + (args.patch_id || '<patchId>'), action: 'apply' };
    }
  } catch (e) {
    return { error: e.message };
  }
  return { error: 'Unknown evolve action: ' + action };
}

function handleCollect(args) {
  var parts = ['npx analyzthis_design collect'];
  if (args.vault_path) parts.push('--vault "' + args.vault_path + '"');
  if (args.no_web) parts.push('--no-web');
  if (args.no_enrich) parts.push('--no-enrich');
  if (args.dry_run) parts.push('--dry-run');
  return { command: parts.join(' '), note: 'Run this in your project directory to scan the codebase and build the knowledge bank.' };
}

function handleRetrieve(args) {
  var kind = args.kind || 'csv';
  if (kind === 'skill') return handleRetrieveSkill(args);
  if (kind === 'knowledge') return handleRetrieveKnowledge(args);
  try {
    var retrieve = require('./retrieve');
    var file = args.file;
    if (!file) return { error: 'file is required for CSV retrieve' };
    var filters = [];
    if (args.column && args.keywords) {
      filters.push({ column: args.column, anyOf: args.keywords.split(',').map(function(s) { return s.trim(); }) });
    }
    var limit = args.limit || 3;
    var result = retrieve.retrieve({ file: file, filters: filters, limit: limit });
    if (!result.rows.length) return { result: 'No rows matched in ' + file };
    var lines = [result.rows.length + ' matching row(s) in ' + file + (result.cacheHit ? ' (cache hit)' : '') + ':'];
    for (var i = 0; i < result.rows.length; i++) {
      lines.push('Row ' + result.rows[i].__no + ':');
      for (var k in result.rows[i]) {
        if (k.startsWith('__') || !result.rows[i][k]) continue;
        lines.push('  ' + k + ': ' + result.rows[i][k]);
      }
    }
    return { result: lines.join('\n') };
  } catch (e) {
    return { error: e.message };
  }
}

function handleRetrieveSkill(args) {
  var id = String(args.file || args.persona || '').replace(/^skill\//, '');
  if (!id) return { error: 'file (skill id) is required' };
  var refName = args.ref || 'lens.md';
  var refPath = path.join(PACKAGE_ROOT, 'skills', id, 'references', refName);
  if (!fs.existsSync(refPath)) {
    var dir = path.join(PACKAGE_ROOT, 'skills', id, 'references');
    if (fs.existsSync(dir)) {
      var names = fs.readdirSync(dir).filter(function (n) { return n.endsWith('.md'); });
      if (names.length) refPath = path.join(dir, names[0]);
    }
  }
  if (!fs.existsSync(refPath)) {
    var full = readSkill(id);
    if (!full) return { error: 'No skill references for ' + id };
    return { result: full, persona: id };
  }
  return { result: fs.readFileSync(refPath, 'utf8'), persona: id };
}

function handleRetrieveKnowledge(args) {
  var persona = args.persona || String(args.file || '').replace(/^knowledge\//, '');
  if (!persona) return { error: 'persona is required for knowledge retrieve' };
  try {
    var knowledge = require('./knowledge');
    var sessionMod = require('./session');
    var projectId = sessionMod.getProjectId();
    var slicePath = path.join(knowledge.KNOWLEDGE_SLICE_ROOT, projectId, persona + '.md');
    if (!fs.existsSync(slicePath)) {
      return { result: 'No knowledge slice for ' + persona + '. Run collect/sync first. Do not load a full bank.' };
    }
    var text = fs.readFileSync(slicePath, 'utf8');
    var cap = 6000;
    if (text.length > cap) text = text.slice(0, cap) + '\n…[truncated — this is one slice, not the full bank]';
    return { result: text, persona: persona };
  } catch (e) {
    return { error: e.message };
  }
}

var ROUTER_WHO = {
  zara: 'persona', arjun: 'persona', meera: 'persona', priya: 'persona',
  noor: 'persona', anuj: 'persona', raj: 'persona', kavi: 'persona',
  orchestrator: 'persona-orchestrator', 'persona-orchestrator': 'persona-orchestrator',
  'ux-ideator': 'ux-ideator', 'design-critic': 'design-critic',
  'ux-story-gate': 'ux-story-gate', 'design-director': 'design-director',
  'mood-board': 'mood-board',
};

function handleRouter(args) {
  var who = String(args.who || '').toLowerCase().replace(/^analyzthis_/, '').replace(/_/g, '-');
  if (!who) return { error: 'who is required (e.g. zara, arjun, orchestrator)' };
  var mapped = ROUTER_WHO[who];
  if (!mapped) return { error: 'Unknown who: ' + who + '. Use a persona or orchestrator / ux-ideator / design-critic / ux-story-gate / design-director / mood-board.' };
  if (mapped === 'persona') return handleSinglePersona(who, args);
  if (mapped === 'mood-board') return handleMoodBoard(args);
  return handleCombinationPass(mapped, args);
}

function handleAccept(args) {
  try {
    var accept = require('./accept');
    if (args.keep === false) {
      return { result: JSON.stringify(accept.fix({
        project: args.project,
        persona: args.persona,
        because: args.because || args.comment || '',
      })) };
    }
    return { result: JSON.stringify(accept.keep({
      project: args.project,
      persona: args.persona,
      comment: args.comment || '',
      shipped: args.shipped !== false,
    })) };
  } catch (e) {
    if (e.code === 'NEED_PERSONA') {
      return { result: 'Which persona was that — Zara, Arjun, Meera, Priya, Noor, Anuj, or Raj? Ask the designer, then call again.' };
    }
    if (e.code === 'NEED_BECAUSE') {
      return { result: 'Ask the designer one sentence on what was wrong, then call again with because.' };
    }
    return { error: e.message };
  }
}

function handleReceipt(args) {
  var receipt = require('./receipt');
  var out = receipt.report({ project: args.project });
  if (args.scores) {
    try {
      var em = require('./evolution-metrics');
      out += '\n\n' + em.formatEvolutionSummary(em.computeEvolutionMetrics());
    } catch (e) { /* receipt must never fail for a scoreboard */ }
  }
  return { result: out };
}

function handleSession(args) {
  try {
    var session = require('./session');
    var action = args.action;
    if (action === 'show') {
      var state = session.show();
      if (!state) return { result: 'No session exists. Run npx analyzthis_design session init.' };
      return { result: JSON.stringify(state, null, 2).slice(0, 4000) };
    }
    if (action === 'init') {
      session.init();
      return { result: 'Session initialized.' };
    }
    if (action === 'reset') {
      session.reset();
      return { result: 'Session reset.' };
    }
    if (action === 'accept') {
      var accept = require('./accept');
      if (args.reject) {
        return { result: JSON.stringify(accept.fix({
          persona: args.persona,
          because: args.because || args.comment || '',
        })) };
      }
      return { result: JSON.stringify(accept.keep({
        persona: args.persona,
        comment: args.comment || '',
        shipped: args.shipped !== false,
      })) };
    }
  } catch (e) {
    return { error: e.message };
  }
  return { error: 'Unknown session action: ' + args.action };
}

function handleSystemPrompt(args) {
  try {
    var builder = require('./system-prompt');
    var mode = args.mode || 'both';
    var prompt = builder.buildPrompt({ mode: mode });
    return { result: prompt };
  } catch (e) {
    // Fallback: generate inline
    return { result: 'System prompt generator not available. Run: npx analyzthis_design system-prompt --mode ' + (args.mode || 'both') };
  }
}

// ── Helpers ──

function readSkill(id) {
  var p = path.join(PACKAGE_ROOT, 'skills', id, 'SKILL.md');
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8');
}

function readSkillFront(id) {
  return readSkill(id);
}

// ── MCP config writer ──

function mergeMcpServer(configPath) {
  var dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  var config = {};
  if (fs.existsSync(configPath)) {
    try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch (e) {}
  }
  if (typeof config !== 'object' || config === null || Array.isArray(config)) config = {};
  config.mcpServers = config.mcpServers || {};
  config.mcpServers['analyzthis_design'] = {
    command: 'npx',
    args: ['analyzthis_design', 'mcp'],
    env: { ANALYZTHIS_MCP_CATALOG: process.env.ANALYZTHIS_MCP_CATALOG || 'lite' },
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  return configPath;
}

function looksLikeProjectCwd() {
  var cwd = process.cwd();
  return fs.existsSync(path.join(cwd, 'package.json')) || fs.existsSync(path.join(cwd, '.git'));
}

function writeMcpConfig(target, opts) {
  opts = opts || {};
  if (opts.catalog) process.env.ANALYZTHIS_MCP_CATALOG = opts.catalog;
  var home = os.homedir();

  if (target === 'cursor') {
    var cursorConfigPath = path.join(home, '.cursor', 'mcp.json');
    mergeMcpServer(cursorConfigPath);
    console.log('Cursor MCP config written to ' + cursorConfigPath);
    console.log('Default MCP catalog is lite (router + retrieve + session + receipt).');
    console.log('Full 19-tool list: ANALYZTHIS_MCP_CATALOG=full or mcp --catalog full');
    console.log('Restart Cursor to activate.\n');
    return true;
  }

  if (target === 'claude') {
    var claudeDesktopPath;
    if (process.platform === 'darwin') {
      claudeDesktopPath = path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
    } else if (process.platform === 'win32') {
      claudeDesktopPath = path.join(home, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json');
    } else {
      claudeDesktopPath = path.join(home, '.config', 'Claude', 'claude_desktop_config.json');
    }
    mergeMcpServer(claudeDesktopPath);
    console.log('Claude Desktop MCP config written to ' + claudeDesktopPath);

    var claudeCodePath = path.join(home, '.claude.json');
    mergeMcpServer(claudeCodePath);
    console.log('Claude Code MCP config written to ' + claudeCodePath);

    if (looksLikeProjectCwd()) {
      var projectMcp = path.join(process.cwd(), '.mcp.json');
      mergeMcpServer(projectMcp);
      console.log('Project MCP config written to ' + projectMcp);
    }

    console.log('Default MCP catalog is lite. Full list: ANALYZTHIS_MCP_CATALOG=full');
    console.log('Restart Claude Code and Claude Desktop to activate.\n');
    return true;
  }

  if (target === 'windsurf') {
    var windsurfConfigPath = path.join(home, '.codeium', 'windsurf', 'mcp_config.json');
    mergeMcpServer(windsurfConfigPath);
    console.log('Windsurf MCP config written to ' + windsurfConfigPath);
    console.log('Restart Windsurf to activate.\n');
    return true;
  }

  console.log('Manual config for ' + target + ':');
  console.log(JSON.stringify({
    mcpServers: {
      'analyzthis_design': {
        command: 'npx',
        args: ['analyzthis_design', 'mcp'],
      }
    }
  }, null, 2));
  console.log('\nPaste this into your tool\'s MCP server configuration.\n');
  return true;
}

// ── MCP protocol (JSON-RPC 2.0 over stdio) ────────────────────────────────

function startStdioServer(catalog) {
  var catalogMode = resolveCatalog(catalog);
  var activeTools = listedTools(catalogMode);
  var rl = readline.createInterface({ input: process.stdin, terminal: false });
  var initialized = false;

  function send(msg) {
    process.stdout.write(JSON.stringify(msg) + '\n');
  }

  function handleMessage(msg) {
    if (!msg || !msg.jsonrpc) return;
    var id = msg.id;
    var method = msg.method;
    var params = msg.params || {};

    // Initialize
    if (method === 'initialize') {
      initialized = true;
      send({
        jsonrpc: '2.0',
        id: id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: 'analyzthis_design',
            version: VERSION,
          },
        },
      });
      return;
    }

    // Initialized notification
    if (method === 'notifications/initialized') {
      return;
    }

    // Tools list
    if (method === 'tools/list') {
      send({
        jsonrpc: '2.0',
        id: id,
        result: {
          tools: activeTools.map(function(t) {
            return {
              name: t.name,
              description: t.description,
              inputSchema: t.inputSchema,
            };
          }),
        },
      });
      return;
    }

    // Tool call
    if (method === 'tools/call') {
      var toolName = params.name;
      var toolArgs = params.arguments || {};
      // Some tools (mood board create / show) are async.
      Promise.resolve().then(function() { return handleToolCall(toolName, toolArgs); }).then(function(result) {
      if (result.error) {
        send({
          jsonrpc: '2.0',
          id: id,
          error: { code: -32603, message: result.error },
        });
      } else {
        var text = result.prompt || result.result || result.command || JSON.stringify(result, null, 2);
        var receipt = require('./receipt');
        var wrapped = receipt.wrapPayload(text, {
          path: 'mcp',
          persona: result.persona || result.skill || toolName,
          verdicts: result.verdicts || 0,
        });
        send({
          jsonrpc: '2.0',
          id: id,
          result: {
            content: [{ type: 'text', text: wrapped }],
          },
        });
      }
      }).catch(function(e) {
        send({ jsonrpc: '2.0', id: id, error: { code: -32603, message: e.message } });
      });
      return;
    }

    // Unknown method
    if (id !== undefined) {
      send({
        jsonrpc: '2.0',
        id: id,
        error: { code: -32601, message: 'Method not found: ' + method },
      });
    }
  }

  rl.on('line', function(line) {
    try {
      var msg = JSON.parse(line);
      handleMessage(msg);
    } catch (e) {
      if (process.env.MCP_DEBUG) {
        process.stderr.write('Parse error: ' + e.message + '\n');
      }
    }
  });

  rl.on('close', function() {
    process.exit(0);
  });

  if (process.env.MCP_DEBUG) {
    process.stderr.write('analyzthis_design MCP server v' + VERSION + ' running on stdio\n');
    process.stderr.write('Tools: ' + activeTools.length + ' (' + catalogMode + ' catalog)\n');
  }
}

// ── Entry point ──

function parseCatalogFlag(args) {
  var eq = args.filter(function (a) { return a.indexOf('--catalog=') === 0; })[0];
  if (eq) return eq.split('=').slice(1).join('=');
  var idx = args.indexOf('--catalog');
  if (idx !== -1 && args[idx + 1] && args[idx + 1].indexOf('--') !== 0) return args[idx + 1];
  return null;
}

function main() {
  var args = process.argv.slice(2);
  var catalog = parseCatalogFlag(args);

  // --configure <target>
  var configureIdx = args.indexOf('--configure');
  if (configureIdx !== -1 && args[configureIdx + 1]) {
    writeMcpConfig(args[configureIdx + 1], { catalog: catalog });
    return;
  }

  startStdioServer(catalog);
}

if (require.main === module) {
  main();
}

module.exports = {
  TOOLS: TOOLS,
  ROUTER_TOOL: ROUTER_TOOL,
  RECEIPT_TOOL: RECEIPT_TOOL,
  listedTools: listedTools,
  resolveCatalog: resolveCatalog,
  handleToolCall: handleToolCall,
  startStdioServer: startStdioServer,
  writeMcpConfig: writeMcpConfig,
};