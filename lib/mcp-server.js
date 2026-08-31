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
    description: 'Zara — Delight moments. Identifies exactly ONE structural or surface delight moment in a design. Covers first impressions, onboarding flows, empty states, peak moments, and once-ever experiences. Use after the core critique is done.',
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
    description: 'Mood Board — Visual direction. Collects web references + design-system patterns, tags them by style/mood/surface, and runs team deliberation (Arjun, Meera, Priya, Zara, Noor) using the UX Honeycomb matrix. Use for setting visual direction before designing.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Visual direction brief (e.g., "B2B fintech dashboard, trustworthy, high-contrast, data-dense")' },
        urls: { type: 'array', items: { type: 'string' }, description: 'Web reference URLs to include' },
        auto: { type: 'boolean', description: 'Auto-collect references' },
      },
      required: ['task'],
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
    description: 'Retrieve CSV reference data. Query the 28-file reference library (colors, styles, typography, UX guidelines, charts, products, landing patterns, 16 stack guides). Returns filtered, citation-ready rows.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'CSV filename (e.g., "styles.csv", "colors.csv", "stacks/nextjs.csv")' },
        column: { type: 'string', description: 'Column to filter on (e.g., "Product Type", "Category", "Best For Tags")' },
        keywords: { type: 'string', description: 'Comma-separated keywords to match (e.g., "saas,dashboard")' },
        limit: { type: 'number', description: 'Max rows to return (default: 3)' },
      },
      required: ['file'],
    },
  },
  {
    name: 'analyzthis_session',
    description: 'Read or write shared session state. The session holds persona outputs, routing decisions, synthesis results, metrics, and evolution data. Use to check what a previous run produced.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['show', 'init', 'reset', 'accept'], description: 'show: display current state; init: create fresh; reset: delete; accept: mark a persona output as accepted' },
        persona: { type: 'string', description: 'Persona ID (for accept action)' },
        reject: { type: 'boolean', description: 'Reject instead of accept (for accept action)' },
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

    default:
      return { error: 'Unknown tool: ' + name };
  }
}

function handleSinglePersona(personaId, args) {
  var card = readCard(personaId);
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
    'Produce your output following the schema in your card above. ' +
    'Be specific — cite components, zones, and fixes. ' +
    'Do not give generic advice.';

  return { prompt: prompt, persona: personaId, task: task };
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
    'Run all phases sequentially. Challenge the premise first. ' +
    'Resolve any persona disagreements explicitly — pick a winner with a forward path. ' +
    'Produce the final output in the format specified by the skill.';

  return { prompt: prompt, skill: skillId, task: task };
}

function handleMoodBoard(args) {
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
  try {
    var retrieve = require('./retrieve');
    var file = args.file;
    if (!file) return { error: 'file is required' };
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
      if (!args.persona) return { error: 'persona is required for accept' };
      var result = session.markAccepted({ persona: args.persona, accepted: !args.reject });
      return { result: JSON.stringify(result) };
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

function readCard(id) {
  var p = path.join(PACKAGE_ROOT, 'agents', 'cards', id + '.md');
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8');
}

function readSkill(id) {
  var p = path.join(PACKAGE_ROOT, 'skills', id, 'SKILL.md');
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8');
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
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  return configPath;
}

function looksLikeProjectCwd() {
  var cwd = process.cwd();
  return fs.existsSync(path.join(cwd, 'package.json')) || fs.existsSync(path.join(cwd, '.git'));
}

function writeMcpConfig(target) {
  var home = os.homedir();

  if (target === 'cursor') {
    var cursorConfigPath = path.join(home, '.cursor', 'mcp.json');
    mergeMcpServer(cursorConfigPath);
    console.log('Cursor MCP config written to ' + cursorConfigPath);
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

function startStdioServer() {
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
          tools: TOOLS.map(function(t) {
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
      var result = handleToolCall(toolName, toolArgs);

      if (result.error) {
        send({
          jsonrpc: '2.0',
          id: id,
          error: { code: -32603, message: result.error },
        });
      } else {
        var text = result.prompt || result.result || result.command || JSON.stringify(result, null, 2);
        send({
          jsonrpc: '2.0',
          id: id,
          result: {
            content: [{ type: 'text', text: String(text) }],
          },
        });
      }
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
    process.stderr.write('Tools: ' + TOOLS.length + ' available\n');
  }
}

// ── Entry point ──

function main() {
  var args = process.argv.slice(2);

  // --configure <target>
  var configureIdx = args.indexOf('--configure');
  if (configureIdx !== -1 && args[configureIdx + 1]) {
    writeMcpConfig(args[configureIdx + 1]);
    return;
  }

  // Default: start stdio server
  startStdioServer();
}

if (require.main === module) {
  main();
}

module.exports = {
  TOOLS: TOOLS,
  handleToolCall: handleToolCall,
  startStdioServer: startStdioServer,
  writeMcpConfig: writeMcpConfig,
};