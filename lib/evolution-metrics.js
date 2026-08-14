'use strict';

/**
 * Evolution metrics — track how much each persona has evolved.
 *
 * Computes per-persona evolution scores based on:
 * - Lessons extracted
 * - Outcomes confirmed (shipped/revised/blocked/missed)
 * - Prompt patches applied
 * - Reference rows added
 * - Router patches proposed/applied
 *
 * CommonJS, 'use strict', var.
 */

var fs = require('fs');
var path = require('path');
var os = require('os');
var session = require('./session');

var LESSONS_ROOT = path.join(os.homedir(), '.analyzthis_design', 'lessons');
var EVOLUTION_ROOT = path.join(os.homedir(), '.analyzthis_design', 'evolution');

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  var content = fs.readFileSync(filePath, 'utf8').trim();
  if (!content) return [];
  return content.split('\n').map(function(line) {
    try { return JSON.parse(line); } catch (e) { return null; }
  }).filter(Boolean);
}

function listJsonFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(function(f) { return f.endsWith('.json'); });
}

/**
 * Compute evolution metrics for all personas in a project.
 * @param {string} projectId
 * @returns {object} Per-persona evolution metrics + aggregate
 */
function computeEvolutionMetrics(projectId) {
  var state = session.show({ project: projectId }) || {};
  var personas = ['arjun', 'meera', 'priya', 'zara', 'noor', 'anuj', 'raj'];
  var metrics = {};
  var totalLessons = 0;
  var totalOutcomes = 0;
  var totalPatches = 0;
  var totalApplied = 0;

  for (var i = 0; i < personas.length; i++) {
    var persona = personas[i];
    var lessons = readJsonl(path.join(LESSONS_ROOT, persona + '.jsonl'));
    var lessonsCount = lessons.length;

    // Count confirmed outcomes for this persona
    var outcomesCount = 0;
    if (state.outcome && state.outcome.confirmed) {
      for (var pid in state.outcome.confirmed) {
        if (pid === persona) outcomesCount++;
      }
    }
    if (state.outcome && state.outcome.inferred) {
      for (var pid2 in state.outcome.inferred) {
        if (pid2 === persona) outcomesCount++;
      }
    }

    // Count patches for this persona
    var patchesCount = 0;
    var appliedCount = 0;
    var patchFiles = listJsonFiles(EVOLUTION_ROOT);
    for (var j = 0; j < patchFiles.length; j++) {
      try {
        var patch = JSON.parse(fs.readFileSync(path.join(EVOLUTION_ROOT, patchFiles[j]), 'utf8'));
        if (patch.persona === persona) {
          patchesCount++;
          if (patch.applied === true || (patch.dry_run === false && patch.type !== 'router')) {
            appliedCount++;
          }
        }
      } catch (e) { /* ignore */ }
    }

    var lessonScore = Math.min(lessonsCount * 10, 100); // 10 pts per lesson, cap 100
    var outcomeScore = Math.min(outcomesCount * 15, 100); // 15 pts per outcome
    var patchScore = Math.min(patchesCount * 20, 100); // 20 pts per patch
    var appliedBonus = appliedCount * 25; // bonus for applied patches

    var totalScore = Math.min(lessonScore + outcomeScore + patchScore + appliedBonus, 100);

    var level = 'Novice';
    if (totalScore >= 80) level = 'Expert';
    else if (totalScore >= 60) level = 'Advanced';
    else if (totalScore >= 40) level = 'Proficient';
    else if (totalScore >= 20) level = 'Developing';

    metrics[persona] = {
      score: totalScore,
      level: level,
      lessons: lessonsCount,
      outcomes: outcomesCount,
      patches_proposed: patchesCount,
      patches_applied: appliedCount,
      lesson_score: lessonScore,
      outcome_score: outcomeScore,
      patch_score: patchScore,
      applied_bonus: appliedBonus,
    };

    totalLessons += lessonsCount;
    totalOutcomes += outcomesCount;
    totalPatches += patchesCount;
    totalApplied += appliedCount;
  }

  var avgScore = 0;
  for (var p in metrics) avgScore += metrics[p].score;
  avgScore = personas.length ? Math.round(avgScore / personas.length) : 0;

  return {
    personas: metrics,
    aggregate: {
      average_score: avgScore,
      total_lessons: totalLessons,
      total_outcomes: totalOutcomes,
      total_patches_proposed: totalPatches,
      total_patches_applied: totalApplied,
      evolution_level: avgScore >= 80 ? 'Expert Team' : avgScore >= 60 ? 'Advanced Team' : avgScore >= 40 ? 'Proficient Team' : avgScore >= 20 ? 'Developing Team' : 'Novice Team',
    },
  };
}

/**
 * Format evolution metrics for Devi's prompt.
 * @param {object} metrics - Output of computeEvolutionMetrics
 * @returns {string} Human-readable summary
 */
function formatEvolutionSummary(metrics) {
  var lines = [];
  lines.push('-- Team Evolution Status --');
  lines.push('');
  lines.push('Overall: ' + metrics.aggregate.evolution_level + ' (avg score: ' + metrics.aggregate.average_score + '/100)');
  lines.push('  Lessons: ' + metrics.aggregate.total_lessons + ' | Outcomes: ' + metrics.aggregate.total_outcomes + ' | Patches: ' + metrics.aggregate.total_patches_proposed + ' proposed, ' + metrics.aggregate.total_patches_applied + ' applied');
  lines.push('');

  for (var persona in metrics.personas) {
    var m = metrics.personas[persona];
    var filled = Math.floor(m.score / 10);
    var bar = '';
    for (var b = 0; b < 10; b++) { bar += b < filled ? '#' : '.'; }
    lines.push('  ' + persona + ': ' + m.level + ' (' + m.score + '/100) [' + bar + ']');
    lines.push('    Lessons: ' + m.lessons + ' | Outcomes: ' + m.outcomes + ' | Patches: ' + m.patches_proposed + ' (' + m.patches_applied + ' applied)');
  }
  lines.push('');
  return lines.join('\n');
  lines.push('');
  return lines.join('\n');
}

/**
 * Check if evolution is ready to run (has enough data).
 * @param {string} projectId
 * @returns {object} { ready: boolean, reason: string, metrics: object }
 */
function checkEvolutionReady(projectId) {
  var metrics = computeEvolutionMetrics(projectId);
  var totalLessons = metrics.aggregate.total_lessons;
  var totalOutcomes = metrics.aggregate.total_outcomes;

  // Need at least 5 lessons for a prompt patch, 10 outcomes for router patch
  var minLessons = 5;
  var minOutcomes = 10;

  if (totalLessons >= minLessons || totalOutcomes >= minOutcomes) {
    return {
      ready: true,
      reason: 'Enough data accumulated (' + totalLessons + ' lessons, ' + totalOutcomes + ' outcomes). Evolution can propose patches.',
      metrics: metrics,
    };
  }

  return {
    ready: false,
    reason: 'Need more data: ' + totalLessons + '/' + minLessons + ' lessons, ' + totalOutcomes + '/' + minOutcomes + ' outcomes.',
    metrics: metrics,
  };
}

module.exports = {
  computeEvolutionMetrics: computeEvolutionMetrics,
  formatEvolutionSummary: formatEvolutionSummary,
  checkEvolutionReady: checkEvolutionReady,
  LESSONS_ROOT: LESSONS_ROOT,
  EVOLUTION_ROOT: EVOLUTION_ROOT,
};