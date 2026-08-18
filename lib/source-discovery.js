#!/usr/bin/env node
'use strict';

/**
 * Discover potential knowledge-bank sources: Obsidian vaults, markdown wikis,
 * knowledge-graph references, and paths cited in repo docs — then write manifest
 * notes for Kavi and optionally auto-connect them.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const knowledge = require('./knowledge');

const HOME = os.homedir();
const VAULT_NAME_HINTS = /\b(vault|obsidian|wiki|knowledge|docs|notes|brain|second.?brain)\b/i;
const REFERENCE_FILES = [
  'README.md', 'AGENTS.md', 'CLAUDE.md', 'CONTRIBUTING.md',
  'package.json', '.cursorrules', 'cursor.md',
];
const MIN_MD_FOR_VAULT = 5;

const PATH_REF_PATTERNS = [
  /(?:connect\s+--vault\s+)([^\s`"']+)/gi,
  /(?:vault|obsidian|knowledge[-_ ]?bank|knowledge[-_ ]?graph|wiki)[:\s]+[`"']?([~/][^\s`"'\],)]+)/gi,
  /(?:path|folder|directory)[:\s]+[`"']?([~/][^\s`"'\],)]*(?:vault|obsidian|wiki|knowledge)[^\s`"'\],)]*)/gi,
];

function loadConfig() {
  const configPath = path.join(HOME, '.analyzthis_design', 'config.json');
  if (!fs.existsSync(configPath)) return { sources: [] };
  try { return JSON.parse(fs.readFileSync(configPath, 'utf8')); }
  catch { return { sources: [] }; }
}

function expandPath(raw, cwd) {
  if (!raw || typeof raw !== 'string') return null;
  let p = raw.trim().replace(/^[`"']|[`"']$/g, '');
  if (p.startsWith('~')) p = path.join(HOME, p.slice(1).replace(/^\//, ''));
  else if (!path.isAbsolute(p)) p = path.resolve(cwd, p);
  try {
    p = fs.realpathSync(p);
    return p;
  } catch {
    return fs.existsSync(p) ? path.resolve(p) : null;
  }
}

function countMarkdown(dir, max = 500) {
  let n = 0;
  const walk = (cur, depth) => {
    if (depth > 6 || n >= max) return;
    let entries;
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') && e.name !== '.obsidian') continue;
      const full = path.join(cur, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (e.name.endsWith('.md')) n += 1;
    }
  };
  walk(dir, 0);
  return n;
}

function listTopFolders(dir, limit = 8) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name)
      .slice(0, limit);
  } catch {
    return [];
  }
}

function isObsidianVault(dir) {
  return fs.existsSync(path.join(dir, '.obsidian'));
}

function hasKnowledgeGraph(dir) {
  const obsGraph = path.join(dir, '.obsidian', 'graph.json');
  if (fs.existsSync(obsGraph)) return true;
  const names = ['graph.json', 'knowledge-graph.json', 'kg.json'];
  try {
    return fs.readdirSync(dir).some((f) => names.includes(f.toLowerCase()));
  } catch {
    return false;
  }
}

function statsForPath(absPath) {
  const mdCount = countMarkdown(absPath);
  const folders = listTopFolders(absPath);
  return {
    markdown_files: mdCount,
    top_folders: folders,
    has_obsidian: isObsidianVault(absPath),
    has_graph: hasKnowledgeGraph(absPath),
  };
}

function makeDiscovery({ path: absPath, type, discoveredFrom, confidence, cwd }) {
  if (!absPath || !fs.existsSync(absPath)) return null;
  try {
    const stat = fs.statSync(absPath);
    if (!stat.isDirectory()) return null;
  } catch {
    return null;
  }
  const stats = statsForPath(absPath);
  if (stats.markdown_files === 0 && !stats.has_obsidian) return null;

  return {
    path: absPath,
    type,
    discovered_from: discoveredFrom,
    confidence,
    stats,
    slug: path.basename(absPath).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) || 'source',
  };
}

function addDiscovery(map, item) {
  if (!item) return;
  const key = item.path;
  const existing = map.get(key);
  if (!existing || rankConfidence(item.confidence) > rankConfidence(existing.confidence)) {
    map.set(key, item);
  }
}

function rankConfidence(c) {
  return c === 'high' ? 3 : c === 'medium' ? 2 : 1;
}

function findObsidianVaultsInTree(root, maxDepth = 5, exclude = new Set()) {
  const found = [];
  const walk = (dir, depth) => {
    if (depth > maxDepth) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    if (entries.some((e) => e.name === '.obsidian' && e.isDirectory())) {
      found.push(dir);
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name.startsWith('.') || exclude.has(e.name)) continue;
      if (['node_modules', 'dist', 'build', '.git', 'vendor'].includes(e.name)) continue;
      walk(path.join(dir, e.name), depth + 1);
    }
  };
  walk(root, 0);
  return found;
}

function findMarkdownRichFolders(root, maxDepth = 3) {
  const found = [];
  const walk = (dir, depth) => {
    if (depth > maxDepth) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    const base = path.basename(dir);
    const mdCount = entries.filter((e) => e.isFile() && e.name.endsWith('.md')).length;
    if (mdCount >= MIN_MD_FOR_VAULT && (VAULT_NAME_HINTS.test(base) || VAULT_NAME_HINTS.test(dir))) {
      found.push(dir);
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      if (['node_modules', 'dist', 'build', '.git'].includes(e.name)) continue;
      walk(path.join(dir, e.name), depth + 1);
    }
  };
  walk(root, 0);
  return found;
}

function extractPathRefs(text, cwd) {
  const paths = new Set();
  for (const re of PATH_REF_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      const expanded = expandPath(m[1], cwd);
      if (expanded) paths.add(expanded);
    }
  }
  // Obsidian URIs: obsidian://open?vault=Name — record name only (path unknown)
  const vaultNames = text.match(/obsidian:\/\/[^\s"']+/gi) || [];
  for (const uri of vaultNames) paths.add(uri);
  return [...paths];
}

function collectReferenceTexts(cwd) {
  const texts = [];
  for (const rel of REFERENCE_FILES) {
    const full = path.join(cwd, rel);
    if (fs.existsSync(full)) {
      try { texts.push({ rel, content: fs.readFileSync(full, 'utf8') }); } catch { /* ignore */ }
    }
  }
  const extraDirs = ['docs', '.cursor', '.github'];
  for (const dir of extraDirs) {
    const base = path.join(cwd, dir);
    if (!fs.existsSync(base)) continue;
    const walk = (cur, depth) => {
      if (depth > 4) return;
      let entries;
      try { entries = fs.readdirSync(cur, { withFileTypes: true }); }
      catch { return; }
      for (const e of entries) {
        const full = path.join(cur, e.name);
        if (e.isDirectory() && !e.name.startsWith('.')) walk(full, depth + 1);
        else if (e.isFile() && /\.(md|json|txt)$/i.test(e.name)) {
          try {
            texts.push({ rel: path.relative(cwd, full), content: fs.readFileSync(full, 'utf8').slice(0, 50000) });
          } catch { /* ignore */ }
        }
      }
    };
    walk(base, 0);
  }
  return texts;
}

function scanHomeVaultHints(config) {
  const results = [];
  if (config.collect?.scan_home_vaults !== true) return results;
  const searchRoots = config.collect?.home_vault_paths || [
    path.join(HOME, 'Documents'),
    path.join(HOME, 'Obsidian'),
    path.join(HOME, 'Vaults'),
  ];
  for (const root of searchRoots) {
    if (!fs.existsSync(root)) continue;
    let entries;
    try { entries = fs.readdirSync(root, { withFileTypes: true }); }
    catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const full = path.join(root, e.name);
      if (isObsidianVault(full)) results.push(full);
    }
  }
  return results;
}

/**
 * Discover knowledge sources around the project and in config.
 */
function discoverKnowledgeSources({ cwd, config: cfgIn }) {
  const config = cfgIn || loadConfig();
  const map = new Map();

  // Already registered in config
  for (const src of config.sources || []) {
    addDiscovery(map, makeDiscovery({
      path: expandPath(src.path, cwd),
      type: 'registered_source',
      discoveredFrom: '~/.analyzthis_design/config.json',
      confidence: 'high',
      cwd,
    }));
  }

  // Explicit collect paths
  for (const p of config.collect?.source_paths || []) {
    addDiscovery(map, makeDiscovery({
      path: expandPath(p, cwd),
      type: 'config_path',
      discoveredFrom: 'collect.source_paths',
      confidence: 'high',
      cwd,
    }));
  }

  // Obsidian vaults in repo
  for (const vaultRoot of findObsidianVaultsInTree(cwd)) {
    addDiscovery(map, makeDiscovery({
      path: vaultRoot,
      type: 'obsidian_vault',
      discoveredFrom: '.obsidian/ marker in repo',
      confidence: 'high',
      cwd,
    }));
  }

  // Markdown-rich folders (wiki / docs vaults)
  for (const folder of findMarkdownRichFolders(cwd)) {
    addDiscovery(map, makeDiscovery({
      path: folder,
      type: 'markdown_vault',
      discoveredFrom: 'markdown-rich folder in repo',
      confidence: 'medium',
      cwd,
    }));
  }

  // Paths referenced in README, AGENTS.md, docs, etc.
  for (const { rel, content } of collectReferenceTexts(cwd)) {
    for (const ref of extractPathRefs(content, cwd)) {
      if (ref.startsWith('obsidian://')) {
        // URI-only — documented in manifest, not connectable
        continue;
      }
      addDiscovery(map, makeDiscovery({
        path: ref,
        type: 'referenced_path',
        discoveredFrom: rel,
        confidence: 'medium',
        cwd,
      }));
    }
    if (/\b\.obsidian\/graph\b/i.test(content)) {
      const candidate = path.dirname(path.join(cwd, rel));
      if (isObsidianVault(candidate) || hasKnowledgeGraph(candidate)) {
        addDiscovery(map, makeDiscovery({
          path: candidate,
          type: 'knowledge_graph_ref',
          discoveredFrom: `${rel} (.obsidian/graph reference)`,
          confidence: 'high',
          cwd,
        }));
      }
    }
  }

  // Optional home scan
  for (const homeVault of scanHomeVaultHints(config)) {
    addDiscovery(map, makeDiscovery({
      path: homeVault,
      type: 'obsidian_vault',
      discoveredFrom: 'home vault scan (collect.scan_home_vaults)',
      confidence: 'medium',
      cwd,
    }));
  }

  return [...map.values()].sort((a, b) => rankConfidence(b.confidence) - rankConfidence(a.confidence));
}

function buildSourceNote(discovery, index) {
  const { path: absPath, type, discovered_from, confidence, stats } = discovery;
  const title = `${type.replace(/_/g, ' ')} — ${path.basename(absPath)}`;
  const fm = [
    '---',
    `title: ${JSON.stringify(title)}`,
    'tags: [source, discovered, kavi]',
    `source_type: "${type}"`,
    `source_path: ${JSON.stringify(absPath)}`,
    `discovered_from: ${JSON.stringify(discovered_from)}`,
    `confidence: "${confidence}"`,
    `markdown_files: ${stats.markdown_files}`,
    `has_obsidian: ${stats.has_obsidian}`,
    `has_knowledge_graph: ${stats.has_graph}`,
    `collected_at: "${new Date().toISOString().split('T')[0]}"`,
    '---',
    '',
  ].join('\n');

  const body = [
    `# ${title}`,
    '',
    '## Summary',
    `Potential knowledge-bank source discovered by Kavi during collect.`,
    '',
    `- **Absolute path:** \`${absPath}\``,
    `- **Type:** ${type}`,
    `- **Confidence:** ${confidence}`,
    `- **Discovered from:** ${discovered_from}`,
    '',
    '## Contents snapshot',
    `- Markdown files (approx): **${stats.markdown_files}**`,
    `- Top folders: ${stats.top_folders.length ? stats.top_folders.map((f) => `\`${f}\``).join(', ') : '_(none)_'}`,
    `- Obsidian vault: ${stats.has_obsidian ? 'yes' : 'no'}`,
    `- Knowledge graph data: ${stats.has_graph ? 'yes' : 'no'}`,
    '',
    '## How personas use this',
    'When auto-connected, notes from this path are merged into the **knowledge bank** on sync.',
    'Personas read PRDs, brand, research, and design context from connected sources before critiquing.',
    '',
    '## Manual connect',
    '```bash',
    `npx analyzthis_design connect --vault "${absPath}"`,
    'npx analyzthis_design sync --target all',
    '```',
    '',
    `## Related`,
    `- [[_meta/knowledge-sources|All discovered sources]]`,
    `- [[_meta/index|Vault index]]`,
    '',
  ].join('\n');

  return { vaultRel: `Sources/${String(index).padStart(2, '0')}-${discovery.slug}.md`, content: fm + body };
}

/**
 * Write manifest notes under vault/Sources/ and _meta/knowledge-sources.md
 */
function writeSourceManifestNotes({ discoveries, vaultPath, dryRun }) {
  if (!discoveries.length) return { written: [], indexPath: null };

  const notes = discoveries.map((d, i) => buildSourceNote(d, i + 1));
  const indexLines = [
    '---',
    'title: "Discovered knowledge sources"',
    'tags: [meta, sources, moc]',
    `updated_at: "${new Date().toISOString()}"`,
    '---',
    '',
    '# Discovered knowledge sources',
    '',
    'Kavi found these potential knowledge-bank areas during collect. Manifest notes live in `Sources/`.',
    '',
    '| Source | Type | Confidence | Markdown files |',
    '| --- | --- | --- | --- |',
  ];

  for (const d of discoveries) {
    indexLines.push(`| \`${d.path}\` | ${d.type} | ${d.confidence} | ${d.stats.markdown_files} |`);
  }
  indexLines.push('', '## Source notes', '');
  for (const n of notes) {
    const link = n.vaultRel.replace(/\.md$/, '').replace(/\\/g, '/');
    indexLines.push(`- [[${link}]]`);
  }
  indexLines.push('');

  if (dryRun) {
    return {
      written: notes.map((n) => n.vaultRel),
      indexPath: '_meta/knowledge-sources.md',
      discoveries,
    };
  }

  fs.mkdirSync(path.join(vaultPath, 'Sources'), { recursive: true });
  fs.mkdirSync(path.join(vaultPath, '_meta'), { recursive: true });
  for (const n of notes) {
    fs.writeFileSync(path.join(vaultPath, n.vaultRel), n.content);
  }
  const indexPath = path.join(vaultPath, '_meta', 'knowledge-sources.md');
  fs.writeFileSync(indexPath, indexLines.join('\n'));
  return { written: notes.map((n) => n.vaultRel), indexPath: '_meta/knowledge-sources.md' };
}

/**
 * Auto-connect discovered sources (high/medium confidence) into the project's
 * scoped sources (config.projects[projectId].sources). Pass { project, cwd }
 * so the scope matches the collect() call site; falls back to cwd-derived
 * scoping inside knowledge.connect when omitted.
 */
function connectDiscoveredSources({ discoveries, kaviVaultPath, config, autoConnect = true, project, cwd }) {
  const connected = [];
  const skipped = [];
  if (!autoConnect) return { connected, skipped };

  const minRank = config.collect?.auto_connect_min_confidence === 'low' ? 1
    : config.collect?.auto_connect_min_confidence === 'high' ? 3 : 2;

  for (const d of discoveries) {
    if (rankConfidence(d.confidence) < minRank) {
      skipped.push({ path: d.path, reason: 'low confidence' });
      continue;
    }
    if (d.path === kaviVaultPath) {
      skipped.push({ path: d.path, reason: 'kavi output vault' });
      continue;
    }
    try {
      knowledge.connect({ vaultPath: d.path, tags: [], include: [], project, cwd });
      connected.push(d.path);
    } catch (err) {
      skipped.push({ path: d.path, reason: err.message });
    }
  }
  return { connected, skipped };
}

module.exports = {
  discoverKnowledgeSources,
  writeSourceManifestNotes,
  connectDiscoveredSources,
  expandPath,
  isObsidianVault,
};
