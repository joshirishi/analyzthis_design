#!/usr/bin/env node
'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const CONFIG_DIR        = path.join(os.homedir(), '.analyzthis_design');
const CONFIG_FILE       = path.join(CONFIG_DIR, 'config.json');
// When published, this file lives at dist/lib/ — go up two levels to reach package root
const KNOWLEDGE_SKILL   = path.join(__dirname, '..', '..', 'skills', 'knowledge-bank', 'SKILL.md');

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

  const sections = { prd: [], brand: [], product: [], design: [], research: [], tech: [], other: [] };
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

  // Copy to each target AI tool's skills directory
  const { TARGET_DIRS } = require('./install');
  const copiedTo = [];

  for (const target of targets) {
    const dir = TARGET_DIRS[target];
    if (!dir) continue;
    fs.mkdirSync(dir, { recursive: true });

    if (target === 'cursor') {
      // Cursor expects a sub-directory with SKILL.md inside
      const dest = path.join(dir, 'knowledge-bank');
      fs.mkdirSync(dest, { recursive: true });
      fs.copyFileSync(KNOWLEDGE_SKILL, path.join(dest, 'SKILL.md'));
    } else {
      // Claude/Codex: flat .md file
      fs.copyFileSync(KNOWLEDGE_SKILL, path.join(dir, 'knowledge-bank.md'));
    }
    copiedTo.push(`${target} → ${dir}`);
  }

  // Persist lastSync timestamp
  config.lastSync = new Date().toISOString();
  saveConfig(config);

  return { synced: totalFiles, copiedTo };
}

/**
 * Return current config (sources list, lastSync).
 */
function status() {
  return loadConfig();
}

module.exports = { connect, disconnect, sync, status };
