'use strict';

/**
 * MoodBoard engine (v1.22).
 *
 * Collects visual + textual references from the web and design-system data,
 * tags them, lets the user contribute references, then runs the persona team
 * through an adversarial deliberation loop to converge on a direction.
 *
 * Artifacts are written to:
 *   ~/.analyzthis_design/sessions/{projectId}/moodboard/{boardId}/
 * and symlinked/copied into the project workspace at:
 *   ./moodboard/ (unless the user changes the output path in config).
 *
 * All new files use CommonJS, 'use strict', no optional chaining, var, and
 * try/catch around JSON/fs to stay compatible with the Llama 30B safety
 * settings used elsewhere in this repo.
 */

var fs = require('fs');
var path = require('path');
var os = require('os');
var crypto = require('crypto');
var session = require('./session');
var research = require('./research');
var retrieve = require('./retrieve');
var knowledge = require('./knowledge');
var deliberation = require('./deliberation');
var { run: orchestratorRun } = require('./orchestrator/run');
var { resolvePackageRoot } = require('./platforms');

var CONFIG_FILE = path.join(os.homedir(), '.analyzthis_design', 'config.json');
var PACKAGE_ROOT = resolvePackageRoot(__dirname);
var DESIGN_REFERENCE_DIR = path.join(PACKAGE_ROOT, 'skills', 'design-reference');

function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
  catch (e) { return {}; }
}

function generateBoardId() {
  return crypto.randomBytes(6).toString('hex');
}

function boardDir(projectId, boardId) {
  return path.join(session.sessionDir(projectId), 'moodboard', boardId);
}

function defaultWorkspaceDir() {
  return path.join(process.cwd(), 'moodboard');
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function loadJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch (e) { return null; }
}

function writeJson(filePath, obj) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2));
}

// ─── Source discovery for mood references ───────────────────────────────────

// Known hosts that expose an image or a design article we can fetch as text.
var MOOD_REFERENCE_HOSTS = [
  'dribbble.com',
  'mobbin.com',
  'behance.net',
  'www.behance.net',
  'awwwards.com',
  'www.awwwards.com',
  'screenlane.com',
  'www.screenlane.com',
  'ui-patterns.com',
  'www.ui-patterns.com',
  'pttrns.com',
  'www.pttrns.com',
  'land-book.com',
  'www.land-book.com',
  'onepagelove.com',
  'www.onepagelove.com',
];

function isVisualReferenceUrl(url) {
  try {
    var u = new URL(url);
    var host = u.hostname.toLowerCase();
    var ext = path.extname(u.pathname).toLowerCase();
    if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif'].indexOf(ext) !== -1) return true;
    return MOOD_REFERENCE_HOSTS.some(function(h) { return host === h || host.endsWith('.' + h); });
  } catch (e) {
    return false;
  }
}

function extractUrlsFromText(text) {
  var re = /https?:\/\/[^\s)'">\]`]+/gi;
  var found = String(text).match(re) || [];
  return found.map(function(u) {
    return u.replace(/^[`'"]+|[`'"]+$/g, '').replace(/[.,;:!?)]+$/g, '');
  }).filter(function(u) { return u.length >= 12 && !/[{}]/.test(u); });
}

function discoverReferenceUrls({ task, urls, config }) {
  var cfg = config.moodboard || {};
  var explicit = (cfg.urls || []).concat(urls || []);
  var discovered = [];
  var seen = {};

  for (var i = 0; i < explicit.length; i++) {
    var u = explicit[i];
    if (seen[u]) continue;
    seen[u] = true;
    discovered.push({ url: u, source: 'config', type: isVisualReferenceUrl(u) ? 'visual' : 'article' });
  }

  // Add a small number of curated search stubs the host IDE can fill in.
  var queries = cfg.queries || [];
  var taskQuery = String(task).slice(0, 80);
  if (queries.indexOf(taskQuery) === -1) queries.push(taskQuery);
  for (var j = 0; j < queries.length; j++) {
    var q = queries[j];
    var stubUrl = 'https://www.google.com/search?q=' + encodeURIComponent(q + ' design inspiration');
    if (!seen[stubUrl]) {
      seen[stubUrl] = true;
      discovered.push({ url: stubUrl, source: 'query_stub', type: 'search_stub', query: q });
    }
  }

  return discovered.slice(0, cfg.limit || 12);
}

// ─── Fetch references (text + image metadata) ────────────────────────────────

async function fetchReference(ref) {
  var result = {
    id: generateBoardId(),
    url: ref.url,
    source: ref.source,
    type: ref.type || 'article',
    query: ref.query || '',
    title: '',
    description: '',
    tags: [],
    fetched_at: new Date().toISOString(),
    error: null,
  };

  if (ref.type === 'search_stub') {
    result.title = 'Search stub: ' + ref.query;
    result.description = 'Host IDE: perform web search for "' + ref.query + '" and add the resulting references to the board.';
    result.tags = ['search_stub'];
    return result;
  }

  if (ref.type === 'visual') {
    result.title = 'Visual reference: ' + path.basename(new URL(ref.url).pathname || 'image');
    result.description = 'Image URL. Add alt-text or a local caption after review.';
    result.tags = ['visual'];
    return result;
  }

  try {
    var fetched = await research.researchUrl({ url: ref.url, maxChars: 2000 });
    var web = research.readWebContext() || { content: '' };
    var blocks = web.content.split(/^## /m);
    var lastBlock = blocks[blocks.length - 1] || '';
    var lines = lastBlock.split('\n').filter(function(l) { return l.trim(); });
    var bodyLines = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line.indexOf('Source:') === 0) continue;
      if (line.indexOf('Fetched:') === 0) continue;
      bodyLines.push(line);
    }
    result.title = 'Fetched: ' + ref.url;
    result.description = bodyLines.join(' ').slice(0, 600);
    result.tags = ['article'];
  } catch (e) {
    result.error = e.message;
    result.description = 'Could not fetch this URL.';
  }

  return result;
}

// ─── Tag references with an LLM or fallback heuristics ───────────────────────

function tagHeuristics(ref, task) {
  var tags = [].concat(ref.tags || []);
  var lowerDesc = (ref.description + ' ' + ref.title).toLowerCase();
  var taskLower = String(task).toLowerCase();

  var keywordMap = [
    ['minimal', 'minimalism'],
    ['modern', 'modern'],
    ['dark', 'dark mode'],
    ['light', 'light'],
    ['b2b', 'b2b'],
    ['saas', 'saas'],
    ['dashboard', 'dashboard'],
    ['fintech', 'fintech'],
    ['healthcare', 'healthcare'],
    ['ecommerce', 'e-commerce'],
    ['luxury', 'luxury'],
    ['playful', 'playful'],
    ['trust', 'trust'],
    ['data-dense', 'data-dense'],
    ['card', 'cards'],
    ['table', 'tables'],
    ['glassmorphism', 'glassmorphism'],
    ['neumorphism', 'neumorphism'],
    ['brutalism', 'brutalism'],
    ['typography', 'typography'],
    ['color', 'color'],
  ];

  for (var i = 0; i < keywordMap.length; i++) {
    var tag = keywordMap[i][0];
    var needle = keywordMap[i][1];
    if (lowerDesc.indexOf(needle) !== -1 && tags.indexOf(tag) === -1) tags.push(tag);
  }

  var taskKeywords = [
    'dashboard', 'landing', 'onboarding', 'settings', 'checkout', 'profile',
    'invoice', 'analytics', 'calendar', 'form', 'wizard', 'modal'
  ];
  for (var j = 0; j < taskKeywords.length; j++) {
    var kw = taskKeywords[j];
    if (taskLower.indexOf(kw) !== -1 && tags.indexOf(kw) === -1) tags.push(kw);
  }

  return tags;
}

async function tagReference(ref, task, callLlmFn) {
  var tags = tagHeuristics(ref, task);
  if (!callLlmFn) {
    ref.tags = tags;
    return ref;
  }

  var prompt = [
    'You are a design-librarian. Tag this reference for a mood board.',
    'Return ONLY a JSON object with keys: "tags" (array of 3-7 short slugs), "mood" (one word), "surface" (what UI surface it shows, e.g. dashboard, landing, settings), "style" (one of: minimal, dense, playful, premium, brutalist, glassmorphism, neumorphism, corporate, editorial).',
    '',
    'Task context: ' + String(task).slice(0, 200),
    '',
    'Reference title: ' + (ref.title || '').slice(0, 200),
    'Description: ' + (ref.description || '').slice(0, 500),
    'Existing heuristic tags: ' + tags.join(', '),
  ].join('\n');

  try {
    var raw = await callLlmFn({ system: '', user: prompt, maxTokens: 400, personaId: 'mood-tagger' });
    var parsed = null;
    var fence = raw.match(/```json\s*([\s\S]*?)```/i);
    if (fence) parsed = JSON.parse(fence[1].trim());
    else parsed = JSON.parse(raw.trim());

    if (parsed && Array.isArray(parsed.tags)) {
      for (var i = 0; i < parsed.tags.length; i++) {
        var t = parsed.tags[i];
        if (tags.indexOf(t) === -1) tags.push(t);
      }
    }
    if (parsed && parsed.mood && tags.indexOf(parsed.mood) === -1) tags.push(parsed.mood);
    if (parsed && parsed.surface && tags.indexOf(parsed.surface) === -1) tags.push(parsed.surface);
    if (parsed && parsed.style && tags.indexOf(parsed.style) === -1) tags.push(parsed.style);
  } catch (e) {
    // keep heuristic tags
  }

  ref.tags = tags;
  return ref;
}

// ─── Design-system reference retrieval ────────────────────────────────────────

function getDsReferencePack(task, stack) {
  var packs = [];
  var keywords = [];
  var taskLower = String(task).toLowerCase();
  var keywordMap = [
    ['saas', 'saas'], ['b2b', 'b2b'], ['dashboard', 'dashboard'],
    ['fintech', 'fintech'], ['healthcare', 'healthcare'], ['ecommerce', 'e-commerce'],
    ['luxury', 'luxury'], ['landing', 'landing'], ['mobile', 'mobile'],
    ['analytics', 'analytics'], ['productivity', 'productivity'], ['social', 'social']
  ];
  for (var i = 0; i < keywordMap.length; i++) {
    if (taskLower.indexOf(keywordMap[i][0]) !== -1) keywords.push(keywordMap[i][1]);
  }
  if (!keywords.length) keywords.push('general');

  var specs = [
    { file: 'ui-reasoning.csv', column: 'UI_Category', limit: 3 },
    { file: 'colors.csv', column: 'Product Type', limit: 3 },
    { file: 'styles.csv', column: 'Best For', limit: 3 },
    { file: 'typography.csv', column: 'Mood', limit: 2 },
    { file: 'ux-guidelines.csv', column: 'Category', limit: 3 },
  ];

  if (stack) {
    var stackFile = path.join('stacks', stack + '.csv');
    var stackPath = path.join(DESIGN_REFERENCE_DIR, stackFile);
    if (fs.existsSync(stackPath)) {
      specs.unshift({ file: stackFile, column: 'Category', limit: 3 });
    }
  }

  for (var s = 0; s < specs.length; s++) {
    var spec = specs[s];
    try {
      var result = retrieve.retrieve({
        file: spec.file,
        filters: [{ column: spec.column, anyOf: keywords }],
        limit: spec.limit,
      });
      if (result.rows.length) {
        packs.push({ file: spec.file, rows: result.rows });
      }
    } catch (e) {
      // skip missing files
    }
  }

  return packs;
}

function formatDsPack(packs) {
  var lines = ['Design-system reference patterns:'];
  for (var i = 0; i < packs.length; i++) {
    var p = packs[i];
    lines.push('\n[' + p.file + ']');
    for (var r = 0; r < p.rows.length; r++) {
      var row = p.rows[r];
      var values = Object.keys(row).map(function(k) { return k + '=' + row[k]; }).join(' | ');
      lines.push('  • ' + values.slice(0, 300));
    }
  }
  return lines.join('\n');
}

// ─── Build the mood board ─────────────────────────────────────────────────────

async function buildMoodBoard(opts) {
  opts = opts || {};
  var projectId = opts.project || session.getProjectId();
  var task = opts.task || '';
  var config = loadConfig();
  var workspaceDir = opts.workspaceDir || config.moodboard?.workspace_dir || defaultWorkspaceDir();
  var boardId = opts.boardId || generateBoardId();
  var bDir = boardDir(projectId, boardId);
  ensureDir(bDir);

  var refs = [];
  var userRefs = opts.userReferences || [];
  var discover = opts.discover !== false;

  if (discover) {
    var plan = discoverReferenceUrls({ task: task, urls: opts.urls || [], config: config });
    for (var i = 0; i < plan.length; i++) {
      var fetched = await fetchReference(plan[i]);
      var tagged = await tagReference(fetched, task, opts.callLlmFn || null);
      refs.push(tagged);
    }
  }

  for (var u = 0; u < userRefs.length; u++) {
    var ur = userRefs[u];
    var ref = {
      id: generateBoardId(),
      url: ur.url || '',
      title: ur.title || (ur.url ? path.basename(new URL(ur.url).pathname || 'user-ref') : 'User note'),
      description: ur.description || '',
      source: 'user',
      type: ur.type || 'note',
      tags: ur.tags || [],
      user_note: ur.note || '',
      fetched_at: new Date().toISOString(),
    };
    if (!ref.tags.length) ref.tags = tagHeuristics(ref, task);
    refs.push(ref);
  }

  var state = session.show({ project: projectId }) || session.init({ project: projectId });
  var stack = detectStack(state.vault_path);
  var dsPack = getDsReferencePack(task, stack);

  var board = {
    board_id: boardId,
    project_id: projectId,
    task: task,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    references: refs,
    design_system_pack: dsPack,
    deliberation: null,
    synthesis: null,
    user_contributions: userRefs.length,
  };

  writeJson(path.join(bDir, 'board.json'), board);

  // Copy/symlink to workspace so the user can open it directly.
  ensureDir(workspaceDir);
  var workspacePath = path.join(workspaceDir, boardId + '.json');
  try {
    fs.writeFileSync(workspacePath, JSON.stringify(board, null, 2));
  } catch (e) {
    // workspace write is best-effort (e.g. read-only cwd)
  }

  return { board: board, boardDir: bDir, workspacePath: workspacePath };
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

// ─── Persona critique over a mood board ───────────────────────────────────────

async function critiqueMoodBoard(opts) {
  opts = opts || {};
  var projectId = opts.project || session.getProjectId();
  var boardId = opts.boardId;
  if (!boardId) throw new Error('--board is required');
  var bDir = boardDir(projectId, boardId);
  var boardPath = path.join(bDir, 'board.json');
  var board = loadJson(boardPath);
  if (!board) throw new Error('Board not found: ' + boardId);

  var experts = opts.experts || ['arjun', 'meera', 'priya', 'zara', 'noor'];
  var task = opts.task || board.task;

  // Build a synthetic critique task that includes the board and DS pack.
  var refsSummary = board.references.map(function(r, idx) {
    return '[' + (idx + 1) + '] ' + r.title + ' (' + r.type + ') tags=' + r.tags.join(',') + ' — ' + (r.url || r.description).slice(0, 120);
  }).join('\n');

  var dsText = formatDsPack(board.design_system_pack);

  var critiqueTask = [
    'Mood-board critique for: ' + task,
    '',
    'References:\n' + refsSummary,
    '',
    dsText,
    '',
    'Each persona must use the Honeycomb rigor matrix to evaluate which references are appropriate for the user and why. Output scores, top concerns, and a ranked shortlist of the best 2-3 references. Then participate in adversarial deliberation until consensus.'
  ].join('\n');

  // Use the orchestrator directly, but force the experts to the mood-board set.
  var result = await orchestratorRun({
    task: critiqueTask,
    experts: experts,
    project: projectId,
    provider: opts.provider || 'host',
    model: opts.model,
    dryRun: !!opts.dryRun,
    deliberate: opts.noDeliberate ? false : true,
    maxRounds: opts.maxRounds || 3,
    satisfaction: opts.satisfaction || 0.4,
    hostResponder: opts.hostResponder || null,
  });

  board.deliberation = result.deliberation;
  board.synthesis = result.synthesis;
  board.updated_at = new Date().toISOString();
  board.critique_task = critiqueTask;

  writeJson(boardPath, board);
  var workspaceDir = opts.workspaceDir || defaultWorkspaceDir();
  ensureDir(workspaceDir);
  var workspacePath = path.join(workspaceDir, boardId + '.json');
  try { fs.writeFileSync(workspacePath, JSON.stringify(board, null, 2)); }
  catch (e) { /* best effort */ }

  return { board: board, orchestratorResult: result };
}

// ─── Add user reference and rerun ─────────────────────────────────────────────

async function addUserReferenceAndRerun(opts) {
  opts = opts || {};
  var projectId = opts.project || session.getProjectId();
  var boardId = opts.boardId;
  var userRef = opts.reference;
  if (!boardId || !userRef) throw new Error('--board and --reference are required');

  var bDir = boardDir(projectId, boardId);
  var boardPath = path.join(bDir, 'board.json');
  var board = loadJson(boardPath);
  if (!board) throw new Error('Board not found: ' + boardId);

  var ref = {
    id: generateBoardId(),
    url: userRef.url || '',
    title: userRef.title || (userRef.url ? path.basename(new URL(userRef.url).pathname || 'user-ref') : 'User note'),
    description: userRef.description || '',
    source: 'user',
    type: userRef.type || 'note',
    tags: userRef.tags || [],
    user_note: userRef.note || '',
    fetched_at: new Date().toISOString(),
  };
  if (!ref.tags.length) ref.tags = tagHeuristics(ref, board.task);
  board.references.push(ref);
  board.user_contributions = (board.user_contributions || 0) + 1;
  board.updated_at = new Date().toISOString();
  writeJson(boardPath, board);

  // Rerun critique with updated board.
  var critique = await critiqueMoodBoard({
    project: projectId,
    boardId: boardId,
    task: opts.task || board.task,
    experts: opts.experts,
    provider: opts.provider,
    model: opts.model,
    dryRun: !!opts.dryRun,
    noDeliberate: opts.noDeliberate,
    maxRounds: opts.maxRounds,
    satisfaction: opts.satisfaction,
    hostResponder: opts.hostResponder,
  });

  return { board: critique.board, added: ref };
}

// ─── List boards ──────────────────────────────────────────────────────────────

function listBoards(projectId) {
  projectId = projectId || session.getProjectId();
  var bRoot = path.join(session.sessionDir(projectId), 'moodboard');
  if (!fs.existsSync(bRoot)) return [];
  return fs.readdirSync(bRoot, { withFileTypes: true })
    .filter(function(d) { return d.isDirectory(); })
    .map(function(d) { return d.name; });
}

module.exports = {
  buildMoodBoard: buildMoodBoard,
  critiqueMoodBoard: critiqueMoodBoard,
  addUserReferenceAndRerun: addUserReferenceAndRerun,
  listBoards: listBoards,
  boardDir: boardDir,
  formatDsPack: formatDsPack,
  tagHeuristics: tagHeuristics,
};
