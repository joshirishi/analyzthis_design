#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  TARGETS,
  TARGET_DIRS,
  ALL_TARGET_IDS,
  resolveTargets,
  resolvePackageRoot,
} = require('./platforms');

const PACKAGE_ROOT = resolvePackageRoot(__dirname);
const PACKAGE_SKILLS_DIR = path.join(PACKAGE_ROOT, 'skills');
const WELCOME_MARKER = path.join(os.homedir(), '.analyzthis_design', '.welcome-shown');

const SKILLS = [
  'getting-started',
  'arjun',
  'meera',
  'priya',
  'zara',
  'noor',
  'anuj',
  'raj',
  'kavi',
  'collect-knowledge',
  'design-critic',
  'ux-ideator',
  'ux-story-gate',
  'persona-orchestrator',
  'deliberation-protocol',
  'devi',
  'design-director',
  'design-spec',
  'design-personas',
  'design-reference',
  'knowledge-bank',
];

function getPackageVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8')).version;
  } catch {
    return 'unknown';
  }
}

function shouldShowWelcome() {
  try {
    return !fs.existsSync(WELCOME_MARKER);
  } catch {
    return true;
  }
}

function markWelcomeShown() {
  fs.mkdirSync(path.dirname(WELCOME_MARKER), { recursive: true });
  fs.writeFileSync(WELCOME_MARKER, new Date().toISOString());
}

function printWelcomeBanner(targetId, log = console.log) {
  const t = TARGETS[targetId];
  if (!t) return;
  const p = t.invokePrefix || '/';
  const version = getPackageVersion();

  log(`\n✅ Analyzthis Design installed (v${version})`);
  log(`\nStart here in ${t.label}:`);
  if (targetId === 'codex') {
    log('  Add to AGENTS.md: kavi, ux-ideator, noor, persona-orchestrator, getting-started');
    log('  Skills live in ~/.codex/skills/<name>/SKILL.md');
  } else {
    log(`  ${p}getting-started          ← read this first`);
    log(`  ${p}kavi                     ← scan repo → knowledge bank (once per project)`);
    log(`  ${p}devi                     ← host LLM: voice personas when no API keys`);
    log(`  ${p}ux-ideator               ← wireframe a new screen (two concepts)`);
    log(`  ${p}design-director          ← wireframe → DesignSpec → build`);
    log(`  ${p}noor                     ← quick minimalist text wireframe`);
    log(`  ${p}persona-orchestrator     ← critique existing designs (not wireframes)`);
  }
  log(`\n  Re-print anytime: npx analyzthis_design welcome --target ${targetId}`);
  log('  Docs: https://www.npmjs.com/package/analyzthis_design\n');
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(srcPath, destPath);
    else fs.copyFileSync(srcPath, destPath);
  }
}

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

function installOne(skill, root, layout, force) {
  if (skill === 'design-reference' || layout === 'dir') {
    return installDir(skill, root, force);
  }
  return installFlat(skill, root, force);
}

function install({ silent = false, force = false, target = 'cursor', showBanner = true } = {}) {
  const log = silent ? () => {} : console.log;
  const warn = silent ? () => {} : console.warn;

  const targets = resolveTargets(target);
  if (!targets) {
    warn(`  ⚠  Unknown target "${target}". Choose: ${ALL_TARGET_IDS.join(', ')}, all`);
    return;
  }

  for (const tId of targets) {
    const t = TARGETS[tId];
    const destinations = [{ root: t.root, layout: t.layout }];
    if (t.also) destinations.push({ root: t.also.root, layout: t.also.layout });

    const installed = [], skipped = [], errors = [];
    const seen = new Set();

    for (const dest of destinations) {
      for (const skill of SKILLS) {
        const result = installOne(skill, dest.root, dest.layout, force);
        if (seen.has(skill) && result === 'installed') continue;
        if (result === 'installed') {
          if (!seen.has(skill)) { installed.push(skill); seen.add(skill); }
        } else if (result === 'skipped') {
          if (!seen.has(skill)) { skipped.push(skill); seen.add(skill); }
        } else if (result === 'missing') {
          warn(`  ⚠  Skill source not found: ${skill}`);
          if (!seen.has(skill)) { errors.push(skill); seen.add(skill); }
        } else {
          warn(`  ✗  Failed to install ${skill} → ${dest.root}`);
          if (!seen.has(skill)) { errors.push(skill); seen.add(skill); }
        }
      }
    }

    if (installed.length > 0) {
      log(`\n✅ [${t.label}] Installed ${installed.length} skill(s) → ${t.root}`);
      if (t.also) log(`   (+ legacy copy → ${t.also.root})`);
      for (const s of installed) log(`   • ${s}`);
    }
    if (skipped.length > 0) {
      log(`\n⏭  [${t.label}] Skipped ${skipped.length} existing skill(s) (use --force to overwrite):`);
      for (const s of skipped) log(`   • ${s}`);
    }
    if (errors.length > 0) {
      log(`\n✗  [${t.label}] ${errors.length} skill(s) failed.`);
    }
    if (showBanner && !silent && (installed.length > 0 || skipped.length > 0)) {
      printWelcomeBanner(tId, log);
    }
  }
}

function remove({ silent = false, target = 'cursor' } = {}) {
  const log = silent ? () => {} : console.log;

  const targets = resolveTargets(target);
  if (!targets) return;

  for (const tId of targets) {
    const t = TARGETS[tId];
    const roots = [t.root];
    if (t.also) roots.push(t.also.root);

    const removed = [], missing = [];

    for (const skill of SKILLS) {
      let found = false;
      for (const root of roots) {
        const asDir  = path.join(root, skill);
        const asFile = path.join(root, `${skill}.md`);
        if (fs.existsSync(asDir)) {
          fs.rmSync(asDir, { recursive: true, force: true });
          found = true;
        }
        if (fs.existsSync(asFile)) {
          fs.rmSync(asFile, { force: true });
          found = true;
        }
      }
      if (found) removed.push(skill);
      else missing.push(skill);
    }

    if (removed.length > 0) {
      log(`\n🗑  [${t.label}] Removed ${removed.length} skill(s):`);
      for (const s of removed) log(`   • ${s}`);
    }
    if (missing.length > 0) {
      log(`\n   [${t.label}] ${missing.length} skill(s) were not installed.`);
    }
  }
  log('');
}

module.exports = {
  install,
  remove,
  SKILLS,
  TARGET_DIRS,
  TARGETS,
  ALL_TARGET_IDS,
  printWelcomeBanner,
  markWelcomeShown,
  shouldShowWelcome,
};

if (require.main === module) {
  const silent = process.argv.includes('--silent');
  const forceWelcome = process.argv.includes('--welcome');
  install({ silent, target: 'cursor', showBanner: !silent });
  install({ silent, target: 'agents', showBanner: false });
  if (forceWelcome || shouldShowWelcome()) {
    if (silent) {
      printWelcomeBanner('cursor');
      printWelcomeBanner('claude');
    }
    markWelcomeShown();
  }
}
