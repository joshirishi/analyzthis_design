#!/usr/bin/env node
'use strict';

/**
 * Kavi — Collect Knowledge (v1.11)
 *
 * Scans the current codebase, writes an Obsidian-compatible vault, optionally
 * LLM-enriches notes, then auto-connects + syncs into the knowledge bank so
 * all critique personas read company context first.
 *
 * Usage (via CLI):
 *   npx analyzthis_design collect [--vault path] [--dry-run] [--no-enrich] [--limit N] [--target cursor|all]
 */

const fs     = require('fs');
const path   = require('path');
const os     = require('os');
const crypto = require('crypto');
const session  = require('./session');
const knowledge = require('./knowledge');
const cache    = require('./cache');
const research = require('./research');
const {
  discoverKnowledgeSources,
  writeSourceManifestNotes,
  connectDiscoveredSources,
} = require('./source-discovery');

const { resolvePackageRoot } = require('./platforms');
const PACKAGE_ROOT = resolvePackageRoot(__dirname);

const HARD_EXCLUDES = new Set([
  'node_modules', 'dist', 'build', '.next', '.nuxt', 'coverage', '.git',
  '.turbo', '.vercel', '.cache', 'out', '.analyzthis_design', 'vendor',
  '__pycache__', '.venv', 'venv', 'target',
]);

const MAX_FILE_BYTES = 200_000;
const MAX_EXTRACT_LINES = 40;
const BATCH_SIZE = 6;
const DEFAULT_WEB_LIMIT = 10;
const WEB_SOURCE_FOLDERS = new Set(['PRDs', 'Product', 'Research', 'Design']);
const URL_RE = /https?:\/\/[^\s)'">\]`]+/gi;

function loadCollectConfig() {
  const configPath = path.join(os.homedir(), '.analyzthis_design', 'config.json');
  if (!fs.existsSync(configPath)) return {};
  try { return JSON.parse(fs.readFileSync(configPath, 'utf8')); }
  catch { return {}; }
}

function normalizeUrl(url) {
  return String(url)
    .replace(/^[`'"]+|[`'"]+$/g, '')
    .replace(/[.,;:!?)]+$/g, '');
}

function isResearchableUrl(url) {
  if (!url || url.length < 12) return false;
  if (/[{}]/.test(url)) return false;
  try {
    const u = new URL(url);
    if (!['http:', 'https:'].includes(u.protocol)) return false;
    const host = u.hostname.toLowerCase();
    if (!host.includes('.')) return false;
    if (host === 'localhost' || host.startsWith('127.') || host === '0.0.0.0') return false;
    const pathname = u.pathname.toLowerCase();
    if (/\.(png|jpe?g|gif|svg|ico|webp|woff2?|ttf|eot|css|js|map|zip|tar|gz|pdf)$/i.test(pathname)) return false;
    if (host === 'www.npmjs.com' || host === 'npmjs.com') return false;
    if (host === 'example.com' || host === 'www.example.com') return false;
    if (host === 'github.com' && /\/(blob|raw|tree)\//.test(u.pathname)) return false;
    return true;
  } catch {
    return false;
  }
}

function extractUrlsFromText(text) {
  const found = String(text).match(URL_RE) || [];
  return found.map(normalizeUrl).filter(isResearchableUrl);
}

/**
 * Discover external URLs from config + markdown in PRDs/Product/Research/Design/README.
 */
function discoverWebUrls({ cwd, notes, config, webLimit }) {
  const collectCfg = config.collect || {};
  const limit = webLimit ?? collectCfg.web_limit ?? DEFAULT_WEB_LIMIT;
  const seen = new Set();
  const urls = [];

  const add = (url, source) => {
    const u = normalizeUrl(url);
    if (!isResearchableUrl(u) || seen.has(u)) return;
    seen.add(u);
    urls.push({ url: u, source });
  };

  for (const u of [...(collectCfg.web_urls || []), ...(config.research?.urls || [])]) {
    add(u, 'config');
  }

  if (collectCfg.web_from_repo !== false) {
    const readme = path.join(cwd, 'README.md');
    if (fs.existsSync(readme)) {
      try {
        for (const u of extractUrlsFromText(fs.readFileSync(readme, 'utf8'))) add(u, 'README.md');
      } catch { /* ignore */ }
    }
    for (const note of notes) {
      if (!WEB_SOURCE_FOLDERS.has(note.classifier.folder)) continue;
      const full = path.join(cwd, note.sourceRel);
      try {
        for (const u of extractUrlsFromText(fs.readFileSync(full, 'utf8'))) add(u, note.sourceRel);
      } catch { /* ignore */ }
    }
  }

  const queries = collectCfg.web_queries || config.research?.queries || [];
  return { urls: urls.slice(0, limit), queries: queries.slice(0, limit), limit, totalDiscovered: urls.length };
}

/**
 * Fetch discovered URLs (and optional query stubs) into session web-context.md.
 */
async function collectWebResearch({ urls, queries, projectId, dryRun }) {
  const results = { fetched: [], failed: [], queries: [], dryRun: !!dryRun };
  if (dryRun) {
    results.urls = urls;
    return results;
  }

  for (const { url, source } of urls) {
    try {
      console.log(`   • ${url}  (from ${source})`);
      const r = await research.researchUrl({ url, project: projectId });
      results.fetched.push({ url, source, chars: r.chars });
    } catch (err) {
      results.failed.push({ url, source, error: err.message });
      console.log(`     ⚠  ${err.message}`);
    }
  }

  for (const query of queries) {
    try {
      console.log(`   • query: "${query}"`);
      const r = await research.researchQuery({ query, project: projectId });
      results.queries.push({ query, mode: r.mode, chars: r.chars });
    } catch (err) {
      results.failed.push({ query, error: err.message });
      console.log(`     ⚠  ${err.message}`);
    }
  }

  return results;
}

// ─── Classification rules (source → vault folder + category) ─────────────────

const CLASSIFIERS = [
  {
    folder: 'PRDs',
    category: 'prd',
    tags: ['prd'],
    match: (rel, base) =>
      /^(readme|contributing|changelog)\.md$/i.test(base) ||
      /\b(prd|requirements|user[-_]?stor|acceptance|epic|jtbd)\b/i.test(rel) ||
      /^docs\//i.test(rel) && /\.md$/i.test(base),
  },
  {
    folder: 'Brand',
    category: 'brand',
    tags: ['brand', 'design'],
    match: (rel, base) =>
      /tailwind\.config\./i.test(base) ||
      /^(globals|global|tokens|theme|variables)\.(css|scss|ts|js)$/i.test(base) ||
      /design[-_]?system|brand|tokens?\./i.test(rel) ||
      /\.css$/i.test(base) && /(theme|token|color|brand)/i.test(rel),
  },
  {
    folder: 'Product',
    category: 'product',
    tags: ['product'],
    match: (rel) => /\b(roadmap|vision|product|okr|kpi|north[-_]?star)\b/i.test(rel) && /\.md$/i.test(rel),
  },
  {
    folder: 'Research',
    category: 'research',
    tags: ['research'],
    match: (rel) => /\b(research|interview|survey|insight|persona|usability)\b/i.test(rel) && /\.md$/i.test(rel),
  },
  {
    folder: 'Pages',
    category: 'design',
    tags: ['design', 'page'],
    match: (rel, base) =>
      /(^|\/)(app|pages|src\/pages)\//i.test(rel) &&
      (/page\.(tsx|jsx|ts|js|vue|svelte)$/i.test(base) || /^index\.(tsx|jsx|ts|js)$/i.test(base)),
  },
  {
    folder: 'Components',
    category: 'design',
    tags: ['design', 'component'],
    match: (rel, base) =>
      /(^|\/)(components|src\/ui|src\/components|ui)\//i.test(rel) &&
      /\.(tsx|jsx|vue|svelte)$/i.test(base) &&
      !/\.(test|spec|stories)\./i.test(base),
  },
  {
    folder: 'Design',
    category: 'design',
    tags: ['design'],
    match: (rel, base) =>
      /\.md$/i.test(base) && /\b(design|figma|wireframe|layout|ux|ui)\b/i.test(rel),
  },
  {
    folder: 'Tech',
    category: 'tech',
    tags: ['tech'],
    match: (rel, base) =>
      base === 'package.json' ||
      /^(tsconfig|next\.config|vite\.config|astro\.config|nuxt\.config)/i.test(base) ||
      /(^|\/)(api|app\/api|pages\/api|server)\//i.test(rel) && /\.(ts|js)$/i.test(base),
  },
];

// ─── Ignore helpers ──────────────────────────────────────────────────────────

function loadGitignore(cwd) {
  const patterns = [];
  const gi = path.join(cwd, '.gitignore');
  if (!fs.existsSync(gi)) return patterns;
  for (const line of fs.readFileSync(gi, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#') || t.startsWith('!')) continue;
    patterns.push(t.replace(/\/$/, ''));
  }
  return patterns;
}

function isIgnored(rel, gitPatterns) {
  const parts = rel.split(path.sep);
  if (parts.some((p) => HARD_EXCLUDES.has(p) || p.startsWith('.'))) {
    // Allow .md under docs that aren't hidden dirs; still block .git etc.
    if (parts.some((p) => HARD_EXCLUDES.has(p))) return true;
    // Dotfiles at root of scan (e.g. .env) — skip
    if (parts.some((p) => p.startsWith('.') && p !== '.')) return true;
  }
  for (const pat of gitPatterns) {
    const clean = pat.replace(/^\*\*\//, '').replace(/\*\*/g, '');
    if (!clean) continue;
    if (rel === pat || rel.startsWith(pat + path.sep) || rel.includes(path.sep + pat + path.sep)) return true;
    if (pat.endsWith('*') && rel.startsWith(pat.slice(0, -1))) return true;
    // Simple glob: *.log
    if (pat.startsWith('*.') && rel.endsWith(pat.slice(1))) return true;
  }
  return false;
}

function walkFiles(cwd, gitPatterns, out = []) {
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(cwd, full);
      if (isIgnored(rel, gitPatterns)) continue;
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.push({ full, rel, base: entry.name });
    }
  };
  walk(cwd);
  return out;
}

// ─── Extract helpers ─────────────────────────────────────────────────────────

function sha1(text) {
  return crypto.createHash('sha1').update(text).digest('hex').slice(0, 12);
}

function slugify(name) {
  return String(name)
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'note';
}

function extractSnippet(fullPath) {
  let raw = '';
  try {
    const stat = fs.statSync(fullPath);
    if (stat.size > MAX_FILE_BYTES) {
      raw = fs.readFileSync(fullPath, 'utf8').slice(0, MAX_FILE_BYTES);
    } else {
      raw = fs.readFileSync(fullPath, 'utf8');
    }
  } catch {
    return { lines: [], imports: [], exports: [], figma: [] };
  }
  const lines = raw.split('\n').slice(0, MAX_EXTRACT_LINES);
  const imports = [];
  const exports = [];
  const figma = [];
  for (const line of raw.split('\n').slice(0, 200)) {
    const imp = line.match(/from\s+['"]([^'"]+)['"]/);
    if (imp) imports.push(imp[1]);
    if (/^export\s+(default\s+)?(function|const|class|async)/.test(line.trim()) ||
        /^export\s*\{/.test(line.trim())) {
      exports.push(line.trim().slice(0, 120));
    }
    const fig = line.match(/https?:\/\/(?:www\.)?figma\.com\/[^\s)'"]+/gi);
    if (fig) figma.push(...fig);
  }
  return { lines, imports: [...new Set(imports)].slice(0, 20), exports: exports.slice(0, 15), figma: [...new Set(figma)].slice(0, 5) };
}

function classifyFile(rel, base) {
  for (const c of CLASSIFIERS) {
    if (c.match(rel, base)) return c;
  }
  return null;
}

function frontmatter(meta) {
  const lines = ['---'];
  for (const [k, v] of Object.entries(meta)) {
    if (Array.isArray(v)) lines.push(`${k}: [${v.map((x) => JSON.stringify(x)).join(', ')}]`);
    else if (typeof v === 'boolean') lines.push(`${k}: ${v}`);
    else lines.push(`${k}: ${JSON.stringify(String(v))}`);
  }
  lines.push('---');
  return lines.join('\n');
}

function buildDraftNote({ title, rel, classifier, extract, related }) {
  const date = new Date().toISOString().split('T')[0];
  const contentHash = sha1(extract.lines.join('\n'));
  const fm = frontmatter({
    title,
    tags: classifier.tags,
    source: rel,
    category: classifier.category,
    collected_at: date,
    content_hash: contentHash,
    enriched: false,
  });
  const relatedBlock = related.length
    ? related.map((r) => `- [[${r}]]`).join('\n')
    : '- _(none yet)_';
  const body = [
    '## Purpose',
    `Draft extract from \`${rel}\`. Awaiting Kavi enrichment.`,
    '',
    '## Raw extract',
    '```',
    extract.lines.join('\n').slice(0, 3000),
    '```',
    '',
    '## Exports',
    extract.exports.length ? extract.exports.map((e) => `- \`${e}\``).join('\n') : '- _(none detected)_',
    '',
    '## Imports',
    extract.imports.length ? extract.imports.map((i) => `- \`${i}\``).join('\n') : '- _(none detected)_',
    '',
    ...(extract.figma.length ? ['## Figma links', ...extract.figma.map((u) => `- ${u}`), ''] : []),
    '## Related',
    relatedBlock,
    '',
  ].join('\n');
  return { fm, body, contentHash };
}

// ─── Scan → draft vault ──────────────────────────────────────────────────────

function scanAndDraft({ cwd, vaultPath, dryRun }) {
  const gitPatterns = loadGitignore(cwd);
  const files = walkFiles(cwd, gitPatterns);
  const notes = []; // { vaultRel, fullOut, title, classifier, contentHash, draft }

  // First pass: classify + extract
  const candidates = [];
  for (const f of files) {
    const classifier = classifyFile(f.rel, f.base);
    if (!classifier) continue;
    const extract = extractSnippet(f.full);
    const title = slugify(f.base);
    candidates.push({ ...f, classifier, extract, title });
  }

  // Build simple related links: Components ↔ Pages by shared basename / import
  const pageTitles = candidates.filter((c) => c.classifier.folder === 'Pages').map((c) => `Pages/${c.title}`);
  const componentTitles = candidates.filter((c) => c.classifier.folder === 'Components').map((c) => `Components/${c.title}`);

  for (const c of candidates) {
    let related = [];
    if (c.classifier.folder === 'Components') {
      related = pageTitles.filter((p) => {
        const pageName = p.split('/')[1].toLowerCase();
        return c.extract.imports.some((i) => i.toLowerCase().includes(c.title.toLowerCase())) ||
          pageName.includes(c.title.toLowerCase().slice(0, 6));
      }).slice(0, 5);
    } else if (c.classifier.folder === 'Pages') {
      related = componentTitles.filter((comp) => {
        const name = comp.split('/')[1].toLowerCase();
        return c.extract.imports.some((i) => i.toLowerCase().includes(name));
      }).slice(0, 8);
    }

    const { fm, body, contentHash } = buildDraftNote({
      title: c.title,
      rel: c.rel,
      classifier: c.classifier,
      extract: c.extract,
      related,
    });

    // Disambiguate colliding titles within a folder
    let vaultRel = path.join(c.classifier.folder, `${c.title}.md`);
    let n = 2;
    while (notes.some((x) => x.vaultRel === vaultRel)) {
      vaultRel = path.join(c.classifier.folder, `${c.title}-${n}.md`);
      n += 1;
    }

    notes.push({
      vaultRel,
      fullOut: path.join(vaultPath, vaultRel),
      title: c.title,
      classifier: c.classifier,
      contentHash,
      draft: `${fm}\n\n${body}`,
      sourceRel: c.rel,
    });
  }

  if (!dryRun) {
    fs.mkdirSync(vaultPath, { recursive: true });
    for (const note of notes) {
      // Hash-based skip: if existing note has same content_hash, keep enriched body
      if (fs.existsSync(note.fullOut)) {
        try {
          const existing = fs.readFileSync(note.fullOut, 'utf8');
          const m = existing.match(/content_hash:\s*"?([a-f0-9]+)"?/);
          const enriched = /enriched:\s*true/.test(existing);
          if (m && m[1] === note.contentHash && enriched) {
            note.skipped = true;
            note.draft = existing; // keep previous enriched version
            continue;
          }
        } catch { /* rewrite */ }
      }
      fs.mkdirSync(path.dirname(note.fullOut), { recursive: true });
      fs.writeFileSync(note.fullOut, note.draft);
    }
    writeMeta(vaultPath, notes, cwd);
  }

  return {
    filesScanned: files.length,
    notesWritten: notes.filter((n) => !n.skipped).length,
    notesSkipped: notes.filter((n) => n.skipped).length,
    notes,
  };
}

function writeMeta(vaultPath, notes, cwd) {
  const byFolder = {};
  for (const n of notes) {
    const folder = n.classifier.folder;
    if (!byFolder[folder]) byFolder[folder] = [];
    byFolder[folder].push(n);
  }

  const indexLines = [
    '---',
    'title: "Knowledge Vault Index"',
    'tags: [meta, moc]',
    `collected_at: "${new Date().toISOString().split('T')[0]}"`,
    '---',
    '',
    '# Knowledge Vault Index',
    '',
    `Source repo: \`${cwd}\``,
    '',
    '## Map of content',
    '',
  ];
  for (const [folder, list] of Object.entries(byFolder).sort()) {
    indexLines.push(`### ${folder}`, '');
    for (const n of list) {
      const link = n.vaultRel.replace(/\.md$/, '').replace(/\\/g, '/');
      indexLines.push(`- [[${link}|${n.title}]] — \`${n.sourceRel}\``);
    }
    indexLines.push('');
  }
  fs.mkdirSync(path.join(vaultPath, '_meta'), { recursive: true });
  fs.writeFileSync(path.join(vaultPath, '_meta', 'index.md'), indexLines.join('\n'));
  fs.writeFileSync(path.join(vaultPath, '_meta', 'last-sync.md'), [
    '---',
    'title: "Last sync"',
    '---',
    '',
    `# Last sync`,
    '',
    `- **When:** ${new Date().toISOString()}`,
    `- **Repo:** ${cwd}`,
    `- **Notes:** ${notes.length}`,
    '',
  ].join('\n'));
}

// ─── LLM enrichment ──────────────────────────────────────────────────────────

function loadKaviCard() {
  const p = path.join(PACKAGE_ROOT, 'agents', 'cards', 'kavi.md');
  if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  return 'You are Kavi, the Knowledge Archivist. Rewrite draft extracts into concise Obsidian notes. Do not invent files or APIs.';
}

function hasAnyApiKey() {
  return !!(
    process.env.ANTHROPIC_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.ZAI_API_KEY ||
    process.env.ZHIPU_API_KEY
  );
}

function pickEnrichProvider(config) {
  // Prefer cheap structured tier: openai mini → google flash → anthropic → zai
  if (process.env.OPENAI_API_KEY) return { provider: 'openai', model: config.orchestrator?.tiers?.structured?.model || 'gpt-4o-mini' };
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) return { provider: 'google', model: 'gemini-2.5-flash' };
  if (process.env.ZAI_API_KEY || process.env.ZHIPU_API_KEY) return { provider: 'zai', model: 'glm-4.5-flash' };
  if (process.env.ANTHROPIC_API_KEY) return { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' };
  return null;
}

function parseEnrichedBatch(text, count) {
  // Expect notes separated by ---NOTE N--- markers; fall back to whole text for single note
  const parts = text.split(/---NOTE\s+\d+---/i).map((s) => s.trim()).filter(Boolean);
  if (parts.length >= count) return parts.slice(0, count);
  if (parts.length === 1 && count === 1) return parts;
  // Uneven response — pad with nulls so we keep drafts for missing ones
  while (parts.length < count) parts.push(null);
  return parts.slice(0, count);
}

async function enrichNotes({ notes, limit, provider, model }) {
  const { callLlm, loadConfig } = require('./orchestrator/run');
  const config = loadConfig();
  const chosen = provider && model
    ? { provider, model }
    : pickEnrichProvider(config);
  if (!chosen) {
    return { enriched: 0, skipped: notes.length, reason: 'No API key set — wrote draft-only vault.', llm_calls: 0, input_tokens_est: 0, output_tokens_est: 0 };
  }

  const toEnrich = notes.filter((n) => !n.skipped).slice(0, limit == null ? notes.length : limit);
  const system = [
    loadKaviCard(),
    '',
    'For each draft note below, rewrite ONLY the body (keep the YAML frontmatter I give you).',
    'Output format: for each note, emit exactly:',
    '---NOTE 1---',
    '<full markdown including the original frontmatter with enriched: true>',
    '---NOTE 2---',
    '...',
    'Rules: purpose + key facts + Related wikilinks. Do NOT invent files, APIs, or components not in the Raw extract.',
  ].join('\n');

  let enriched = 0;
  let llmCalls = 0;
  let inTok = 0;
  let outTok = 0;

  for (let i = 0; i < toEnrich.length; i += BATCH_SIZE) {
    const batch = toEnrich.slice(i, i + BATCH_SIZE);
    const user = batch.map((n, idx) => `---NOTE ${idx + 1}---\n${n.draft}`).join('\n\n');
    const text = await callLlm({
      provider: chosen.provider,
      model: chosen.model,
      system,
      user,
      maxTokens: 4000,
    });
    llmCalls += 1;
    inTok += Math.ceil((system.length + user.length) / 4);
    outTok += Math.ceil(text.length / 4);

    const parts = parseEnrichedBatch(text, batch.length);
    for (let j = 0; j < batch.length; j++) {
      let body = parts[j];
      if (!body) continue;
      // Ensure enriched: true in frontmatter
      if (!/enriched:\s*true/.test(body)) {
        body = body.replace(/enriched:\s*false/, 'enriched: true');
        if (!/enriched:/.test(body) && body.startsWith('---')) {
          body = body.replace(/^---\n/, '---\nenriched: true\n');
        }
      }
      // Preserve content_hash from draft
      if (!/content_hash:/.test(body) && batch[j].contentHash) {
        body = body.replace(/^---\n/, `---\ncontent_hash: "${batch[j].contentHash}"\n`);
      }
      fs.writeFileSync(batch[j].fullOut, body);
      batch[j].draft = body;
      enriched += 1;
    }
  }

  return {
    enriched,
    skipped: notes.length - enriched,
    reason: null,
    llm_calls: llmCalls,
    input_tokens_est: inTok,
    output_tokens_est: outTok,
    provider: chosen.provider,
    model: chosen.model,
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * @param {{
 *   cwd?: string,
 *   vault?: string,
 *   project?: string,
 *   dryRun?: boolean,
 *   enrich?: boolean,
 *   limit?: number,
 *   target?: string,
 *   provider?: string,
 *   model?: string,
 *   web?: boolean,
 *   webLimit?: number,
 * }} opts
 */
async function collect(opts = {}) {
  const cwd = path.resolve(opts.cwd || process.cwd());
  const projectId = opts.project || session.getProjectId(cwd);
  const vaultPath = path.resolve(opts.vault || path.join(os.homedir(), '.analyzthis_design', 'vaults', projectId));
  const enrich = opts.enrich !== false;
  const dryRun = !!opts.dryRun;
  const limit = opts.limit != null ? opts.limit : null;
  const fetchWeb = opts.web !== false;
  const discoverSources = opts.discoverSources !== false;
  const config = loadCollectConfig();
  const { resolveTargets } = require('./platforms');
  const targets = resolveTargets(opts.target || 'cursor') || ['cursor'];

  // Ensure session exists
  if (!session.show({ project: projectId })) {
    session.init({ project: projectId });
  }

  const modeParts = [];
  if (dryRun) modeParts.push('dry-run');
  else {
    if (discoverSources) modeParts.push('discover');
    if (fetchWeb) modeParts.push('web');
    if (enrich) modeParts.push('enrich');
    modeParts.push('sync');
  }

  console.log(`\n📚 Kavi — Collect Knowledge`);
  console.log(`   Repo:  ${cwd}`);
  console.log(`   Vault: ${vaultPath}`);
  console.log(`   Mode:  ${modeParts.join(' + ') || 'scan'}\n`);

  const scan = scanAndDraft({ cwd, vaultPath, dryRun });

  const sourceDiscoveries = discoverSources
    ? discoverKnowledgeSources({ cwd, config })
    : [];

  console.log(`   Scanned ${scan.filesScanned} file(s) → ${scan.notes.length} note(s) (${scan.notesWritten} written, ${scan.notesSkipped} unchanged)`);

  if (discoverSources && sourceDiscoveries.length > 0) {
    console.log(`\n🔍 Knowledge sources: ${sourceDiscoveries.length} discovered (Obsidian vaults, wikis, referenced paths)`);
    for (const d of sourceDiscoveries.slice(0, 6)) {
      console.log(`   • [${d.confidence}] ${d.type}: ${d.path}`);
    }
    if (sourceDiscoveries.length > 6) console.log(`   … and ${sourceDiscoveries.length - 6} more`);
  } else if (discoverSources && !dryRun) {
    console.log(`\n🔍 Knowledge sources: none discovered (add collect.source_paths in config or link vaults in README)`);
  }

  const webPlan = fetchWeb
    ? discoverWebUrls({ cwd, notes: scan.notes, config, webLimit: opts.webLimit })
    : { urls: [], queries: [], limit: 0, totalDiscovered: 0 };

  if (fetchWeb && (webPlan.urls.length > 0 || webPlan.queries.length > 0)) {
    console.log(`\n🌐 Web research: ${webPlan.urls.length} URL(s)${webPlan.queries.length ? `, ${webPlan.queries.length} query stub(s)` : ''}${webPlan.totalDiscovered > webPlan.urls.length ? ` (${webPlan.totalDiscovered} found, capped at ${webPlan.limit})` : ''}`);
  } else if (fetchWeb && !dryRun) {
    console.log(`\n🌐 Web research: no URLs found (add collect.web_urls in ~/.analyzthis_design/config.json or links in PRDs/README)`);
  }

  if (dryRun) {
    const byFolder = {};
    for (const n of scan.notes) {
      byFolder[n.classifier.folder] = (byFolder[n.classifier.folder] || 0) + 1;
    }
    console.log('\n── Dry run preview ──');
    console.log(JSON.stringify({
      vaultPath,
      projectId,
      byFolder,
      knowledgeSources: sourceDiscoveries.map((d) => ({
        path: d.path,
        type: d.type,
        confidence: d.confidence,
        discovered_from: d.discovered_from,
        markdown_files: d.stats.markdown_files,
      })),
      webUrls: webPlan.urls.map((u) => ({ url: u.url, source: u.source })),
      webQueries: webPlan.queries,
      sample: scan.notes.slice(0, 8).map((n) => n.vaultRel),
    }, null, 2));
    console.log('');
    return { vaultPath, projectId, dryRun: true, ...scan, sources: sourceDiscoveries, web: webPlan, enrich: null, sync: null };
  }

  let sourceManifest = { written: [] };
  if (discoverSources && sourceDiscoveries.length > 0) {
    console.log(`\n⏳ Writing source manifest notes (Sources/*.md)...`);
    sourceManifest = writeSourceManifestNotes({
      discoveries: sourceDiscoveries,
      vaultPath,
      dryRun: false,
    });
    console.log(`   Wrote ${sourceManifest.written.length} manifest note(s) + _meta/knowledge-sources.md`);
  }

  let webResult = { fetched: [], failed: [], queries: [] };
  if (fetchWeb && (webPlan.urls.length > 0 || webPlan.queries.length > 0)) {
    console.log(`\n⏳ Fetching web research into web-context.md...`);
    webResult = await collectWebResearch({
      urls: webPlan.urls,
      queries: webPlan.queries,
      projectId,
      dryRun: false,
    });
    console.log(`   Fetched ${webResult.fetched.length} URL(s)${webResult.failed.length ? `, ${webResult.failed.length} failed` : ''}`);
  }

  let enrichResult = { enriched: 0, skipped: scan.notes.length, reason: 'enrichment disabled', llm_calls: 0, input_tokens_est: 0, output_tokens_est: 0 };
  if (enrich) {
    if (!hasAnyApiKey()) {
      console.log(`\n  ⚠  No LLM API key found — writing draft-only vault. Set OPENAI_API_KEY / GEMINI_API_KEY / ANTHROPIC_API_KEY / ZAI_API_KEY to enrich.`);
      enrichResult.reason = 'No API key set — wrote draft-only vault.';
    } else {
      console.log(`\n⏳ Enriching notes with Kavi (LLM)...`);
      enrichResult = await enrichNotes({
        notes: scan.notes,
        limit,
        provider: opts.provider,
        model: opts.model,
      });
      console.log(`   Enriched ${enrichResult.enriched} note(s)${enrichResult.reason ? ` (${enrichResult.reason})` : ''}`);
    }
  }

  // Auto-connect discovered sources + Kavi vault, then sync knowledge bank
  console.log(`\n⏳ Wiring knowledge bank...`);
  const connectResult = discoverSources
    ? connectDiscoveredSources({
      discoveries: sourceDiscoveries,
      kaviVaultPath: vaultPath,
      config,
      autoConnect: config.collect?.auto_connect_discovered !== false,
    })
    : { connected: [], skipped: [] };
  if (connectResult.connected.length > 0) {
    console.log(`   Auto-connected ${connectResult.connected.length} source(s):`);
    for (const p of connectResult.connected) console.log(`   • ${p}`);
  }
  knowledge.connect({ vaultPath, tags: [], include: [] });
  const syncResult = knowledge.sync({ targets });
  cache.invalidatePrefix('kb:');

  if (syncResult.message) {
    console.log(`  ⚠  ${syncResult.message}`);
  } else {
    console.log(`✅ Synced ${syncResult.synced} note(s) into the knowledge bank.`);
    for (const t of syncResult.copiedTo || []) console.log(`   • ${t}`);
  }

  // Persist session fields
  const state = session.show({ project: projectId }) || {};
  const sources = Array.isArray(state.content_sources) ? state.content_sources : [];
  if (!sources.includes('codebase_collect')) sources.push('codebase_collect');
  session.update({
    project: projectId,
    patch: {
      content_sources: sources,
      vault_path: vaultPath,
      last_collect_at: new Date().toISOString(),
      digest: {
        ...(state.digest || {}),
        task_map_summary: `Collected knowledge vault (${scan.notes.length} notes) from ${cwd}`,
        experts: ['kavi'],
      },
      metrics: {
        ...(state.metrics || {}),
        llm_calls: enrichResult.llm_calls || 0,
        experts_run: ['kavi'],
        input_tokens_est: enrichResult.input_tokens_est || 0,
        output_tokens_est: enrichResult.output_tokens_est || 0,
        mode: 'collect',
        effort_log: enrichResult.model
          ? [{ persona: 'kavi', effort: 'standard', model: enrichResult.model, scoped_mode: null }]
          : [],
        cost_usd: state.metrics?.cost_usd || 0,
      },
    },
  });

  console.log(`\n✅ Collect complete.`);
  console.log(`   Vault: ${vaultPath}`);
  console.log(`   Open in Obsidian, or run /persona-orchestrator — personas now read this knowledge bank.\n`);

  return {
    vaultPath,
    projectId,
    dryRun: false,
    filesScanned: scan.filesScanned,
    notes: scan.notes.length,
    notesWritten: scan.notesWritten,
    notesSkipped: scan.notesSkipped,
    web: webResult,
    sources: {
      discovered: sourceDiscoveries,
      manifest: sourceManifest,
      connected: connectResult.connected,
      skipped: connectResult.skipped,
    },
    enrich: enrichResult,
    sync: syncResult,
  };
}

module.exports = {
  collect,
  scanAndDraft,
  classifyFile,
  walkFiles,
  discoverWebUrls,
  collectWebResearch,
  extractUrlsFromText,
  isResearchableUrl,
  HARD_EXCLUDES,
};
