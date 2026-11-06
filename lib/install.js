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

// Slash items written into the current project so /noor shows in the menu.
const PROJECT_COMMANDS = [
  'noor',
  'anuj',
  'arjun',
  'meera',
  'priya',
  'zara',
  'raj',
  'kavi',
  'ux-ideator',
  'design-director',
  'persona-orchestrator',
  'design-critic',
  'mood-board',
  'getting-started',
  'devi',
  'receipt',
  'accept',
  'share',
];

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
  'mood-board',
  'design-spec',
  'design-personas',
  'design-reference',
  'knowledge-bank',
  'receipt',
  'accept',
  'share',
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
  log('  Independent personas — type the name (even if the menu only shows Getting Started):');
  log(`    ${p}noor  ${p}anuj  ${p}arjun  ${p}meera  ${p}priya  ${p}zara  ${p}raj  ${p}kavi`);
  if (targetId === 'claude') {
    log('    Claude may only list Getting Started. Type /noor anyway.');
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
  log(`    ${p}accept                   keep or skip the last note (yes / no) — local evolution`);
  log(`    ${p}share                    send a correction to the package (preview, then yes)`);
  log(`    ${p}receipt                  inferred tokens for this project (not a bill)`);

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

// Old copies are kept outside every skills folder, or the host would load them as a second skill.
const BACKUP_ROOT = path.join(os.homedir(), '.analyzthis_design', 'backups');
let backupStamp = null;

function backupDir() {
  if (!backupStamp) backupStamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(BACKUP_ROOT, backupStamp);
}

function backUp(dest, isDir) {
  const target = path.join(backupDir(), dest.replace(/:/g, ''));
  if (isDir) copyDir(dest, target);
  else {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(dest, target);
  }
}

function sameBytes(a, b) {
  try {
    return fs.readFileSync(a).equals(fs.readFileSync(b));
  } catch {
    return false;
  }
}

/** True when every file the package ships for this skill already matches at dest. */
function dirMatches(src, dest) {
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    const same = entry.isDirectory() ? fs.existsSync(d) && dirMatches(s, d) : sameBytes(s, d);
    if (!same) return false;
  }
  return true;
}

function firstHeading(text) {
  const m = text.match(/^# .+$/m);
  return m ? m[0].trim() : null;
}

/**
 * A copy is ours when its front matter names the same skill, or (older copies had no front matter)
 * its first heading matches ours. Anything else belongs to the user.
 */
function isOurCopy(file, skill, srcFile) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    if (new RegExp(`^name:\\s*["']?${skill}["']?\\s*$`, 'm').test(text.slice(0, 800))) return true;
    const ours = firstHeading(fs.readFileSync(srcFile, 'utf8'));
    return Boolean(ours) && firstHeading(text) === ours;
  } catch {
    return false;
  }
}

/**
 * Write one copy. Returns installed | updated | current | skipped | missing | error.
 * Without --force an outdated copy of ours is backed up and refreshed; someone else's file is left alone.
 */
function placeCopy({ skill, src, dest, check, isDir, force }) {
  if (!fs.existsSync(src)) return 'missing';
  let action = 'installed';
  if (fs.existsSync(dest) && !force) {
    if (isDir ? dirMatches(src, dest) : sameBytes(src, dest)) return 'current';
    if (!isOurCopy(check, skill, isDir ? path.join(src, 'SKILL.md') : src)) return 'skipped';
    action = 'updated';
  }
  try {
    if (action === 'updated') backUp(dest, isDir);
    if (isDir) copyDir(src, dest);
    else {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
    }
    return action;
  } catch {
    return 'error';
  }
}

function installFlat(skill, skillsDir, force) {
  const dest = path.join(skillsDir, `${skill}.md`);
  const src = path.join(PACKAGE_SKILLS_DIR, skill, 'SKILL.md');
  return placeCopy({ skill, src, dest, check: dest, isDir: false, force });
}

function installDir(skill, skillsDir, force) {
  const dest = path.join(skillsDir, skill);
  const src = path.join(PACKAGE_SKILLS_DIR, skill);
  return placeCopy({ skill, src, dest, check: path.join(dest, 'SKILL.md'), isDir: true, force });
}

function installOne(skill, root, layout, force) {
  if (skill === 'design-reference' || layout === 'dir') {
    return installDir(skill, root, force);
  }
  return installFlat(skill, root, force);
}

// When one skill lands in several folders, report the most important thing that happened.
const STATUS_RANK = { current: 0, skipped: 1, updated: 2, installed: 3 };

function installEverywhere(skill, destinations, force) {
  let status = 'current';
  for (const dest of destinations) {
    const result = installOne(skill, dest.root, dest.layout, force);
    if (result === 'error' || result === 'missing') return result;
    if (STATUS_RANK[result] > STATUS_RANK[status]) status = result;
  }
  return status;
}

function installProjectCommands({ force = false, log = console.log } = {}) {
  const cwd = process.cwd();
  const roots = [
    path.join(cwd, '.claude', 'commands'),
    path.join(cwd, '.cursor', 'commands'),
  ];
  const installed = [];
  const updated = [];
  const skipped = [];
  for (const root of roots) {
    for (const skill of PROJECT_COMMANDS) {
      const result = installFlat(skill, root, force);
      const rel = `${path.relative(cwd, root)}/${skill}.md`;
      if (result === 'installed') installed.push(rel);
      else if (result === 'updated') updated.push(rel);
      else if (result === 'skipped') skipped.push(rel);
    }
  }
  if (installed.length > 0) {
    log(`\n✅ Project slash commands → ${path.join(cwd, '.claude/commands')} and .cursor/commands`);
    log('   Type /noor /arjun /ux-ideator in this repo. Restart the IDE if the menu is stale.');
  }
  if (updated.length > 0) {
    log(`\n🔄 Refreshed ${updated.length} outdated project command(s). Old copies saved in ${backupDir()}`);
  }
  if (skipped.length > 0) {
    log(`\n⏭  Left ${skipped.length} project command(s) alone — they are not our files (use --force to overwrite):`);
    for (const s of skipped) log(`   • ${s}`);
  }
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

    const installed = [], updated = [], current = [], skipped = [], errors = [];

    for (const skill of SKILLS) {
      const result = installEverywhere(skill, destinations, force);
      if (result === 'installed') {
        installed.push(skill);
      } else if (result === 'updated') {
        updated.push(skill);
      } else if (result === 'current') {
        current.push(skill);
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
    if (updated.length > 0) {
      log(`\n🔄 [${t.label}] Updated ${updated.length} outdated skill(s). Old copies saved in ${backupDir()}`);
      for (const s of updated) log(`   • ${s}`);
    }
    if (skipped.length > 0) {
      log(`\n⏭  [${t.label}] Left ${skipped.length} skill(s) alone — those files are not ours (use --force to overwrite):`);
      for (const s of skipped) log(`   • ${s}`);
    }
    if (current.length === SKILLS.length) {
      log(`\n✓  [${t.label}] All ${current.length} skills already up to date.`);
    }
    if (errors.length > 0) {
      log(`\n✗  [${t.label}] ${errors.length} skill(s) failed.`);
    }
    if (showBanner && !silent && errors.length < SKILLS.length) {
      printWelcomeBanner(tId, log);
    }

    // Auto-configure MCP server for supported hosts.
    if (tId === 'cursor' || tId === 'claude' || tId === 'windsurf') {
      try {
        const mcpServer = require('./mcp-server');
        mcpServer.writeMcpConfig(tId);
        log('  MCP server configured. Restart ' + t.label + ' to activate.\n');
      } catch (e) {
        // MCP config is best-effort — don't fail install if it doesn't work.
        warn('  ⚠  MCP not configured: ' + e.message);
      }
    }
  }

  installProjectCommands({ force, log });
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
  PROJECT_COMMANDS,
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
