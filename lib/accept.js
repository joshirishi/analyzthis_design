'use strict';

/**
 * Designer keep / skip for evolution.
 * Slash /accept talks in yes/no. This module writes the session flags.
 */

var session = require('./session');
var feedback = require('./feedback');
var outcome = require('./outcome');

var PERSONA_IDS = session.PERSONA_IDS;

function resolvePersona(opts) {
  var raw = String(opts.persona || '').toLowerCase().trim();
  if (raw && PERSONA_IDS.indexOf(raw) === -1) {
    var err = new Error('Unknown persona. Use: ' + PERSONA_IDS.join(', '));
    err.code = 'BAD_PERSONA';
    throw err;
  }
  var id = raw || session.inferLastPersona({ project: opts.project });
  if (!id) {
    var need = new Error('NEED_PERSONA');
    need.code = 'NEED_PERSONA';
    throw need;
  }
  return id;
}

function keep(opts) {
  opts = opts || {};
  var persona = resolvePersona(opts);
  session.ensurePersonaOutput({
    project: opts.project,
    persona: persona,
    text: opts.note,
  });
  session.markAccepted({ project: opts.project, persona: persona, accepted: true });
  if (opts.comment) {
    feedback.recordFeedback({
      project: opts.project,
      persona: persona,
      satisfied: true,
      rating: 5,
      comment: opts.comment,
      correction: '',
      markRejected: false,
    });
  }
  var shipped = opts.shipped !== false;
  if (shipped) {
    outcome.confirmOutcome({ project: opts.project, persona: persona, outcome: 'shipped' });
  }
  return { persona: persona, kept: true, shipped: shipped };
}

function fix(opts) {
  opts = opts || {};
  var persona = resolvePersona(opts);
  var because = String(opts.because || opts.comment || '').trim();
  var correction = String(opts.correction || because).trim();
  if (!because) {
    var need = new Error('NEED_BECAUSE');
    need.code = 'NEED_BECAUSE';
    throw need;
  }
  session.ensurePersonaOutput({
    project: opts.project,
    persona: persona,
    text: opts.note,
  });
  feedback.recordFeedback({
    project: opts.project,
    persona: persona,
    satisfied: false,
    rating: opts.rating != null ? Number(opts.rating) : 2,
    comment: because,
    correction: correction,
    tags: opts.tags || ['other'],
    markRejected: true,
  });
  outcome.confirmOutcome({ project: opts.project, persona: persona, outcome: 'revised' });
  return { persona: persona, kept: false, because: because };
}

function preview(opts) {
  opts = opts || {};
  var state = session.show({ project: opts.project });
  return {
    persona: session.inferLastPersona({ project: opts.project }),
    hasSession: !!state,
  };
}

module.exports = { keep, fix, preview, PERSONA_IDS };
