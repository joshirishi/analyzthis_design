'use strict';

var fs = require('fs');
var path = require('path');
var os = require('os');
var session = require('./session');
var crypto = require('crypto');

function inferOutcome(opts) {
  var project = opts.project || session.getProjectId();
  var persona = opts.persona;

  var state = session.show({ project: project });
  if (!state) {
    return { inferred: 'unknown', confidence: 0, reason: 'No session found' };
  }

  var entry = state.persona_outputs && state.persona_outputs[persona];
  if (!entry) {
    return { inferred: 'unknown', confidence: 0, reason: 'No output for persona' };
  }

  var allProjects = session.listProjects();
  var currentIdx = allProjects.indexOf(project);
  if (currentIdx === -1 || currentIdx === allProjects.length - 1) {
    return { inferred: 'unknown', confidence: 0, reason: 'No subsequent session to compare' };
  }

  var nextProject = allProjects[currentIdx + 1];
  var nextState = session.show({ project: nextProject });
  if (!nextState) {
    return { inferred: 'unknown', confidence: 0, reason: 'Next session not found' };
  }

  var currentDsAtRisk = (state.digest && state.digest.ds_at_risk) || [];
  var nextDsAtRisk = (nextState.digest && nextState.digest.ds_at_risk) || [];

  var sameDsIssues = currentDsAtRisk.filter(function(item) {
    return nextDsAtRisk.indexOf(item) !== -1;
  });

  var nextVerdict = nextState.synthesis && nextState.synthesis.verdict;
  var nextFeedback = nextState.feedback_log || [];
  var negativeFeedback = nextFeedback.filter(function(f) {
    return f.persona === persona && f.satisfied === false;
  });

  if (nextVerdict === 'SHIP' && sameDsIssues.length === 0 && negativeFeedback.length === 0) {
    return {
      inferred: 'shipped',
      confidence: 0.7,
      reason: 'Next session SHIP with no recurring DS issues or negative feedback'
    };
  }

  if (nextVerdict === 'REVISE' && sameDsIssues.length > 0) {
    return {
      inferred: 'missed',
      confidence: 0.6,
      reason: 'Next session REVISE with same DS issues persisting: ' + sameDsIssues.join(', ')
    };
  }

  if (nextVerdict === 'BLOCK' && sameDsIssues.length > 0) {
    return {
      inferred: 'blocked_correctly',
      confidence: 0.6,
      reason: 'Next session BLOCK on same issues'
    };
  }

  if (negativeFeedback.length > 0) {
    return {
      inferred: 'missed',
      confidence: 0.5,
      reason: 'Negative feedback in next session'
    };
  }

  return { inferred: 'unknown', confidence: 0, reason: 'Could not determine outcome' };
}

function inferAllOutcomes(opts) {
  var windowDays = opts.windowDays || 7;
  var cutoff = Date.now() - (windowDays * 24 * 60 * 60 * 1000);
  var projectIds = session.listProjects();
  var inferred = 0;
  var confirmed = 0;
  var unknown = 0;
  var personas = ['arjun', 'meera', 'priya', 'zara', 'noor', 'anuj', 'raj'];

  for (var i = 0; i < projectIds.length; i++) {
    var pid = projectIds[i];
    var state = session.show({ project: pid });
    if (!state) continue;
    if (state.updated_at && new Date(state.updated_at).getTime() < cutoff) continue;

    for (var p = 0; p < personas.length; p++) {
      var pers = personas[p];
      var entry = state.persona_outputs && state.persona_outputs[pers];
      if (!entry || entry.accepted !== true) continue;

      var hasConfirmed = state.outcome && state.outcome.confirmed && state.outcome.confirmed[pers];
      var hasInferred = state.outcome && state.outcome.inferred && state.outcome.inferred[pers];

      if (hasConfirmed) {
        confirmed++;
        continue;
      }

      var result = inferOutcome({ project: pid, persona: pers });
      if (result.inferred !== 'unknown') {
        var outcomePatch = {
          inferred: { ...(state.outcome && state.outcome.inferred ? state.outcome.inferred : {}) },
          confirmed: { ...(state.outcome && state.outcome.confirmed ? state.outcome.confirmed : {}) },
        };
        outcomePatch.inferred[pers] = {
          value: result.inferred,
          confidence: result.confidence,
          reason: result.reason,
          at: new Date().toISOString()
        };
        session.update({ project: pid, patch: { outcome: outcomePatch } });
        inferred++;
      } else {
        unknown++;
      }
    }
  }

  return { inferred: inferred, confirmed: confirmed, unknown: unknown };
}

function confirmOutcome(opts) {
  var project = opts.project || session.getProjectId();
  var persona = opts.persona;
  var outcome = opts.outcome;

  var validOutcomes = ['shipped', 'revised', 'blocked_correctly', 'missed'];
  if (validOutcomes.indexOf(outcome) === -1) {
    throw new Error('Invalid outcome. Must be one of: ' + validOutcomes.join(', '));
  }

  var state = session.show({ project: project });
  if (!state) throw new Error('No session found');

  var outcomePatch = {
    inferred: { ...(state.outcome && state.outcome.inferred ? state.outcome.inferred : {}) },
    confirmed: { ...(state.outcome && state.outcome.confirmed ? state.outcome.confirmed : {}) },
  };
  outcomePatch.confirmed[persona] = {
    value: outcome,
    at: new Date().toISOString()
  };
  delete outcomePatch.inferred[persona];

  session.update({ project: project, patch: { outcome: outcomePatch } });
  return { updated: true };
}

function listPendingConfirmations() {
  var projectIds = session.listProjects();
  var pending = [];

  for (var i = 0; i < projectIds.length; i++) {
    var pid = projectIds[i];
    var state = session.show({ project: pid });
    if (!state || !state.outcome || !state.outcome.inferred) continue;

    var inferred = state.outcome.inferred;
    var confirmed = state.outcome.confirmed || {};

    for (var persona in inferred) {
      if (inferred[persona] && !confirmed[persona]) {
        pending.push({
          project: pid,
          persona: persona,
          inferred: inferred[persona].value,
          reason: inferred[persona].reason
        });
      }
    }
  }

  return pending;
}

module.exports = {
  inferOutcome: inferOutcome,
  inferAllOutcomes: inferAllOutcomes,
  confirmOutcome: confirmOutcome,
  listPendingConfirmations: listPendingConfirmations
};