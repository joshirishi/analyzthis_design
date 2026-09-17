'use strict';

/**
 * Evolution metrics — how much each persona is worth listening to.
 *
 * Scores are SIGNED. A persona starts at BASELINE (50) and moves in both
 * directions, so a rejection actually costs something. Contributions:
 *
 *   outcome    shipped +15 | blocked_correctly +10 | revised -5 | missed -15
 *   feedback   (rating - 3) * 4   →  5* = +8 ... 1* = -8
 *   lessons    +10 each, positive-polarity only
 *   patches    +20 proposed, +25 applied
 *
 * Scores are DERIVED, never stored — changing the weights re-scores history
 * on the next read with no migration.
 *
 * Scope is GLOBAL per persona by default: lessons and patches are already
 * global on disk, and outcomes are aggregated across every project. Pass
 * { project } to scope down for debugging.
 *
 * CommonJS, 'use strict', var.
 */

var fs = require('fs');
var path = require('path');
var os = require('os');
var session = require('./session');

var LESSONS_ROOT = path.join(os.homedir(), '.analyzthis_design', 'lessons');
var EVOLUTION_ROOT = path.join(os.homedir(), '.analyzthis_design', 'evolution');

// Must match session.PERSONA_IDS — accept.js will happily record a note for
// any of them, and anything scored-but-not-accepted (or vice versa) silently
// drops designer feedback on the floor.
var PERSONAS = require('./session').PERSONA_IDS.slice();

var BASELINE = 50;

// Minimum signals (outcomes + feedback) before a score may leave the
// Baseline band. Without this, one bad note brands a persona "At risk"
// and Devi over-corrects on noise.
var MIN_EVIDENCE = 5;

// Ceiling on the lessons/patches bonus, so accumulated history can never
// make a persona immune to recent failures.
var BONUS_CAP = 12;

var OUTCOME_POINTS = {
  shipped: 15,
  blocked_correctly: 10,
  revised: -5,
  missed: -15,
};

var BANDS = [
  { min: 80, name: 'Trusted' },
  { min: 60, name: 'Reliable' },
  { min: 40, name: 'Baseline' },
  { min: 20, name: 'Developing' },
  { min: 0, name: 'At risk' },
];

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  var content = fs.readFileSync(filePath, 'utf8').trim();
  if (!content) return [];
  return content.split('\n').map(function (line) {
    try { return JSON.parse(line); } catch (e) { return null; }
  }).filter(Boolean);
}

function listJsonFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(function (f) { return f.endsWith('.json'); });
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function bandFor(score) {
  for (var i = 0; i < BANDS.length; i++) {
    if (score >= BANDS[i].min) return BANDS[i].name;
  }
  return 'At risk';
}

/**
 * Load every patch once, so callers don't re-read the directory per persona.
 */
function loadPatches() {
  var files = listJsonFiles(EVOLUTION_ROOT);
  var patches = [];
  for (var i = 0; i < files.length; i++) {
    try {
      patches.push(JSON.parse(fs.readFileSync(path.join(EVOLUTION_ROOT, files[i]), 'utf8')));
    } catch (e) { /* skip unreadable patch */ }
  }
  return patches;
}

function patchIsApplied(patch) {
  return patch.applied === true || patch.dry_run === false;
}

/**
 * Collect outcome + feedback signals for one persona across the given projects.
 */
function collectSignals(projectIds, persona) {
  var outcomes = [];   // { value, source }
  var ratings = [];    // numbers
  var byModel = {};

  function modelBucket(attribution) {
    var id = attribution && (attribution.model_id ||
      (attribution.provider && attribution.model && attribution.provider + '/' + attribution.model));
    id = id || 'unknown/unknown';
    if (!byModel[id]) byModel[id] = { outcomes: 0, ratings: 0, rating_total: 0 };
    return byModel[id];
  }

  for (var i = 0; i < projectIds.length; i++) {
    var state = session.show({ project: projectIds[i] });
    if (!state) continue;

    var confirmed = (state.outcome && state.outcome.confirmed) || {};
    var inferred = (state.outcome && state.outcome.inferred) || {};

    // A confirmed outcome supersedes an inferred one for the same persona.
    if (confirmed[persona] && confirmed[persona].value) {
      outcomes.push({ value: confirmed[persona].value, source: 'confirmed' });
      modelBucket(confirmed[persona].attribution).outcomes++;
    } else if (inferred[persona] && inferred[persona].value) {
      outcomes.push({ value: inferred[persona].value, source: 'inferred' });
      modelBucket(inferred[persona].attribution).outcomes++;
    }

    var log = state.feedback_log || [];
    for (var j = 0; j < log.length; j++) {
      if (log[j].persona !== persona) continue;
      if (log[j].rating == null) continue;
      ratings.push(Number(log[j].rating));
      var bucket = modelBucket(log[j].attribution);
      bucket.ratings++;
      bucket.rating_total += Number(log[j].rating);
    }
  }

  Object.keys(byModel).forEach(function(id) {
    var item = byModel[id];
    item.evidence_count = item.outcomes + item.ratings;
    item.avg_rating = item.ratings ? Math.round((item.rating_total / item.ratings) * 10) / 10 : null;
    item.sufficient_evidence = item.evidence_count >= MIN_EVIDENCE;
    delete item.rating_total;
  });
  return { outcomes: outcomes, ratings: ratings, by_model: byModel };
}

/**
 * Compute evolution metrics.
 * @param {object|string} [opts] - { project, global } or a bare projectId (legacy)
 * @returns {object} { personas, aggregate }
 */
function computeEvolutionMetrics(opts) {
  // Legacy call shape: computeEvolutionMetrics('project-id')
  if (typeof opts === 'string') opts = { project: opts, global: false };
  opts = opts || {};

  var useGlobal = opts.global !== false && !opts.project;
  var projectIds;
  if (useGlobal) {
    projectIds = session.listProjects();
  } else {
    projectIds = [opts.project || session.getProjectId()].filter(Boolean);
  }

  var patches = loadPatches();
  var metrics = {};
  var totalLessons = 0;
  var totalOutcomes = 0;
  var totalPatches = 0;
  var totalApplied = 0;

  // Team-level patches (router) belong to nobody in particular.
  var teamPatches = patches.filter(function (p) { return !p.persona; });

  for (var i = 0; i < PERSONAS.length; i++) {
    var persona = PERSONAS[i];

    var lessons = readJsonl(path.join(LESSONS_ROOT, persona + '.jsonl'));
    var positiveLessons = lessons.filter(function (l) {
      if (l.polarity) return l.polarity === 'positive';
      // Legacy lessons carry no polarity — fall back to the outcome value.
      return l.outcome === 'shipped' || l.outcome === 'blocked_correctly';
    });

    var signals = collectSignals(projectIds, persona);

    var personaPatches = patches.filter(function (p) { return p.persona === persona; });
    var appliedPatches = personaPatches.filter(patchIsApplied);

    // ── Signed contributions ──
    var lessonPoints = positiveLessons.length * 10;

    var outcomePoints = 0;
    var outcomeBreakdown = { shipped: 0, blocked_correctly: 0, revised: 0, missed: 0 };
    for (var o = 0; o < signals.outcomes.length; o++) {
      var val = signals.outcomes[o].value;
      if (OUTCOME_POINTS[val] === undefined) continue;
      outcomePoints += OUTCOME_POINTS[val];
      outcomeBreakdown[val] = (outcomeBreakdown[val] || 0) + 1;
    }

    var feedbackPoints = 0;
    for (var r = 0; r < signals.ratings.length; r++) {
      feedbackPoints += (signals.ratings[r] - 3) * 4;
    }
    var avgRating = signals.ratings.length
      ? Math.round((signals.ratings.reduce(function (a, b) { return a + b; }, 0) / signals.ratings.length) * 10) / 10
      : null;

    var patchPoints = personaPatches.length * 20;
    var appliedPoints = appliedPatches.length * 25;

    // Score on the RATE of good outcomes, not an unbounded sum. A running total
    // saturates: bank enough early wins and later failures cannot move a
    // persona off 100. Averaging per signal keeps recent behaviour visible
    // forever, which is the whole point of punishing a bad note.
    var signalCount = signals.outcomes.length + signals.ratings.length;
    var signalPoints = outcomePoints + feedbackPoints;
    var avgSignal = signalCount ? (signalPoints / signalCount) : 0;

    // avgSignal spans about [-15, +15]; map onto 0-100 around the baseline.
    var base = BASELINE + (avgSignal / 15) * 50;

    // Accumulated lessons and patches are a real but secondary signal — cap
    // their contribution so they can never re-introduce saturation.
    var bonus = Math.min((lessonPoints + patchPoints + appliedPoints) * 0.25, BONUS_CAP);

    var rawScore = base + bonus;
    var score = clamp(Math.round(rawScore), 0, 100);

    // ── Evidence gating ──
    var evidenceCount = signals.outcomes.length + signals.ratings.length;
    var sufficient = evidenceCount >= MIN_EVIDENCE;
    var level;
    if (sufficient) {
      level = bandFor(score);
    } else {
      // Not enough signal to make a claim either way.
      level = 'Baseline';
      score = clamp(score, 40, 59);
    }

    metrics[persona] = {
      score: score,
      raw_score: Math.round(rawScore),
      level: level,
      sufficient_evidence: sufficient,
      evidence_count: evidenceCount,
      lessons: lessons.length,
      lessons_positive: positiveLessons.length,
      outcomes: signals.outcomes.length,
      outcome_breakdown: outcomeBreakdown,
      ratings: signals.ratings.length,
      avg_rating: avgRating,
      model_breakdown: signals.by_model,
      patches_proposed: personaPatches.length,
      patches_applied: appliedPatches.length,
      avg_signal: Math.round(avgSignal * 10) / 10,
      contributions: {
        baseline: BASELINE,
        avg_signal: Math.round(avgSignal * 10) / 10,
        from_rate: Math.round((base - BASELINE) * 10) / 10,
        bonus: Math.round(bonus * 10) / 10,
        raw_outcomes: outcomePoints,
        raw_feedback: feedbackPoints,
        raw_lessons: lessonPoints,
      },
    };

    totalLessons += lessons.length;
    totalOutcomes += signals.outcomes.length;
    totalPatches += personaPatches.length;
    totalApplied += appliedPatches.length;
  }

  var sum = 0;
  for (var p in metrics) sum += metrics[p].score;
  var avgScore = PERSONAS.length ? Math.round(sum / PERSONAS.length) : 0;

  return {
    personas: metrics,
    aggregate: {
      average_score: avgScore,
      evolution_level: bandFor(avgScore),
      total_lessons: totalLessons,
      total_outcomes: totalOutcomes,
      total_patches_proposed: totalPatches + teamPatches.length,
      total_patches_applied: totalApplied + teamPatches.filter(patchIsApplied).length,
      team_patches: teamPatches.length,
      scope: useGlobal ? 'global' : projectIds.join(', '),
      projects_scanned: projectIds.length,
    },
  };
}

/**
 * Human-readable dashboard. Shows the signed breakdown so a designer can see
 * WHY a persona fell, not just that it did.
 */
function formatEvolutionSummary(metrics) {
  var lines = [];
  lines.push('-- Team Evolution Status --');
  lines.push('');
  lines.push('Overall: ' + metrics.aggregate.evolution_level + ' (avg ' + metrics.aggregate.average_score + '/100)');
  lines.push('  Scope: ' + metrics.aggregate.scope + ' | Lessons: ' + metrics.aggregate.total_lessons +
    ' | Outcomes: ' + metrics.aggregate.total_outcomes +
    ' | Patches: ' + metrics.aggregate.total_patches_proposed + ' proposed, ' +
    metrics.aggregate.total_patches_applied + ' applied');
  lines.push('');

  for (var persona in metrics.personas) {
    var m = metrics.personas[persona];
    var filled = Math.floor(m.score / 10);
    var bar = '';
    for (var b = 0; b < 10; b++) { bar += b < filled ? '#' : '.'; }

    var label = m.level + (m.sufficient_evidence ? '' : ' (insufficient evidence)');
    var scoreCell = pad(m.score + '/100', 8);
    lines.push('  ' + pad(persona, 9) + scoreCell + pad(label, 33) + '[' + bar + ']');

    var parts = [];
    var ob = m.outcome_breakdown;
    if (ob.shipped) parts.push('shipped ' + ob.shipped + ' (+' + (ob.shipped * 15) + ')');
    if (ob.blocked_correctly) parts.push('blocked ' + ob.blocked_correctly + ' (+' + (ob.blocked_correctly * 10) + ')');
    if (ob.revised) parts.push('revised ' + ob.revised + ' (-' + (ob.revised * 5) + ')');
    if (ob.missed) parts.push('missed ' + ob.missed + ' (-' + (ob.missed * 15) + ')');
    if (m.avg_rating != null) {
      parts.push('ratings avg ' + m.avg_rating + ' (' + signed(m.contributions.raw_feedback) + ')');
    }
    if (m.lessons_positive) parts.push('lessons ' + m.lessons_positive);
    if (m.patches_proposed) parts.push('patches ' + m.patches_proposed);

    lines.push('            ' + (parts.length ? parts.join(' · ') : 'no signals yet'));
    lines.push('            ' + m.evidence_count + ' signal' + (m.evidence_count === 1 ? '' : 's') +
      (m.sufficient_evidence ? ' — enough to act on' : ' — need ' + MIN_EVIDENCE + ' to act on'));
  }
  lines.push('');
  return lines.join('\n');
}

function pad(s, n) {
  s = String(s);
  while (s.length < n) s += ' ';
  return s;
}

function signed(n) {
  return (n >= 0 ? '+' : '') + n;
}

/**
 * Compact scoreboard injected into Devi's system prompt. Advisory only.
 * Personas without enough evidence are omitted rather than guessed at.
 */
function formatScoreboardForDevi(metrics) {
  var rows = [];
  for (var persona in metrics.personas) {
    var m = metrics.personas[persona];
    if (!m.sufficient_evidence) continue;
    if (m.level === 'Baseline') continue;

    var why;
    var ob = m.outcome_breakdown;
    if (m.level === 'Trusted' || m.level === 'Reliable') {
      why = ob.shipped ? ob.shipped + ' shipped' : 'positive feedback';
    } else {
      why = (ob.missed ? ob.missed + ' missed' : '') +
            (ob.missed && ob.revised ? ', ' : '') +
            (ob.revised ? ob.revised + ' revised' : '') ||
            'low ratings';
    }
    rows.push('  ' + pad(persona, 8) + pad(m.level, 12) + why);
  }

  if (!rows.length) return '';

  return [
    'Team scoreboard (advisory — from designer feedback on past runs):',
    rows.join('\n'),
    'Lean on Trusted/Reliable personas and discount At risk ones when you synthesise,',
    'and say so in one line. Do NOT drop any persona from the run.',
  ].join('\n');
}

/**
 * Check if evolution is ready to run (has enough data).
 */
function checkEvolutionReady(projectId) {
  var metrics = computeEvolutionMetrics(projectId ? { project: projectId } : undefined);
  var totalLessons = metrics.aggregate.total_lessons;
  var totalOutcomes = metrics.aggregate.total_outcomes;

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
  formatScoreboardForDevi: formatScoreboardForDevi,
  checkEvolutionReady: checkEvolutionReady,
  PERSONAS: PERSONAS,
  BASELINE: BASELINE,
  MIN_EVIDENCE: MIN_EVIDENCE,
  BONUS_CAP: BONUS_CAP,
  OUTCOME_POINTS: OUTCOME_POINTS,
  LESSONS_ROOT: LESSONS_ROOT,
  EVOLUTION_ROOT: EVOLUTION_ROOT,
};
