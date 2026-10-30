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

function persistBoard(board, workspaceDir) {
  var projectId = board.project_id;
  var bDir = boardDir(projectId, board.board_id);
  board.updated_at = new Date().toISOString();
  if (board.kind === 'ui') normalizeBoard(board);
  writeJson(path.join(bDir, 'board.json'), board);
  var htmlPath = '';
  if (board.kind === 'ui') {
    // Static snapshot opens straight from disk; `moodboard show` serves the
    // clickable version.
    htmlPath = path.join(bDir, 'index.html');
    try { fs.writeFileSync(htmlPath, require('./moodboard-view').renderBoardHtml(board, { interactive: false })); }
    catch (e) { htmlPath = ''; }
  }
  var ws = workspaceDir || defaultWorkspaceDir();
  ensureDir(ws);
  var workspacePath = path.join(ws, board.board_id + '.json');
  try { fs.writeFileSync(workspacePath, JSON.stringify(board, null, 2)); }
  catch (e) { /* best effort */ }
  return { board: board, boardDir: bDir, workspacePath: workspacePath, htmlPath: htmlPath };
}

// ─── Board v3: sections, element tiles, user decisions ──────────────────────

// Section targets add up to roughly 20-24 tiles. A board only uses the
// sections named in its brief, so a dashboard can drop first_screen.
var SECTIONS = [
  { id: 'first_screen', label: 'First screen', min: 3, max: 5 },
  { id: 'typography', label: 'Typography', min: 3, max: 4 },
  { id: 'color', label: 'Colour and contrast', min: 3, max: 4 },
  { id: 'components', label: 'Components and density', min: 6, max: 8 },
  { id: 'imagery', label: 'Imagery and icons', min: 2, max: 4 },
  { id: 'motion', label: 'Motion and interaction', min: 1, max: 3 },
];
var SECTION_IDS = SECTIONS.map(function(s) { return s.id; });
var TILE_TARGET = { min: 20, max: 24, sites: 6 };
var USER_DECISIONS = ['keep', 'reject', 'maybe'];
var JURY = ['arjun', 'meera', 'priya', 'noor'];
var IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];

function clip(value, max) {
  return String(value == null ? '' : value).slice(0, max);
}

function isHttpUrl(value) {
  try {
    var u = new URL(String(value));
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch (e) {
    return false;
  }
}

function siteOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch (e) { return ''; }
}

// A tile is identified by where it came from plus what element it is, so a
// rejected "pricing card on linear.app" cannot sneak back in a later round.
function tileKey(pageUrl, element) {
  var u = String(pageUrl || '').replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase();
  return u + '|' + String(element || '').trim().toLowerCase();
}

function defaultBrief(task, brief) {
  brief = brief || {};
  var sections = (brief.sections || []).filter(function(s) { return SECTION_IDS.indexOf(s) !== -1; });
  return {
    job: clip(brief.job || task, 240),
    adjectives: (brief.adjectives || []).map(function(a) { return clip(a, 40); }).filter(Boolean).slice(0, 3),
    not_this: clip(brief.not_this || '', 200),
    sections: sections.length ? sections : SECTION_IDS.slice(),
    confirmed_by_user: !!brief.confirmed_by_user,
  };
}

function sanitizeTokens(tokens) {
  tokens = tokens || {};
  var hex = /^#[0-9a-f]{3,8}$/i;
  return {
    colors: (tokens.colors || []).map(function(c) { return String(c).trim(); })
      .filter(function(c) { return hex.test(c) || /^rgba?\([\d\s.,%]+\)$/i.test(c); }).slice(0, 8),
    fonts: (tokens.fonts || []).map(function(f) { return clip(f, 60).trim(); }).filter(Boolean).slice(0, 4),
    radius: clip(tokens.radius || '', 24),
    spacing: clip(tokens.spacing || '', 40),
    font_size: clip(tokens.font_size || '', 24),
  };
}

function defaultScoutBrief(task, round, constraints) {
  var c = constraints && typeof constraints === 'object' ? constraints : { veto: constraints || '' };
  var lines = [
    'Zara Scout Pass, round ' + (round || 1) + '.',
    'Job: ' + clip(task, 240),
  ];
  if (c.adjectives && c.adjectives.length) lines.push('Feel: ' + c.adjectives.join(', ') + (c.not_this ? '. Not this: ' + c.not_this : ''));
  if (c.userNote || (c.kept && c.kept.length) || (c.rejected && c.rejected.length)) {
    lines.push('USER DECISIONS — these outrank every persona, including you:');
    if (c.userNote) lines.push('  User asked: ' + clip(c.userNote, 500));
    if (c.kept && c.kept.length) lines.push('  Kept (build around these): ' + c.kept.join('; '));
    if (c.rejected && c.rejected.length) lines.push('  Rejected (never bring back): ' + c.rejected.join('; '));
  }
  if (c.missing && c.missing.length) lines.push('Sections still thin: ' + c.missing.join(', ') + '. Fill these first.');
  lines.push(
    'Build an element collage: ' + TILE_TARGET.min + '-' + TILE_TARGET.max + ' tiles from at least ' + TILE_TARGET.sites + ' different sites. Crop one element per tile (a card, a table header, a filter bar, a button group, a type pairing). Not whole pages.',
    'Hunt on real pages: live product sites, Mobbin, Dribbble, Pinterest, Awwwards, Google Images. Open each page in the browser. Never invent URLs. Never generate AI comps.',
    'Capture: browser_navigate to the page, browser_take_screenshot with ref=<element selector> and a filename, then run the capture script (moodboard capture-script) with Runtime.evaluate to read real colours, fonts, radius, spacing.',
    'Every tile needs: page_url, image_path, section (' + SECTION_IDS.join(' | ') + '), element, tokens, steal, refuse, peak.',
    'Lens: Peak-End, first 2 seconds. Concept shots are allowed if you say so. Never sell a Dribbble shot as shipped product. Skip AI-purple heroes and cinematic scroll-hijack on daily working screens.',
    'Then stop. Arjun, Noor, Priya and Meera vote as advice. The user decides.'
  );
  if (c.veto) lines.push('Jury notes (advice only): ' + clip(c.veto, 500));
  return lines.join('\n');
}

// Older boards stored Zara's picks as `frames`. Move them into `tiles` once.
function normalizeBoard(board) {
  if (!board) return board;
  if (!board.brief) board.brief = defaultBrief(board.task, null);
  if (!board.tiles) {
    board.tiles = (board.frames || []).map(function(f, idx) {
      return {
        id: f.id || generateBoardId(),
        n: idx + 1,
        section: SECTION_IDS.indexOf(f.surface) !== -1 ? f.surface : 'components',
        element: f.title || 'Frame',
        site: siteOf(f.url),
        page_url: f.url || '',
        image: '',
        image_url: f.url || '',
        tokens: sanitizeTokens(null),
        steal: f.steal || '', refuse: f.refuse || '', peak: f.peak || '',
        round: f.round || 1,
        source: f.source || 'zara_scout',
        added_at: f.added_at || new Date().toISOString(),
        votes: {},
        user: null,
      };
    });
  }
  delete board.frames;
  if (!board.decisions) board.decisions = [];
  if (!board.blocked) board.blocked = [];
  board.version = 3;
  return board;
}

function findTile(board, ref) {
  var asNum = parseInt(ref, 10);
  for (var i = 0; i < board.tiles.length; i++) {
    var t = board.tiles[i];
    if (t.id === ref || (String(asNum) === String(ref) && t.n === asNum)) return t;
  }
  return null;
}

// The user's decision is final. Persona votes only produce a suggestion
// while the user has not decided.
function tileStatus(tile) {
  if (tile.user && USER_DECISIONS.indexOf(tile.user.decision) !== -1) {
    return { status: tile.user.decision, by: 'user' };
  }
  var keep = 0, skip = 0;
  Object.keys(tile.votes || {}).forEach(function(p) {
    if (tile.votes[p].vote === 'keep') keep++;
    else if (tile.votes[p].vote === 'skip') skip++;
  });
  if (!keep && !skip) return { status: 'undecided', by: 'none' };
  return { status: keep >= skip ? 'suggested_keep' : 'suggested_skip', by: 'personas', keep: keep, skip: skip };
}

function computeDirection(board) {
  var kept = board.tiles.filter(function(t) { return tileStatus(t).status === 'keep'; });
  var rejected = board.tiles.filter(function(t) { return tileStatus(t).status === 'reject'; });
  var palette = [];
  var fonts = [];
  kept.forEach(function(t) {
    (t.tokens.colors || []).forEach(function(c) { if (palette.indexOf(c.toLowerCase()) === -1) palette.push(c.toLowerCase()); });
    (t.tokens.fonts || []).forEach(function(f) { if (fonts.indexOf(f) === -1) fonts.push(f); });
  });
  var bySection = {};
  board.brief.sections.forEach(function(s) { bySection[s] = 0; });
  kept.forEach(function(t) { if (bySection[t.section] != null) bySection[t.section]++; });
  var overruled = kept.filter(function(t) {
    var skips = Object.keys(t.votes || {}).filter(function(p) { return t.votes[p].vote === 'skip'; });
    return skips.length > 0;
  }).map(function(t) { return t.n; });
  return {
    kept: kept.map(function(t) {
      return { n: t.n, section: t.section, element: t.element, site: t.site, page_url: t.page_url, steal: t.steal, tokens: t.tokens, note: (t.user && t.user.note) || '' };
    }),
    rejected: rejected.map(function(t) {
      return { n: t.n, element: t.element, site: t.site, page_url: t.page_url, note: (t.user && t.user.note) || t.refuse || '' };
    }),
    palette: palette.slice(0, 10),
    fonts: fonts.slice(0, 4),
    by_section: bySection,
    missing_sections: Object.keys(bySection).filter(function(s) { return !bySection[s]; }),
    overruled_personas_on: overruled,
  };
}

function scoutConstraints(board, userNote) {
  var dir = computeDirection(board);
  return {
    adjectives: board.brief.adjectives,
    not_this: board.brief.not_this,
    userNote: userNote || '',
    kept: dir.kept.map(function(k) { return '#' + k.n + ' ' + k.element + ' (' + k.site + ')' + (k.note ? ' — ' + k.note : ''); }),
    rejected: dir.rejected.map(function(r) { return r.element + ' (' + r.site + ')' + (r.note ? ' — ' + r.note : ''); }),
    missing: dir.missing_sections,
  };
}

// ─── Source discovery for mood references ───────────────────────────────────

// Known hosts that expose an image or a design article we can fetch as text.
var MOOD_REFERENCE_HOSTS = [
  'dribbble.com',
  'pinterest.com',
  'www.pinterest.com',
  'pin.it',
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
  // The visual element board is the default. `--kind mood` keeps the older
  // link-and-tag board.
  var kind = opts.kind === 'mood' ? 'mood' : 'ui';
  var brief = defaultBrief(task, opts.brief);
  var discover = kind === 'ui' ? !!(opts.urls && opts.urls.length) : opts.discover !== false;

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
    kind: kind,
    task: task,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    references: refs,
    design_system_pack: dsPack,
    deliberation: null,
    synthesis: null,
    user_contributions: userRefs.length,
    scout: kind === 'ui' ? {
      persona: 'zara',
      round: 1,
      status: 'awaiting_scout',
      brief: defaultScoutBrief(task, 1, { adjectives: brief.adjectives, not_this: brief.not_this }),
      last_veto: '',
    } : null,
  };
  if (kind === 'ui') {
    board.brief = brief;
    board.tiles = [];
    board.decisions = [];
    board.blocked = [];
    board.version = 3;
  }

  return persistBoard(board, workspaceDir);
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

  var isUi = board.kind === 'ui';
  if (isUi) normalizeBoard(board);
  var experts = opts.experts || (isUi ? JURY.slice() : ['arjun', 'meera', 'priya', 'zara', 'noor']);
  var task = opts.task || board.task;

  if (isUi && !board.tiles.length) {
    var need = new Error('Zara has not scouted yet. Add tiles, then critique.');
    need.code = 'NEED_SCOUT';
    throw need;
  }

  var refsSummary = isUi
    ? juryTileLines(board)
    : board.references.map(function(r, idx) {
        return '[' + (idx + 1) + '] ' + r.title + ' (' + r.type + ') tags=' + (r.tags || []).join(',') + ' — ' + (r.url || r.description || '').slice(0, 120);
      }).join('\n');

  var dsText = formatDsPack(board.design_system_pack);

  var critiqueTask = isUi ? juryPrompt(board, dsText) : [
    'Mood-board critique for: ' + task,
    '',
    'References:\n' + refsSummary,
    '',
    dsText,
    '',
    'Each persona must use the Honeycomb rigor matrix to evaluate which references are appropriate for the user and why. Output scores, top concerns, and a ranked shortlist of the best 2-3 references. Then participate in adversarial deliberation until consensus.'
  ].join('\n');

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
  board.critique_task = critiqueTask;
  if (isUi) applyJuryOutcome(board, result.synthesis);

  var saved = persistBoard(board, opts.workspaceDir || defaultWorkspaceDir());
  return { board: saved.board, boardDir: saved.boardDir, workspacePath: saved.workspacePath, orchestratorResult: result };
}

// The jury's verdict is advice. It never closes the board or sends Zara back
// on its own — the board waits for the user.
function applyJuryOutcome(board, synthesis) {
  var verdict = String((synthesis && synthesis.verdict) || '').toUpperCase();
  var scout = board.scout || {};
  var notes = '';
  if (synthesis && synthesis.summary) notes = synthesis.summary;
  else if (synthesis && synthesis.top3 && synthesis.top3.join) notes = synthesis.top3.join('; ');
  else notes = verdict;
  scout.status = 'awaiting_user';
  scout.jury_verdict = verdict;
  scout.last_veto = clip(notes, 600);
  board.scout = scout;
}

function juryTileLines(board) {
  return board.tiles.map(function(t) {
    return '#' + t.n + ' [' + t.section + '] ' + t.element + ' — ' + t.site + ' round=' + t.round +
      '\n   steal=' + t.steal + ' | refuse=' + t.refuse + ' | peak=' + t.peak +
      (t.tokens.colors.length ? '\n   colours=' + t.tokens.colors.join(' ') : '') +
      (t.tokens.fonts.length ? ' fonts=' + t.tokens.fonts.join(', ') : '') +
      (t.user ? '\n   USER ALREADY DECIDED: ' + t.user.decision + (t.user.note ? ' — ' + t.user.note : '') + ' (do not argue with this)' : '');
  }).join('\n');
}

function juryPrompt(board, dsText) {
  return [
    'UI element-board jury for: ' + board.task,
    'You are Arjun, Noor, Priya and Meera. Zara scouted these tiles and does not vote. Your votes are advice shown to the user; the user decides.',
    'Vote KEEP or SKIP on every tile with one because-sentence. Do not reward cinematic marketing motion on a daily working surface.',
    '',
    'Tiles:\n' + juryTileLines(board),
    '',
    dsText || '',
    '',
    'Return votes as JSON: {"votes":[{"tile":<n>,"persona":"arjun","vote":"keep|skip","because":"..."}],"verdict":"SHIP|REVISE|BLOCK","summary":"..."}',
    'Then call analyzthis_mood_board with action=votes, board=' + board.board_id + ', and that JSON.'
  ].join('\n');
}

function loadUiBoard(opts) {
  var board = getBoard(opts);
  if (board.kind !== 'ui') throw new Error('This belongs on a UI element board (kind ui).');
  return normalizeBoard(board);
}

// Writes base64 screenshot data (inline, or a saved CDP Page.captureScreenshot
// response file) into the board's assets folder.
function saveBase64Image(bDir, tileId, data, label) {
  if (!data || typeof data !== 'string') throw new Error('No screenshot data in ' + label);
  var buf = Buffer.from(data.replace(/^data:image\/\w+;base64,/, ''), 'base64');
  if (buf.length > 8 * 1024 * 1024) throw new Error('Screenshot is larger than 8 MB: ' + label);
  var isPng = buf.slice(0, 4).toString('hex') === '89504e47';
  var isJpg = buf.slice(0, 2).toString('hex') === 'ffd8';
  if (!isPng && !isJpg) throw new Error('Screenshot data is not a PNG or JPEG: ' + label);
  var name = tileId + (isPng ? '.png' : '.jpg');
  ensureDir(path.join(bDir, 'assets'));
  fs.writeFileSync(path.join(bDir, 'assets', name), buf);
  return { image: 'assets/' + name, image_url: '' };
}

function resolveImage(board, bDir, tileId, tile) {
  if (tile.image_base64) return saveBase64Image(bDir, tileId, tile.image_base64, 'image_base64');
  if (tile.image_path && path.extname(String(tile.image_path)).toLowerCase() === '.json') {
    var jsonPath = path.resolve(String(tile.image_path));
    var raw = loadJson(jsonPath);
    return saveBase64Image(bDir, tileId, raw && (raw.data || (raw.result && raw.result.data)), jsonPath);
  }
  if (tile.image_path) {
    var src = path.resolve(String(tile.image_path));
    var ext = path.extname(src).toLowerCase();
    if (IMAGE_EXTS.indexOf(ext) === -1) throw new Error('Image must be one of ' + IMAGE_EXTS.join(', ') + ': ' + src);
    if (!fs.existsSync(src) || !fs.statSync(src).isFile()) throw new Error('Image file not found: ' + src);
    if (fs.statSync(src).size > 8 * 1024 * 1024) throw new Error('Image is larger than 8 MB: ' + src);
    var name = tileId + ext;
    ensureDir(path.join(bDir, 'assets'));
    fs.copyFileSync(src, path.join(bDir, 'assets', name));
    return { image: 'assets/' + name, image_url: '' };
  }
  if (tile.image_url && isHttpUrl(tile.image_url)) return { image: '', image_url: String(tile.image_url) };
  throw new Error('Each tile needs image_path (a saved crop) or an http(s) image_url.');
}

// Adds Zara's (or the user's) element crops. Every tile must say where it
// came from; tiles the user already rejected are refused.
function addTiles(opts) {
  opts = opts || {};
  var incoming = opts.tiles || (opts.tile ? [opts.tile] : []);
  if (!opts.boardId || !incoming.length) throw new Error('--board and at least one tile are required');
  var board = loadUiBoard(opts);
  var bDir = boardDir(board.project_id, board.board_id);
  var round = (board.scout && board.scout.round) || 1;
  var added = [];
  var skipped = [];
  for (var i = 0; i < incoming.length; i++) {
    var t = incoming[i] || {};
    var pageUrl = t.page_url || t.url || '';
    var element = clip(t.element || t.title || '', 120).trim();
    if (!isHttpUrl(pageUrl)) { skipped.push({ element: element, reason: 'missing or invalid page_url' }); continue; }
    if (!element) { skipped.push({ page_url: pageUrl, reason: 'missing element name' }); continue; }
    var key = tileKey(pageUrl, element);
    if (board.blocked.indexOf(key) !== -1) { skipped.push({ element: element, reason: 'user rejected this before' }); continue; }
    if (board.tiles.some(function(x) { return tileKey(x.page_url, x.element) === key; })) {
      skipped.push({ element: element, reason: 'already on the board' });
      continue;
    }
    var id = generateBoardId();
    var img;
    try { img = resolveImage(board, bDir, id, t); }
    catch (e) { skipped.push({ element: element, reason: e.message }); continue; }
    var tile = {
      id: id,
      n: board.tiles.reduce(function(m, x) { return Math.max(m, x.n || 0); }, 0) + 1,
      section: SECTION_IDS.indexOf(t.section) !== -1 ? t.section : 'components',
      element: element,
      site: siteOf(pageUrl),
      page_url: String(pageUrl),
      image: img.image,
      image_url: img.image_url,
      tokens: sanitizeTokens(t.tokens),
      steal: clip(t.steal, 200),
      refuse: clip(t.refuse, 200),
      peak: clip(t.peak, 200),
      concept: !!t.concept,
      round: round,
      source: t.source === 'user' ? 'user' : 'zara_scout',
      added_at: new Date().toISOString(),
      votes: {},
      user: null,
    };
    board.tiles.push(tile);
    added.push(tile);
  }
  if (board.scout && added.length) board.scout.status = 'awaiting_jury';
  var saved = persistBoard(board, opts.workspaceDir);
  saved.added = added;
  saved.skipped = skipped;
  return saved;
}

// Older `frames` input (url/title) is still accepted and becomes tiles.
function addFrames(opts) {
  opts = opts || {};
  var frames = opts.frames || (opts.frame ? [opts.frame] : []);
  return addTiles({
    project: opts.project,
    boardId: opts.boardId,
    workspaceDir: opts.workspaceDir,
    tiles: frames.map(function(f) {
      return {
        page_url: f.page_url || f.url, element: f.element || f.title, section: f.section || f.surface,
        image_path: f.image_path, image_url: f.image_url || f.url,
        steal: f.steal, refuse: f.refuse, peak: f.peak, tokens: f.tokens,
      };
    }),
  });
}

function getBoard(opts) {
  opts = opts || {};
  var projectId = opts.project || session.getProjectId();
  var boardId = opts.boardId;
  if (!boardId) throw new Error('board is required');
  var board = loadJson(path.join(boardDir(projectId, boardId), 'board.json'));
  if (!board) throw new Error('Board not found: ' + boardId);
  return board;
}

// Persona votes are stored per tile as advice. Zara may not vote on tiles she
// scouted, and no persona vote can change a tile the user has decided.
function recordPersonaVotes(opts) {
  opts = opts || {};
  var board = loadUiBoard(opts);
  var votes = opts.votes || [];
  var ignored = [];
  for (var i = 0; i < votes.length; i++) {
    var v = votes[i] || {};
    var persona = String(v.persona || '').toLowerCase();
    var vote = String(v.vote || '').toLowerCase();
    var tile = findTile(board, v.tile);
    if (!tile) { ignored.push({ tile: v.tile, reason: 'unknown tile' }); continue; }
    if (JURY.indexOf(persona) === -1) { ignored.push({ tile: v.tile, persona: persona, reason: 'not on the jury' }); continue; }
    if (vote !== 'keep' && vote !== 'skip') { ignored.push({ tile: v.tile, reason: 'vote must be keep or skip' }); continue; }
    tile.votes[persona] = { vote: vote, because: clip(v.because, 240), at: new Date().toISOString() };
  }
  var synthesis = { verdict: String(opts.verdict || '').toUpperCase(), summary: clip(opts.summary, 1000), top3: opts.top3 || [] };
  applyJuryOutcome(board, synthesis);
  board.synthesis = synthesis;
  var saved = persistBoard(board, opts.workspaceDir);
  saved.ignored = ignored;
  return saved;
}

function recordJuryVerdict(opts) {
  return recordPersonaVotes(opts);
}

// The user's choice on a tile is final. It is written to an append-only
// ledger, and a rejection blocks that element from ever being re-added.
function recordUserDecision(opts) {
  opts = opts || {};
  var board = loadUiBoard(opts);
  var tile = findTile(board, opts.tile);
  if (!tile) throw new Error('Tile not found: ' + opts.tile);
  var decision = String(opts.decision || '').toLowerCase();
  if (decision !== 'clear' && USER_DECISIONS.indexOf(decision) === -1) {
    throw new Error('Decision must be keep, reject, maybe, or clear.');
  }
  var key = tileKey(tile.page_url, tile.element);
  var now = new Date().toISOString();
  tile.user = decision === 'clear' ? null : { decision: decision, note: clip(opts.note, 500), at: now };
  board.blocked = board.blocked.filter(function(k) { return k !== key; });
  if (decision === 'reject') board.blocked.push(key);
  board.decisions.push({ tile_id: tile.id, n: tile.n, decision: decision, note: clip(opts.note, 500), at: now, by: 'user' });
  return persistBoard(board, opts.workspaceDir);
}

// User-requested rounds have no cap. Zara gets the user's notes, keeps and
// rejections as the top constraints.
function requestRescout(opts) {
  opts = opts || {};
  var board = loadUiBoard(opts);
  board.scout = board.scout || { persona: 'zara', round: 1 };
  board.scout.round = (board.scout.round || 1) + 1;
  board.scout.status = 'awaiting_scout';
  board.scout.user_note = clip(opts.note, 500);
  board.scout.brief = defaultScoutBrief(board.task, board.scout.round, scoutConstraints(board, opts.note));
  board.decisions.push({ decision: 'rescout', note: clip(opts.note, 500), at: new Date().toISOString(), by: 'user' });
  return persistBoard(board, opts.workspaceDir);
}

// Locking writes the user's direction into the session so every persona
// reads it before designing.
function lockDirection(opts) {
  opts = opts || {};
  var board = loadUiBoard(opts);
  var dir = computeDirection(board);
  if (!dir.kept.length) throw new Error('Keep at least one tile before locking the direction.');
  var now = new Date().toISOString();
  board.direction = dir;
  board.direction.locked_at = now;
  board.direction.note = clip(opts.note, 500);
  board.scout = board.scout || {};
  board.scout.status = 'done';
  board.decisions.push({ decision: 'lock', note: clip(opts.note, 500), at: now, by: 'user' });
  var saved = persistBoard(board, opts.workspaceDir);
  try {
    session.update({
      project: board.project_id,
      patch: {
        design_direction: {
          board_id: board.board_id,
          task: board.task,
          locked_at: now,
          locked_by: 'user',
          rule: 'User-locked mood board. Outranks every persona opinion. Do not reintroduce rejected elements.',
          adjectives: board.brief.adjectives,
          not_this: board.brief.not_this,
          note: board.direction.note,
          palette: dir.palette,
          fonts: dir.fonts,
          kept: dir.kept,
          rejected: dir.rejected,
        },
      },
    });
  } catch (e) {
    saved.sessionError = e.message;
  }
  return saved;
}

function setBrief(opts) {
  opts = opts || {};
  var board = loadUiBoard(opts);
  var next = defaultBrief(board.task, {
    job: opts.job || board.brief.job,
    adjectives: opts.adjectives || board.brief.adjectives,
    not_this: opts.not_this != null ? opts.not_this : board.brief.not_this,
    sections: opts.sections || board.brief.sections,
    confirmed_by_user: opts.confirmed_by_user != null ? opts.confirmed_by_user : board.brief.confirmed_by_user,
  });
  board.brief = next;
  if (board.scout) {
    board.scout.brief = defaultScoutBrief(board.task, board.scout.round || 1, scoutConstraints(board, board.scout.user_note));
  }
  return persistBoard(board, opts.workspaceDir);
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

// ─── Token capture script (run in the page via CDP Runtime.evaluate) ─────────

// Reads the element's real computed styles plus its children's, so the board
// shows the site's actual colours and fonts instead of guesses.
// `text` narrows the match to the first element whose visible text contains
// it, because a bare `h1` often hits the logo instead of the headline.
function captureScript(selector, text) {
  var sel = JSON.stringify(String(selector || 'body'));
  var txt = JSON.stringify(String(text || '').toLowerCase());
  return [
    '(function () {',
    '  var all = Array.prototype.slice.call(document.querySelectorAll(' + sel + '));',
    '  function area(el) { var r = el.getBoundingClientRect(); return r.width * r.height; }',
    '  var hits = all.filter(function (el) { return area(el) > 0 && (!' + txt + ' || el.textContent.toLowerCase().indexOf(' + txt + ') !== -1); });',
    '  var root = ' + txt + ' ? hits.sort(function (a, b) { return area(a) - area(b); })[0] : hits[0];',
    '  if (!root) return { error: "No visible element matches " + ' + sel + ' + (' + txt + ' ? " with text " + ' + txt + ' : "") };',
    '  function hex(c) {',
    '    var m = String(c).match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?/);',
    '    if (!m || m[4] === "0") return null;',
    '    return "#" + [m[1], m[2], m[3]].map(function (n) { return ("0" + parseInt(n, 10).toString(16)).slice(-2); }).join("");',
    '  }',
    '  var counts = {}, fonts = [];',
    '  var nodes = [root].concat(Array.prototype.slice.call(root.querySelectorAll("*"), 0, 300));',
    '  nodes.forEach(function (el) {',
    '    var s = getComputedStyle(el);',
    '    [s.color, s.backgroundColor, s.borderTopColor].forEach(function (c) { var h = hex(c); if (h) counts[h] = (counts[h] || 0) + 1; });',
    '    var f = s.fontFamily.split(",")[0].replace(/["\']/g, "").trim();',
    '    if (f && fonts.indexOf(f) === -1) fonts.push(f);',
    '  });',
    // Capturing off-screen areas repeats content, so bring the element into
    // view and keep the crop within one viewport.
    '  root.scrollIntoView({ block: "start" });',
    '  var rs = getComputedStyle(root), r = root.getBoundingClientRect(), pad = 8;',
    '  return {',
    '    colors: Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; }).slice(0, 8),',
    '    fonts: fonts.slice(0, 4),',
    '    radius: rs.borderRadius,',
    '    spacing: rs.padding,',
    '    font_size: rs.fontSize,',
    '    size: Math.round(r.width) + "x" + Math.round(r.height),',
    '    clip: { x: Math.max(0, r.left + scrollX - pad), y: Math.max(0, r.top + scrollY - pad), width: Math.ceil(r.width + pad * 2), height: Math.min(innerHeight, Math.ceil(r.height + pad * 2)), scale: 1 }',
    '  };',
    '})()',
  ].join('\n');
}

module.exports = {
  buildMoodBoard: buildMoodBoard,
  critiqueMoodBoard: critiqueMoodBoard,
  addUserReferenceAndRerun: addUserReferenceAndRerun,
  addFrames: addFrames,
  addTiles: addTiles,
  getBoard: getBoard,
  loadUiBoard: loadUiBoard,
  recordJuryVerdict: recordJuryVerdict,
  recordPersonaVotes: recordPersonaVotes,
  recordUserDecision: recordUserDecision,
  requestRescout: requestRescout,
  lockDirection: lockDirection,
  setBrief: setBrief,
  computeDirection: computeDirection,
  tileStatus: tileStatus,
  juryPrompt: juryPrompt,
  captureScript: captureScript,
  SECTIONS: SECTIONS,
  TILE_TARGET: TILE_TARGET,
  defaultScoutBrief: defaultScoutBrief,
  listBoards: listBoards,
  boardDir: boardDir,
  formatDsPack: formatDsPack,
  tagHeuristics: tagHeuristics,
};
