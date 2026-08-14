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
  listInstalledTargets,
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
  'chunk-planner',
  'run-unchunked',
  'evolve-check',
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
  const gs = `${p}getting-started`;

  log(`\n✅ Analyzthis Design installed (v${version})`);
  log('');
  log('  Structured UX critiques, ideation, and task-grounded screen reviews — in your AI chat.');
  log('  No external LLM API keys required for CLI runs: ' +
    `${p}devi voices each persona from your IDE.`);
  log('');
  log(`Start here in ${t.label}:`);
  if (targetId === 'windsurf') {
    log(`  @getting-started          ← read this first`);
  } else if (targetId === 'codex') {
    log('  Add to AGENTS.md: getting-started, kavi, devi, ux-ideator, persona-orchestrator');
    log('  Skills live in ~/.codex/skills/<name>/SKILL.md');
  } else {
    log(`  ${gs}          ← read this first`);
  }

  log('');
  log('  Design — wireframes (new screens):');
  log(`    ${p}ux-ideator               two competing text wireframes + deliberation`);
  log(`    ${p}design-director          wireframe → DesignSpec → spec gates → build`);
  log(`    ${p}noor                     quick minimalist wireframe (Concept A)`);
  log(`    ${p}anuj                     power-user wireframe (Concept B)`);

  log('');
  log('  Evaluate — critique (existing designs):');
  log(`    ${p}kavi                     scan repo → knowledge bank (once per project)`);
  log(`    ${p}persona-orchestrator     MoE router + gates → SHIP / REVISE / BLOCK`);
  log(`    ${p}design-critic            4-persona critique + composite score`);
  log(`    ${p}deliberation-protocol    adversarial review rules (objections, Raj)`);
  log(`    ${p}devi                     host LLM: voice personas when CLI has no API keys`);

  log('');
  log('  CLI (host mode — no API keys):');
  log('    npx analyzthis_design collect');
  log('    npx analyzthis_design run --task "Review screen" --full');
  log('    npx analyzthis_design devi status');
  log('    npx analyzthis_design run --continue --task "..." --full');

  log('');
  log(`  Re-print anytime: npx analyzthis_design welcome --target ${targetId}`);
  log('  Docs: https://www.npmjs.com/package/analyzthis_design');
  log('  Repo: https://github.com/joshirishi/analyzthis_design\n');
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

function skillInstalledAt(root, layout, skill) {
  if (layout === 'dir') {
    return fs.existsSync(path.join(root, skill, 'SKILL.md')) || fs.existsSync(path.join(root, skill));
  }
  return fs.existsSync(path.join(root, `${skill}.md`));
}

function installOne(skill, root, layout, force) {
  if (skill === 'design-reference' || layout === 'dir') {
    return installDir(skill, root, force);
  }
  return installFlat(skill, root, force);
}

/** Install skills missing from any destination (safe upgrade path without --force). */
function installMissing(skill, destinations, force) {
  let status = 'skipped';
  for (const dest of destinations) {
    if (!force && skillInstalledAt(dest.root, dest.layout, skill)) continue;
    const result = installOne(skill, dest.root, dest.layout, force);
    if (result === 'installed') status = 'installed';
    else if (result === 'error') return 'error';
    else if (result === 'missing') return 'missing';
  }
  return status;
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

    for (const skill of SKILLS) {
      const result = installMissing(skill, destinations, force);
      if (result === 'installed') {
        installed.push(skill);
      } else if (result === 'skipped') {
        skipped.push(skill);
      } else if (result === 'missing') {
        warn(`  ⚠  Skill source not found: ${skill}`);
        errors.push(skill);
      } else {
        warn(`  ✗  Failed to install ${skill}`);
        errors.push(skill);
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
  const postTargets = listInstalledTargets();
  const targets = postTargets.length ? postTargets : ['cursor'];
  for (const tId of targets) {
    install({ silent, target: tId, showBanner: !silent && tId === 'cursor' });
  }
  if (forceWelcome || shouldShowWelcome()) {
    if (silent) {
      printWelcomeBanner('cursor');
      printWelcomeBanner('claude');
    }
    markWelcomeShown();
  }
}
