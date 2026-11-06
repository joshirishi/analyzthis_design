#!/usr/bin/env node
'use strict';

// Runs the installer against a throwaway home and project, never the real ones.
var fs = require('fs');
var os = require('os');
var path = require('path');
var assert = require('assert');

var tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'install-test-')));
var home = path.join(tmp, 'home');
var project = path.join(tmp, 'project');
fs.mkdirSync(home);
fs.mkdirSync(project);
process.env.HOME = home;
process.chdir(project);

var install = require('../lib/install');
var SKILLS = path.join(__dirname, '..', 'skills');
var codex = path.join(home, '.codex', 'skills');
var cmds = path.join(project, '.claude', 'commands');
var read = function (f) { return fs.readFileSync(f, 'utf8'); };
var run = function () { install.install({ silent: true, target: 'codex' }); };
var backups = function () {
  var root = path.join(home, '.analyzthis_design', 'backups');
  return fs.existsSync(root) ? fs.readdirSync(root) : [];
};

// 1. Fresh install writes skills and project commands, including mood-board.
run();
var zara = path.join(codex, 'zara', 'SKILL.md');
assert.strictEqual(read(zara), read(path.join(SKILLS, 'zara', 'SKILL.md')));
assert.ok(fs.existsSync(path.join(cmds, 'mood-board.md')), 'mood-board is a project command');
assert.strictEqual(backups().length, 0, 'nothing to back up on a fresh install');

// 2. An outdated copy of ours is refreshed and the old text is backed up.
var oldZara = read(zara).replace(/\n# /, '\nOLD RULE: pick 3-5 frames.\n# ');
fs.writeFileSync(zara, oldZara);
var oldMood = '---\nname: mood-board\n---\nUI image board: pick 3-5 frames.\n';
fs.writeFileSync(path.join(cmds, 'mood-board.md'), oldMood);

// Older copies had no front matter; the matching first heading still marks them as ours.
var devi = path.join(codex, 'devi', 'SKILL.md');
fs.writeFileSync(devi, read(devi).replace(/^---[\s\S]*?---\n+/, '') + '\nold line\n');

// 3. A file that is not ours stays exactly as the user wrote it.
var mine = 'My own notes for Noor.\n';
fs.writeFileSync(path.join(cmds, 'noor.md'), mine);

// 4. A changed reference file counts as outdated even when SKILL.md matches.
var lens = path.join(codex, 'arjun', 'references', 'lens.md');
fs.writeFileSync(lens, 'stale lens');

run();
assert.strictEqual(read(zara), read(path.join(SKILLS, 'zara', 'SKILL.md')), 'zara refreshed');
assert.strictEqual(read(path.join(cmds, 'mood-board.md')), read(path.join(SKILLS, 'mood-board', 'SKILL.md')), 'project mood-board refreshed');
assert.strictEqual(read(path.join(cmds, 'noor.md')), mine, 'user file untouched');
assert.strictEqual(read(lens), read(path.join(SKILLS, 'arjun', 'references', 'lens.md')), 'lens refreshed');
assert.strictEqual(read(devi), read(path.join(SKILLS, 'devi', 'SKILL.md')), 'headerless old copy refreshed');

var stamps = backups();
assert.strictEqual(stamps.length, 1, 'one backup folder per run');
var saved = path.join(home, '.analyzthis_design', 'backups', stamps[0]);
assert.strictEqual(read(path.join(saved, zara)), oldZara, 'old zara saved');
assert.strictEqual(read(path.join(saved, cmds, 'mood-board.md')), oldMood, 'old project command saved');
assert.ok(!fs.existsSync(path.join(codex, 'zara.bak')), 'no backup inside the skills folder');

// 5. Running again with everything current changes nothing.
var before = fs.statSync(zara).mtimeMs;
run();
assert.strictEqual(fs.statSync(zara).mtimeMs, before, 'current copy not rewritten');

// 6. --force still overwrites the user's own file.
install.install({ silent: true, target: 'codex', force: true });
assert.strictEqual(read(path.join(cmds, 'noor.md')), read(path.join(SKILLS, 'noor', 'SKILL.md')));

fs.rmSync(tmp, { recursive: true, force: true });
console.log('ok  install refreshes outdated copies, keeps user files, backs up old ones');
