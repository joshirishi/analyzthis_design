#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// When published, this file lives at dist/lib/ — go up two levels to reach package root
const PACKAGE_SKILLS_DIR = path.join(__dirname, '..', '..', 'skills');

// Directory each AI tool uses for custom skills/commands
const TARGET_DIRS = {
  cursor: path.join(os.homedir(), '.cursor', 'skills'),
  claude: path.join(os.homedir(), '.claude', 'commands'),
  codex:  path.join(os.homedir(), '.codex', 'skills'),
};

const SKILLS = [
  'arjun',
  'meera',
  'priya',
  'zara',
  'noor',
  'anuj',
  'raj',
  'design-critic',
  'ux-ideator',
  'ux-story-gate',
  'design-personas',
  'design-reference',
  'knowledge-bank',
];

// Copies a directory recursively
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// For Claude/Codex: install each skill as a single flat .md file
// (these tools don't support sub-directories the way Cursor does)
function installFlat(skill, skillsDir, force) {
  const src = path.join(PACKAGE_SKILLS_DIR, skill, 'SKILL.md');
  const dest = path.join(skillsDir, `${skill}.md`);

  if (!fs.existsSync(src)) return 'missing';
  if (fs.existsSync(dest) && !force) return 'skipped';

  try {
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.copyFileSync(src, dest);
    return 'installed';
  } catch {
    return 'error';
  }
}

// For Cursor: install each skill as a directory (existing behaviour)
function installDir(skill, skillsDir, force) {
  const src = path.join(PACKAGE_SKILLS_DIR, skill);
  const dest = path.join(skillsDir, skill);

  if (!fs.existsSync(src)) return 'missing';
  if (fs.existsSync(dest) && !force) return 'skipped';

  try {
    copyDir(src, dest);
    return 'installed';
  } catch {
    return 'error';
  }
}

function install({ silent = false, force = false, target = 'cursor' } = {}) {
  const log = silent ? () => {} : console.log;
  const warn = silent ? () => {} : console.warn;

  // Resolve list of targets
  const targets = target === 'all' ? Object.keys(TARGET_DIRS) : [target];

  for (const t of targets) {
    if (!TARGET_DIRS[t]) {
      warn(`  ⚠  Unknown target "${t}". Choose: cursor, claude, codex, all`);
      continue;
    }

    const skillsDir = TARGET_DIRS[t];
    const installed = [], skipped = [], errors = [];

    for (const skill of SKILLS) {
      // design-reference has sub-directories — always install as full dir
      const result = (t === 'cursor' || skill === 'design-reference')
        ? installDir(skill, skillsDir, force)
        : installFlat(skill, skillsDir, force);

      if (result === 'installed') installed.push(skill);
      else if (result === 'skipped') skipped.push(skill);
      else if (result === 'missing') { warn(`  ⚠  Skill source not found: ${skill}`); errors.push(skill); }
      else { warn(`  ✗  Failed to install ${skill}`); errors.push(skill); }
    }

    if (installed.length > 0) {
      log(`\n✅ Analyzthis_Design installed ${installed.length} skill(s) to ${skillsDir}:`);
      for (const s of installed) log(`   • ${s}`);
    }
    if (skipped.length > 0) {
      log(`\n⏭  Skipped ${skipped.length} already-existing skill(s) (use --force to overwrite):`);
      for (const s of skipped) log(`   • ${s}`);
    }
    if (errors.length > 0) {
      log(`\n✗  ${errors.length} skill(s) failed to install.`);
    }
    if ((installed.length > 0 || skipped.length > 0) && t === 'cursor') {
      log(`\n💡 Usage in Cursor:`);
      log(`   /design-critic   — multi-persona critique (Arjun, Meera, Priya, Zara)`);
      log(`   /ux-ideator      — full ideation workflow (all 7 personas, 6 phases)`);
      log(`   /design-personas — fill in session context before a session\n`);
    }
    if ((installed.length > 0 || skipped.length > 0) && t === 'claude') {
      log(`\n💡 Usage in Claude Code:`);
      log(`   /design-critic   — multi-persona critique`);
      log(`   /ux-ideator      — full ideation workflow\n`);
    }
    if ((installed.length > 0 || skipped.length > 0) && t === 'codex') {
      log(`\n💡 Usage in Codex CLI:`);
      log(`   Skills installed to ~/.codex/skills/ — reference them in your AGENTS.md or instructions\n`);
    }
  }
}

function remove({ silent = false, target = 'cursor' } = {}) {
  const log = silent ? () => {} : console.log;

  const targets = target === 'all' ? Object.keys(TARGET_DIRS) : [target];

  for (const t of targets) {
    if (!TARGET_DIRS[t]) continue;

    const skillsDir = TARGET_DIRS[t];
    const removed = [], missing = [];

    for (const skill of SKILLS) {
      // Try both directory and flat .md file
      const asDir  = path.join(skillsDir, skill);
      const asFile = path.join(skillsDir, `${skill}.md`);

      if (fs.existsSync(asDir)) {
        fs.rmSync(asDir, { recursive: true, force: true });
        removed.push(skill);
      } else if (fs.existsSync(asFile)) {
        fs.rmSync(asFile, { force: true });
        removed.push(skill);
      } else {
        missing.push(skill);
      }
    }

    if (removed.length > 0) {
      log(`\n🗑  [${t}] Removed ${removed.length} skill(s) from ${skillsDir}:`);
      for (const s of removed) log(`   • ${s}`);
    }
    if (missing.length > 0) {
      log(`\n   [${t}] ${missing.length} skill(s) were not installed (nothing to remove).`);
    }
  }
  log('');
}

module.exports = { install, remove, SKILLS, TARGET_DIRS };

// Run directly (postinstall) — always installs Cursor by default
if (require.main === module) {
  const silent = process.argv.includes('--silent');
  install({ silent, target: 'cursor' });
}
