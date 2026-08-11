'use strict';

var fs = require('fs');
var path = require('path');
var os = require('os');
var crypto = require('crypto');
var session = require('./session');
var lessons = require('./lessons');
var outcome = require('./outcome');

var EVOLUTION_DIR = path.join(os.homedir(), '.analyzthis_design', 'evolution');

function ensureEvolutionDir() {
  fs.mkdirSync(EVOLUTION_DIR, { recursive: true });
}

function generatePatchId() {
  return crypto.randomBytes(6).toString('hex');
}

function loadCard(personaId) {
  var { resolvePackageRoot } = require('./platforms');
  var PACKAGE_ROOT = resolvePackageRoot(__dirname);
  var cardPath = path.join(PACKAGE_ROOT, 'agents', 'cards', personaId + '.md');
  if (!fs.existsSync(cardPath)) return '';
  return fs.readFileSync(cardPath, 'utf8');
}

function loadSkill(personaId) {
  var { resolvePackageRoot } = require('./platforms');
  var PACKAGE_ROOT = resolvePackageRoot(__dirname);
  var skillPath = path.join(PACKAGE_ROOT, 'skills', personaId, 'SKILL.md');
  if (!fs.existsSync(skillPath)) return '';
  return fs.readFileSync(skillPath, 'utf8');
}

function clusterLessons(lessonList) {
  var clusters = [];
  for (var i = 0; i < lessonList.length; i++) {
    var l = lessonList[i];
    var patternWords = (l.pattern || '').toLowerCase().split(/\W+/).filter(function(w) { return w.length > 3; });
    var matched = false;
    for (var j = 0; j < clusters.length; j++) {
      var c = clusters[j];
      var overlap = patternWords.filter(function(w) {
        return (c.centerWords || []).indexOf(w) !== -1;
      }).length;
      if (overlap >= 2) {
        c.items.push(l);
        matched = true;
        break;
      }
    }
    if (!matched) {
      clusters.push({
        centerWords: patternWords.slice(0, 5),
        items: [l]
      });
    }
  }
  return clusters.filter(function(c) { return c.items.length >= 2; });
}

function proposePromptPatch(personaId, lessonList, dryRun) {
  var clusters = clusterLessons(lessonList);
  if (!clusters.length) return null;

  var topCluster = clusters.sort(function(a, b) { return b.items.length - a.items.length; })[0];
  var clusterPatterns = topCluster.items.map(function(l) { return l.pattern; }).slice(0, 3);
  var clusterFixes = topCluster.items.map(function(l) { return l.fix; }).slice(0, 3);

  var card = loadCard(personaId);
  var skill = loadSkill(personaId);
  var newFailurePattern = '- **' + clusterPatterns[0] + '** — ' + clusterFixes.join('; ') + ' (lesson cluster ' + topCluster.items.length + 'x)';

  var patch = {
    id: generatePatchId(),
    type: 'prompt',
    persona: personaId,
    description: 'Add canonical failure pattern based on ' + topCluster.items.length + ' lessons',
    target_files: ['skills/' + personaId + '/SKILL.md', 'agents/cards/' + personaId + '.md'],
    card_original: card.slice(0, 2000),
    card_addition: newFailurePattern,
    skill_original: skill.slice(0, 2000),
    skill_addition: newFailurePattern,
    dry_run: dryRun
  };

  ensureEvolutionDir();
  fs.writeFileSync(path.join(EVOLUTION_DIR, patch.id + '.json'), JSON.stringify(patch, null, 2));
  return patch;
}

function proposeReferenceRow(personaId, lessonList, dryRun) {
  if (!lessonList.length) return null;

  var fileMap = {
    arjun: 'styles.csv',
    zara: 'colors.csv',
    meera: 'products.csv',
    noor: 'ux-guidelines.csv',
    anuj: 'ux-guidelines.csv',
    priya: 'react-performance.csv'
  };

  var targetFile = fileMap[personaId];
  if (!targetFile) return null;

  var sampleLesson = lessonList[0];
  var row = {
    No: 'auto',
    Product_Type: sampleLesson.task_type || 'general',
    Pattern: sampleLesson.pattern,
    Fix: sampleLesson.fix,
    Outcome: sampleLesson.outcome
  };

  var patch = {
    id: generatePatchId(),
    type: 'reference',
    persona: personaId,
    description: 'Propose new reference row in ' + targetFile,
    target_file: 'skills/design-reference/' + targetFile,
    row: row,
    dry_run: dryRun
  };

  ensureEvolutionDir();
  fs.writeFileSync(path.join(EVOLUTION_DIR, patch.id + '.json'), JSON.stringify(patch, null, 2));
  return patch;
}

function proposeRouterPatch(outcomes, dryRun) {
  if (!outcomes || !outcomes.length) return [];

  var byTaskType = {};
  for (var i = 0; i < outcomes.length; i++) {
    var o = outcomes[i];
    if (!byTaskType[o.task_type]) byTaskType[o.task_type] = {};
    if (!byTaskType[o.task_type][o.persona]) byTaskType[o.task_type][o.persona] = { good: 0, bad: 0 };
    if (o.outcome === 'shipped' || o.outcome === 'blocked_correctly' || o.outcome === 'revised') {
      byTaskType[o.task_type][o.persona].good++;
    } else if (o.outcome === 'missed') {
      byTaskType[o.task_type][o.persona].bad++;
    }
  }

  var patches = [];
  var taskTypes = Object.keys(byTaskType);
  for (var t = 0; t < taskTypes.length; t++) {
    var tt = taskTypes[t];
    var personas = Object.keys(byTaskType[tt]);
    var best = null;
    var bestScore = -1;
    for (var p = 0; p < personas.length; p++) {
      var pers = personas[p];
      var score = byTaskType[tt][pers].good - byTaskType[tt][pers].bad;
      if (score > bestScore) {
        bestScore = score;
        best = pers;
      }
    }
    if (best) {
      var patch = {
        id: generatePatchId(),
        type: 'router',
        task_type: tt,
        description: 'Route ' + tt + ' primarily to ' + best + ' based on outcomes',
        suggested_route_to: [best],
        dry_run: dryRun
      };
      ensureEvolutionDir();
      fs.writeFileSync(path.join(EVOLUTION_DIR, patch.id + '.json'), JSON.stringify(patch, null, 2));
      patches.push(patch);
    }
  }

  return patches;
}

function collectOutcomes() {
  var projectIds = session.listProjects();
  var outcomes = [];
  for (var i = 0; i < projectIds.length; i++) {
    var pid = projectIds[i];
    var state = session.show({ project: pid });
    if (!state || !state.outcome) continue;

    var personas = Object.keys(state.persona_outputs || {});
    for (var p = 0; p < personas.length; p++) {
      var pers = personas[p];
      var val = (state.outcome.confirmed && state.outcome.confirmed[pers]) || (state.outcome.inferred && state.outcome.inferred[pers]);
      if (val) {
        outcomes.push({
          project_id: pid,
          persona: pers,
          task_type: state.task_type || '',
          outcome: val.value
        });
      }
    }
  }
  return outcomes;
}

function runEvolution(opts) {
  opts = opts || {};
  var windowDays = opts.windowDays || 7;
  var dryRun = opts.dryRun !== false;

  var lessonsResult = lessons.extractAllLessons({ windowDays: windowDays });
  var outcomeResult = outcome.inferAllOutcomes({ windowDays: windowDays });

  var promptPatches = [];
  var referenceProposals = [];
  var personas = ['arjun', 'meera', 'priya', 'zara', 'noor', 'anuj', 'raj'];

  for (var i = 0; i < personas.length; i++) {
    var pers = personas[i];
    var list = lessons.loadLessons ? lessons.loadLessons(pers) : [];
    if (!list.length && lessons.retrieveLessons) {
      list = lessons.retrieveLessons({ task: '', personaId: pers, limit: 100 }).lessons;
    }

    if (list.length >= 5) {
      var promptPatch = proposePromptPatch(pers, list, dryRun);
      if (promptPatch) promptPatches.push(promptPatch);

      var refPatch = proposeReferenceRow(pers, list, dryRun);
      if (refPatch) referenceProposals.push(refPatch);
    }
  }

  var allOutcomes = collectOutcomes();
  var routerPatches = proposeRouterPatch(allOutcomes, dryRun);

  return {
    extracted_lessons: lessonsResult.extracted,
    inferred_outcomes: outcomeResult.inferred,
    prompt_patches: promptPatches,
    reference_proposals: referenceProposals,
    router_patches: routerPatches,
    dry_run: dryRun
  };
}

function applyPatch(opts) {
  opts = opts || {};
  var patchId = opts.patchId;
  var dryRun = !!opts.dryRun;
  if (!patchId) throw new Error('--apply requires a patch id');

  var file = path.join(EVOLUTION_DIR, patchId + '.json');
  if (!fs.existsSync(file)) throw new Error('Patch not found: ' + patchId);

  var patch = JSON.parse(fs.readFileSync(file, 'utf8'));
  var { resolvePackageRoot } = require('./platforms');
  var PACKAGE_ROOT = resolvePackageRoot(__dirname);

  if (patch.type === 'prompt') {
    var targetFile = path.join(PACKAGE_ROOT, 'skills', patch.persona, 'SKILL.md');
    var existing = fs.existsSync(targetFile) ? fs.readFileSync(targetFile, 'utf8') : '';
    var insertionPoint = existing.indexOf('## Failure modes to avoid');
    if (insertionPoint === -1) insertionPoint = existing.length;
    var updated = existing.slice(0, insertionPoint) + '\n\n## Canonical failure pattern (auto-suggested)\n\n' + patch.skill_addition + '\n\n' + existing.slice(insertionPoint);
    if (!dryRun) fs.writeFileSync(targetFile, updated);
    return { applied: !dryRun, targetFile, preview: dryRun ? updated : null };
  }

  if (patch.type === 'reference') {
    var refFile = path.join(PACKAGE_ROOT, patch.target_file);
    var row = patch.row;
    var line = Object.values(row).join(',') + '\n';
    if (!dryRun) fs.appendFileSync(refFile, line);
    return { applied: !dryRun, targetFile: refFile, preview: dryRun ? line : null };
  }

  if (patch.type === 'router') {
    return { applied: false, message: 'Router patches require manual review. Suggested route_to for ' + patch.task_type + ': ' + patch.suggested_route_to.join(', ') };
  }

  return { applied: false, message: 'Unknown patch type' };
}

module.exports = {
  runEvolution: runEvolution,
  proposePromptPatch: proposePromptPatch,
  proposeReferenceRow: proposeReferenceRow,
  proposeRouterPatch: proposeRouterPatch,
  applyPatch: applyPatch,
  EVOLUTION_DIR: EVOLUTION_DIR
};