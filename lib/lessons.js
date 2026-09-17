'use strict';

var fs = require('fs');
var path = require('path');
var os = require('os');
var session = require('./session');
var cache = require('./cache');

var LESSONS_ROOT = path.join(os.homedir(), '.analyzthis_design', 'lessons');

function ensureLessonsDir() {
  fs.mkdirSync(LESSONS_ROOT, { recursive: true });
}

function personaLessonFile(personaId) {
  return path.join(LESSONS_ROOT, personaId + '.jsonl');
}

function loadLessons(personaId) {
  var file = personaLessonFile(personaId);
  if (!fs.existsSync(file)) return [];
  var text = fs.readFileSync(file, 'utf8');
  var lines = text.trim().split('\n').filter(function(l) { return l.trim(); });
  var lessons = [];
  for (var i = 0; i < lines.length; i++) {
    try {
      lessons.push(JSON.parse(lines[i]));
    } catch (e) {
      // skip corrupt lines
    }
  }
  return lessons;
}

function lessonKey(lesson) {
  return [lesson.persona, lesson.session_id, lesson.polarity || '', lesson.pattern].join('|');
}

/**
 * Append unless an identical lesson already exists. Lessons now feed scoring
 * (+10 each), and extractLessons runs on every keep/skip, so re-marking the
 * same note must not inflate a persona's score.
 * @returns {boolean} true if written
 */
function appendLesson(personaId, lesson) {
  ensureLessonsDir();
  var file = personaLessonFile(personaId);
  var key = lessonKey(lesson);
  var existing = loadLessons(personaId);
  for (var i = 0; i < existing.length; i++) {
    if (lessonKey(existing[i]) === key) return false;
  }
  fs.appendFileSync(file, JSON.stringify(lesson) + '\n');
  return true;
}

function keywordOverlap(a, b) {
  var wordsA = (a || '').toLowerCase().split(/\W+/).filter(function(w) { return w.length > 2; });
  var wordsB = (b || '').toLowerCase().split(/\W+/).filter(function(w) { return w.length > 2; });
  var setA = {};
  for (var i = 0; i < wordsA.length; i++) setA[wordsA[i]] = true;
  var overlap = 0;
  for (var j = 0; j < wordsB.length; j++) {
    if (setA[wordsB[j]]) overlap++;
  }
  return overlap;
}

function extractLessonsFromSession(state, personaId) {
  var entry = state.persona_outputs && state.persona_outputs[personaId];
  // Learn from rejections too — a correction is the most informative signal
  // we get. accepted === null means the designer never reacted; skip those.
  if (!entry || entry.accepted === null || entry.accepted === undefined) return [];
  var polarity = entry.accepted === true ? 'positive' : 'negative';

  var outcomeVal = 'unknown';
  if (state.outcome && state.outcome.confirmed && state.outcome.confirmed[personaId]) {
    outcomeVal = state.outcome.confirmed[personaId].value;
  } else if (state.outcome && state.outcome.inferred && state.outcome.inferred[personaId]) {
    outcomeVal = state.outcome.inferred[personaId].value;
  }

  var lessons = [];
  var text = entry.text || '';
  var attribution = entry.attribution || null;
  var runId = entry.run_id || null;

  var fixesMatch = text.match(/Top\s*2\s*fixes:[\s\S]*?(?:\n\n|```|$)/i);
  if (fixesMatch) {
    var lines = fixesMatch[0].split('\n');
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      var m = line.match(/^\d+\.\s*(.+)$/);
      if (m) {
        var fix = m[1].trim();
        var pattern = fix;
        lessons.push({
          id: require('crypto').randomBytes(6).toString('hex'),
          persona: personaId,
          task_type: state.task_type || '',
          pattern: pattern,
          fix: fix,
          outcome: outcomeVal,
          polarity: polarity,
          session_id: state.project_id,
          extracted_at: new Date().toISOString(),
          citation: entry.citations ? entry.citations[0] : ''
          ,attribution: attribution
          ,run_id: runId
        });
      }
    }
  }

  // A rejection carries the designer's own correction — the highest-value
  // lesson available. Pull it from the most recent negative feedback entry.
  if (polarity === 'negative') {
    var log = state.feedback_log || [];
    for (var f = log.length - 1; f >= 0; f--) {
      if (log[f].persona !== personaId || log[f].satisfied !== false) continue;
      var corrective = String(log[f].correction || log[f].comment || '').trim();
      if (!corrective) break;
      lessons.push({
        id: require('crypto').randomBytes(6).toString('hex'),
        persona: personaId,
        task_type: state.task_type || '',
        pattern: 'Designer rejected this note: ' + corrective,
        fix: corrective,
        outcome: outcomeVal,
        polarity: 'negative',
        session_id: state.project_id,
        extracted_at: new Date().toISOString(),
        citation: ''
        ,attribution: attribution
        ,run_id: runId
      });
      break;
    }
  }

  var hierarchyMatch = text.match(/Hierarchy\[([A-F])\]/gi);
  if (hierarchyMatch) {
    for (var j = 0; j < hierarchyMatch.length; j++) {
      var pattern2 = 'Visual hierarchy issue: ' + hierarchyMatch[j];
      lessons.push({
        id: require('crypto').randomBytes(6).toString('hex'),
        persona: personaId,
        task_type: state.task_type || '',
        pattern: pattern2,
        fix: 'Review visual hierarchy per DS tokens',
        outcome: outcomeVal,
        polarity: polarity,
        session_id: state.project_id,
        extracted_at: new Date().toISOString(),
        citation: ''
        ,attribution: attribution
        ,run_id: runId
      });
    }
  }

  return lessons;
}

function extractLessons(opts) {
  var project = opts.project;
  var persona = opts.persona;

  var projectIds = project ? [project] : session.listProjects();
  var total = 0;

  for (var i = 0; i < projectIds.length; i++) {
    var pid = projectIds[i];
    var state = session.show({ project: pid });
    if (!state) continue;

    var lessons = extractLessonsFromSession(state, persona);
    for (var j = 0; j < lessons.length; j++) {
      if (appendLesson(persona, lessons[j])) total++;
    }
  }

  return { extracted: total, persona: persona };
}

function extractAllLessons(opts) {
  var windowDays = opts.windowDays || 7;
  var cutoff = Date.now() - (windowDays * 24 * 60 * 60 * 1000);
  var projectIds = session.listProjects();
  var total = 0;
  var personas = ['arjun', 'meera', 'priya', 'zara', 'noor', 'anuj', 'raj'];

  for (var i = 0; i < projectIds.length; i++) {
    var pid = projectIds[i];
    var state = session.show({ project: pid });
    if (!state) continue;
    if (state.updated_at && new Date(state.updated_at).getTime() < cutoff) continue;

    for (var p = 0; p < personas.length; p++) {
      var pers = personas[p];
      var lessons = extractLessonsFromSession(state, pers);
      for (var j = 0; j < lessons.length; j++) {
        if (appendLesson(pers, lessons[j])) total++;
      }
    }
  }

  return { extracted: total, windowDays: windowDays };
}

function retrieveLessons(opts) {
  var task = opts.task || '';
  var personaId = opts.personaId;
  var limit = opts.limit || 3;

  if (!personaId) return { lessons: [], cacheHit: false };

  var cacheKey = 'lessons:' + personaId + ':' + require('crypto').createHash('sha1').update(task).digest('hex').slice(0, 12);
  var cached = cache.get(cacheKey);
  if (cached) return { lessons: cached, cacheHit: true };

  var allLessons = loadLessons(personaId);
  if (!allLessons.length) return { lessons: [], cacheHit: false };

  var scored = allLessons.map(function(lesson) {
    var overlap = keywordOverlap(task, lesson.pattern + ' ' + lesson.fix + ' ' + lesson.task_type);
    return { lesson: lesson, score: overlap };
  });

  scored.sort(function(a, b) { return b.score - a.score; });

  var top = scored.slice(0, limit).map(function(s) { return s.lesson; });
  cache.set(cacheKey, top);
  return { lessons: top, cacheHit: false };
}

function buildLessonsInjection(lessons) {
  if (!lessons || !lessons.length) return '';
  var lines = ['Past lessons for this persona on similar tasks:'];
  for (var i = 0; i < lessons.length; i++) {
    var l = lessons[i];
    lines.push((i + 1) + '. [' + l.pattern + '] \u2192 [' + l.fix + '] (outcome: ' + l.outcome + ')');
  }
  return lines.join('\n');
}

function stats() {
  var personas = ['arjun', 'meera', 'priya', 'zara', 'noor', 'anuj', 'raj'];
  var perPersona = {};
  var total = 0;
  for (var i = 0; i < personas.length; i++) {
    var p = personas[i];
    var count = loadLessons(p).length;
    perPersona[p] = count;
    total += count;
  }
  return { totalLessons: total, perPersona: perPersona };
}

module.exports = {
  extractLessons: extractLessons,
  extractAllLessons: extractAllLessons,
  retrieveLessons: retrieveLessons,
  buildLessonsInjection: buildLessonsInjection,
  stats: stats,
  loadLessons: loadLessons,
  LESSONS_ROOT: LESSONS_ROOT
};