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

function appendLesson(personaId, lesson) {
  ensureLessonsDir();
  var file = personaLessonFile(personaId);
  fs.appendFileSync(file, JSON.stringify(lesson) + '\n');
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
  if (!entry || entry.accepted !== true) return [];

  var outcomeVal = 'unknown';
  if (state.outcome && state.outcome.confirmed && state.outcome.confirmed[personaId]) {
    outcomeVal = state.outcome.confirmed[personaId].value;
  } else if (state.outcome && state.outcome.inferred && state.outcome.inferred[personaId]) {
    outcomeVal = state.outcome.inferred[personaId].value;
  }

  var lessons = [];
  var text = entry.text || '';

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
          session_id: state.project_id,
          extracted_at: new Date().toISOString(),
          citation: entry.citations ? entry.citations[0] : ''
        });
      }
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
        session_id: state.project_id,
        extracted_at: new Date().toISOString(),
        citation: ''
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
      appendLesson(persona, lessons[j]);
      total++;
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
        appendLesson(pers, lessons[j]);
        total++;
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