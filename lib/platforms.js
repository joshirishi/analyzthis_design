'use strict';

/**
 * Cross-platform skill install targets for vibe-coding tools.
 * SKILL.md (Agent Skills open standard) is the shared format; layout differs:
 *   - dir:  <root>/<skill>/SKILL.md   (Cursor, Claude skills, Codex, Grok, Windsurf, agents)
 *   - flat: <root>/<skill>.md         (legacy Claude Code commands/)
 */

const path = require('path');
const os   = require('os');
const fs   = require('fs');

const HOME = os.homedir();

/**
 * Resolve the analyzthis_design package root from a file under lib/ or dist/lib/.
 */
function resolvePackageRoot(fromDirname) {
  const candidates = [
    path.join(fromDirname, '..', '..', '..'),
    path.join(fromDirname, '..', '..'),
    path.join(fromDirname, '..'),
  ];
  for (const dir of candidates) {
    try {
      if (!fs.existsSync(path.join(dir, 'skills', 'arjun', 'SKILL.md'))) continue;
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
      if (pkg.name === 'analyzthis_design') return dir;
    } catch { /* try next */ }
  }
  return path.join(fromDirname, '..');
}

/** @type {Record<string, PlatformTarget>} */
const TARGETS = {
  cursor: {
    id: 'cursor',
    label: 'Cursor',
    root: path.join(HOME, '.cursor', 'skills'),
    layout: 'dir',
    invokePrefix: '/',
    usageHint: 'Wireframes: /ux-ideator or /noor — Critique: /persona-orchestrator',
  },
  claude: {
    id: 'claude',
    label: 'Claude Code',
    root: path.join(HOME, '.claude', 'skills'),
    layout: 'dir',
    also: { root: path.join(HOME, '.claude', 'commands'), layout: 'flat' },
    invokePrefix: '/',
    usageHint: 'Wireframes: /ux-ideator or /noor — Critique: /persona-orchestrator',
  },
  codex: {
    id: 'codex',
    label: 'Codex CLI',
    root: path.join(HOME, '.codex', 'skills'),
    layout: 'dir',
    invokePrefix: '',
    usageHint: 'Reference skills in AGENTS.md — wireframes: ux-ideator/noor; critique: persona-orchestrator',
  },
  grok: {
    id: 'grok',
    label: 'Grok Build (xAI)',
    root: path.join(HOME, '.grok', 'skills'),
    layout: 'dir',
    invokePrefix: '/',
    usageHint: 'Wireframes: /ux-ideator or /noor — Critique: /persona-orchestrator',
  },
  windsurf: {
    id: 'windsurf',
    label: 'Windsurf Cascade',
    root: path.join(HOME, '.codeium', 'windsurf', 'skills'),
    layout: 'dir',
    invokePrefix: '@',
    usageHint: 'Wireframes: @ux-ideator or @noor — Critique: @persona-orchestrator',
  },
  agents: {
    id: 'agents',
    label: 'Cross-agent (~/.agents/skills)',
    root: path.join(HOME, '.agents', 'skills'),
    layout: 'dir',
    invokePrefix: '/',
    usageHint: 'Discovered by Cursor, Grok, Windsurf, and other Agent Skills–compatible hosts',
  },
};

const ALL_TARGET_IDS = ['cursor', 'claude', 'codex', 'grok', 'windsurf', 'agents'];

const TARGET_DIRS = Object.fromEntries(
  Object.entries(TARGETS).map(([id, t]) => [id, t.root])
);

function resolveTargets(target) {
  if (!target || target === 'cursor') return ['cursor'];
  if (target === 'all') return ALL_TARGET_IDS.slice();
  if (TARGETS[target]) return [target];
  return null;
}

function knowledgeBankPaths(targetId) {
  const t = TARGETS[targetId];
  if (!t) return [];
  const paths = [];
  if (t.layout === 'dir') {
    paths.push(path.join(t.root, 'knowledge-bank', 'SKILL.md'));
  } else {
    paths.push(path.join(t.root, 'knowledge-bank.md'));
  }
  if (t.also) {
    if (t.also.layout === 'dir') {
      paths.push(path.join(t.also.root, 'knowledge-bank', 'SKILL.md'));
    } else {
      paths.push(path.join(t.also.root, 'knowledge-bank.md'));
    }
  }
  return paths;
}

const PLATFORM_SKILL_LOOKUP = `
Look for sibling skills (knowledge-bank, arjun, …) relative to this skill's install location first.
Otherwise try, in order:
- ~/.cursor/skills/<name>/SKILL.md
- ~/.claude/skills/<name>/SKILL.md
- ~/.claude/commands/<name>.md
- ~/.codex/skills/<name>/SKILL.md
- ~/.grok/skills/<name>/SKILL.md
- ~/.codeium/windsurf/skills/<name>/SKILL.md
- ~/.agents/skills/<name>/SKILL.md
`.trim();

function listInstalledTargets() {
  return ALL_TARGET_IDS.filter((id) => {
    const t = TARGETS[id];
    try {
      return fs.existsSync(t.root) || (t.also && fs.existsSync(t.also.root));
    } catch { return false; }
  });
}

module.exports = {
  TARGETS,
  TARGET_DIRS,
  ALL_TARGET_IDS,
  resolveTargets,
  knowledgeBankPaths,
  PLATFORM_SKILL_LOOKUP,
  listInstalledTargets,
  resolvePackageRoot,
};
