#!/usr/bin/env node
'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const CONFIG_DIR        = path.join(os.homedir(), '.analyzthis_design');
const CONFIG_FILE       = path.join(CONFIG_DIR, 'config.json');
// When published, this file lives at dist/lib/ — go up two levels to reach package root
const KNOWLEDGE_SKILL   = path.join(__dirname, '..', '..', 'skills', 'knowledge-bank', 'SKILL.md');
const KNOWLEDGE_SLICE_ROOT = path.join(CONFIG_DIR, 'kb-slices');

const { resolvePackageRoot } = require('./platforms');
const PACKAGE_ROOT = resolvePackageRoot(__dirname);
const AGENTS_DIR = path.join(PACKAGE_ROOT, 'agents');

// Keywords used to auto-group vault notes into categories
const CATEGORIES = {
  // PRD/stories must be checked first — highest priority for ux-story-gate
  prd:      ['prd', 'requirements', 'user story', 'user stories', 'acceptance criteria', 'as a user',
             'as a ', 'given when', 'given/when', 'epic', 'jtbd', 'job to be done', 'job-to-be-done',
             'use case', 'done when', 'fails when', 'success criteria', 'definition of done'],
  brand:    ['brand', 'color', 'typography', 'logo', 'visual', 'style', 'tone', 'voice', 'identity'],
  product:  ['product', 'feature', 'roadmap', 'vision', 'goal', 'north-star', 'metric', 'kpi', 'okr'],
  design:   ['design', 'ux', 'ui', 'wireframe', 'component', 'pattern', 'system', 'figma', 'layout'],
  research: ['research', 'user', 'interview', 'survey', 'insight', 'pain', 'feedback', 'analytics', 'data'],
  tech:     ['tech', 'stack', 'api', 'backend', 'frontend', 'infrastructure', 'constraint', 'architecture'],
  web:      ['web-context', 'fetched:', 'search stub', 'source:', 'http://', 'https://'],
};

// ─── Config helpers ──────────────────────────────────────────────────────────

function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) return { sources: [] };
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
  catch { return { sources: [] }; }
}

function saveConfig(config) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// ─── Vault reading ───────────────────────────────────────────────────────────

// Recursively collect all .md files under a directory
function readMarkdownFiles(dir) {
  const files = [];
  if (!fs.existsSync(dir)) return files;
  const walk = (cur) => {
    for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
      const full = path.join(cur, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith('.')) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.md')) files.push(full);
    }
  };
  walk(dir);
  return files;
}

// Parse YAML-ish frontmatter from a markdown file
function parseFrontmatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: raw };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const [k, ...v] = line.split(':');
    if (k && v.length) meta[k.trim()] = v.join(':').trim();
  }
  return { meta, body: m[2] };
}

// Collect tags from frontmatter and inline #hashtags
function extractTags(meta, body) {
  const tags = [];
  if (meta.tags) tags.push(...meta.tags.replace(/[\[\]]/g, '').split(',').map(t => t.trim().toLowerCase()));
  const inline = body.match(/#(\w+)/g) || [];
  tags.push(...inline.map(t => t.slice(1).toLowerCase()));
  return [...new Set(tags)];
}

// Strip Obsidian-specific syntax so the AI reads clean markdown
function cleanObsidian(text) {
  return text
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')  // [[note|alias]] → alias
    .replace(/\[\[([^\]]+)\]\]/g, '$1')               // [[note]] → note text
    .replace(/!\[\[([^\]]+)\]\]/g, '')                 // ![[embed]] → remove
    .replace(/%%[\s\S]*?%%/g, '')                      // %% comments %% → remove
    .trim();
}

// Map a note to a section category
function categorize(title, tags, body) {
  const text = `${title} ${tags.join(' ')} ${body.substring(0, 500)}`.toLowerCase();
  for (const [cat, keywords] of Object.entries(CATEGORIES)) {
    if (keywords.some(k => text.includes(k))) return cat;
  }
  return 'other';
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Register a vault or folder as a knowledge source.
 * Options:
 *   include  — array of sub-folder prefixes to include, e.g. ['Design', 'Brand']
 *   tags     — array of tags to filter by, e.g. ['ux', 'design', 'brand']
 */
function connect({ vaultPath, include = [], tags = [] }) {
  const abs = path.resolve(vaultPath);
  if (!fs.existsSync(abs)) throw new Error(`Path does not exist: ${abs}`);

  const config = loadConfig();
  // Replace any existing entry with the same path
  config.sources = config.sources.filter(s => s.path !== abs);
  config.sources.push({ path: abs, include, tags, addedAt: new Date().toISOString() });
  saveConfig(config);
  return abs;
}

/**
 * Remove a vault/folder from the knowledge sources list.
 */
function disconnect(vaultPath) {
  const abs = path.resolve(vaultPath);
  const config = loadConfig();
  config.sources = config.sources.filter(s => s.path !== abs);
  saveConfig(config);
}

/**
 * Read all connected sources, filter notes, build knowledge-bank.md,
 * and copy it to all requested target AI tool directories.
 *
 * targets — array of tool names: 'cursor', 'claude', 'codex'
 */
function sync({ targets = ['cursor'] } = {}) {
  const config = loadConfig();

  if (!config.sources || config.sources.length === 0) {
    return { synced: 0, message: 'No sources connected. Run: npx analyzthis_design connect --vault /path/to/vault' };
  }

  const sections = { prd: [], brand: [], product: [], design: [], research: [], tech: [], web: [], other: [] };
  let totalFiles = 0;

  for (const source of config.sources) {
    const files = readMarkdownFiles(source.path);

    for (const filePath of files) {
      const raw  = fs.readFileSync(filePath, 'utf8');
      const { meta, body } = parseFrontmatter(raw);
      const tags = extractTags(meta, body);

      // Tag filter: skip file if it doesn't carry one of the required tags
      if (source.tags.length > 0 && !source.tags.some(t => tags.includes(t.toLowerCase()))) continue;

      // Include-folder filter: skip file if it's not inside one of the allowed sub-paths
      if (source.include.length > 0) {
        const rel = path.relative(source.path, filePath);
        const ok  = source.include.some(p => rel.startsWith(p.replace('/**', '').replace('/*', '')));
        if (!ok) continue;
      }

      const title   = meta.title || path.basename(filePath, '.md');
      const cleaned = cleanObsidian(body);
      if (!cleaned.trim()) continue;

      const cat = categorize(title, tags, cleaned);
      sections[cat].push({ title, content: cleaned });
      totalFiles++;
    }
  }

  // Merge session web-context.md research artifacts (if any) into the web section
  try {
    const research = require('./research');
    const web = research.readWebContext();
    if (web && web.content && web.content.trim()) {
      sections.web.push({ title: 'Session web research', content: web.content });
      totalFiles++;
    }
  } catch { /* no session / research available — fine */ }

  // Build the knowledge-bank markdown
  const sourceList = config.sources.map(s => s.path).join(', ');
  const date       = new Date().toISOString().split('T')[0];

  // PRD/stories listed first — ux-story-gate reads this section in Phase 0
  const sectionDefs = [
    { key: 'prd',      heading: '## PRDs, User Stories & Acceptance Criteria' },
    { key: 'brand',    heading: '## Brand & Design Guidelines' },
    { key: 'product',  heading: '## Product Context' },
    { key: 'design',   heading: '## Design Decisions & Patterns' },
    { key: 'research', heading: '## Research & User Insights' },
    { key: 'web',      heading: '## Web Research Context' },
    { key: 'tech',     heading: '## Technical Context' },
    { key: 'other',    heading: '## Additional Context' },
  ];

  let md = `---
name: knowledge-bank
description: Personal knowledge bank — takes precedence over all built-in persona defaults.
disable-model-invocation: true
---

# Knowledge Bank

> Last synced: ${date}
> Sources: ${sourceList}
> Files loaded: ${totalFiles}

**INSTRUCTION TO ALL PERSONAS:** This knowledge bank contains project-specific context that overrides your built-in defaults. Read every section below before forming any opinion. When this knowledge bank conflicts with your built-in knowledge, this knowledge bank wins.

---

`;

  let hasContent = false;
  for (const { key, heading } of sectionDefs) {
    if (sections[key].length === 0) continue;
    hasContent = true;
    md += `${heading}\n\n`;
    for (const note of sections[key]) {
      md += `### ${note.title}\n\n${note.content}\n\n`;
    }
    md += '---\n\n';
  }

  if (!hasContent) {
    md += `_No matching files found. Check your --tags or --include filters, or remove filters to include all notes._\n`;
  }

  // Write to the package's own skills/knowledge-bank/SKILL.md
  fs.mkdirSync(path.dirname(KNOWLEDGE_SKILL), { recursive: true });
  fs.writeFileSync(KNOWLEDGE_SKILL, md);

  // Build per-persona knowledge slices (priority + fallback)
  try {
    const session = require('./session');
    const projectId = session.getProjectId();
    writePersonaSlices(sections, sectionDefs, projectId);
  } catch {
    // sessions unavailable — skip slices
  }

  // Copy knowledge-bank into every requested platform (dir and/or flat layout)
  const { TARGETS, resolveTargets } = require('./platforms');
  const copiedTo = [];
  const resolved = targets.includes('all')
    ? resolveTargets('all')
    : targets.filter((t) => TARGETS[t]);

  for (const targetId of resolved) {
    const t = TARGETS[targetId];
    const destinations = [{ root: t.root, layout: t.layout }];
    if (t.also) destinations.push({ root: t.also.root, layout: t.also.layout });

    for (const dest of destinations) {
      fs.mkdirSync(dest.root, { recursive: true });
      if (dest.layout === 'dir') {
        const skillDir = path.join(dest.root, 'knowledge-bank');
        fs.mkdirSync(skillDir, { recursive: true });
        fs.copyFileSync(KNOWLEDGE_SKILL, path.join(skillDir, 'SKILL.md'));
      } else {
        fs.copyFileSync(KNOWLEDGE_SKILL, path.join(dest.root, 'knowledge-bank.md'));
      }
      copiedTo.push(`${targetId} → ${dest.root}`);
    }
  }

  // Persist lastSync timestamp
  config.lastSync = new Date().toISOString();
  saveConfig(config);

  // Knowledge bank content just changed for every project — drop any cached
  // knowledge-bank slices so the next run re-reads the fresh sync.
  try { require('./cache').invalidatePrefix('kb:'); } catch { /* cache module unavailable — fine */ }

  return { synced: totalFiles, copiedTo };
}

function loadManifest(id) {
  const p = path.join(AGENTS_DIR, 'manifests', `${id}.json`);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function personaRelevance(category, personaCategories) {
  if (!personaCategories || !personaCategories.length) return true;
  return personaCategories.indexOf(category) !== -1;
}

function buildPersonaSlice(personaId, sections, sectionDefs, projectId) {
  const manifest = loadManifest(personaId);
  const cats = manifest && manifest.knowledge_categories ? manifest.knowledge_categories : [];
  let md = `---\nname: knowledge-bank-${personaId}\ndescription: Project context filtered for the ${personaId} persona.\ndisable-model-invocation: true\n---\n\n# ${personaId.toUpperCase()} Knowledge Slice\n\n**INSTRUCTION:** This slice contains the notes most relevant to your lens. Read it first, then scan the Additional Context section briefly.\n\n---\n\n`;

  let hasPrimary = false;
  for (const { key, heading } of sectionDefs) {
    if (!personaRelevance(key, cats)) continue;
    if (sections[key].length === 0) continue;
    hasPrimary = true;
    md += `${heading}\n\n`;
    for (const note of sections[key]) {
      md += `### ${note.title}\n\n${note.content}\n\n`;
    }
    md += '---\n\n';
  }

  if (!hasPrimary) {
    md += '_No primary notes for your lens. Reading general context below._\n\n';
  }

  md += '## Additional Context (secondary)\n\n';
  let secondaryCount = 0;
  for (const { key, heading } of sectionDefs) {
    if (personaRelevance(key, cats)) continue;
    if (sections[key].length === 0) continue;
    md += `${heading}\n\n`;
    for (const note of sections[key].slice(0, 2)) {
      md += `### ${note.title}\n\n${note.content.slice(0, 600)}${note.content.length > 600 ? '…' : ''}\n\n`;
      secondaryCount++;
      if (secondaryCount >= 2) break;
    }
    md += '---\n\n';
    if (secondaryCount >= 2) break;
  }

  return md;
}

function writePersonaSlices(sections, sectionDefs, projectId) {
  const personas = ['arjun', 'meera', 'priya', 'zara', 'noor', 'anuj', 'raj'];
  const dir = path.join(KNOWLEDGE_SLICE_ROOT, projectId || 'default');
  fs.mkdirSync(dir, { recursive: true });
  const written = [];
  for (const personaId of personas) {
    const md = buildPersonaSlice(personaId, sections, sectionDefs, projectId);
    const file = path.join(dir, `${personaId}.md`);
    fs.writeFileSync(file, md);
    written.push(file);
  }
  return written;
}

function readPersonaSlice(projectId, personaId) {
  const file = path.join(KNOWLEDGE_SLICE_ROOT, projectId || 'default', `${personaId}.md`);
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, 'utf8');
  const notes = [];
  const matches = text.match(/### (.*?)\n\n([\s\S]*?)(?=\n\n---|\n### |$)/g);
  if (matches) {
    for (const m of matches) {
      const titleMatch = m.match(/### (.*?)\n\n/);
      if (!titleMatch) continue;
      notes.push({
        title: titleMatch[1].trim(),
        content: m.replace(/### .*?\n\n/, '').trim(),
      });
    }
  }
  return notes;
}

function getPersonaSliceForPrompt(state, personaId) {
  const projectId = state && state.project_id ? state.project_id : 'default';
  const cacheKey = `kb:${projectId}:${personaId}:slice`;
  const cached = require('./cache').get(cacheKey);
  if (cached) return cached;

  const notes = readPersonaSlice(projectId, personaId);
  require('./cache').set(cacheKey, notes);
  return notes;
}

/**
 * Return current config (sources list, lastSync).
 */
function status() {
  return loadConfig();
}

module.exports = { connect, disconnect, sync, status, buildPersonaSlice, writePersonaSlices, readPersonaSlice, getPersonaSliceForPrompt, KNOWLEDGE_SLICE_ROOT };
