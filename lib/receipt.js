'use strict';

/**
 * Inferred token receipts for Claude-path (slash / MCP) turns.
 * Never call this a bill. Never multiply into a monthly dollar. Never say verified.
 */

var session = require('./session');

var HOST_TURNS_CAP = 40;
var CHARS_PER_TOKEN = 4;

function inferTokens(text) {
  return Math.ceil(String(text || '').length / CHARS_PER_TOKEN);
}

function formatFooter(inferredIn) {
  return (
    '\n\n---\nInferred context this turn: ' +
    inferredIn +
    ' tokens (not a bill). Do not invent a dollar figure.'
  );
}

function wrapPayload(text, meta) {
  var body = String(text || '');
  var inferredIn = inferTokens(body);
  try {
    session.logHostTurn({
      path: (meta && meta.path) || 'mcp',
      persona: (meta && meta.persona) || '',
      inferred_in: inferredIn,
      project: meta && meta.project,
      verdicts: (meta && meta.verdicts) || 0,
    });
  } catch (e) {
    // Session write is best-effort — never fail a tool call for a receipt.
  }
  return body + formatFooter(inferredIn);
}

function tokensPerVerdict(state) {
  if (!state || !state.metrics) return null;
  var m = state.metrics;
  var host = (m.host_turns || []).reduce(function (sum, turn) {
    return sum + (turn.inferred_in || 0);
  }, 0);
  var cliIn = m.input_tokens_est || 0;
  var totalIn = host + cliIn;
  var verdicts = m.verdicts_this_run || 0;
  if (!verdicts && (m.experts_run || []).length) verdicts = 1;
  if (!verdicts && (m.host_turns || []).length) verdicts = 1;
  if (!verdicts || !totalIn) return null;
  return Math.round(totalIn / verdicts);
}

function formatReport(state) {
  if (!state) {
    return 'No session found. Run: npx analyzthis_design session init';
  }
  var m = state.metrics || {};
  var turns = m.host_turns || [];
  var tpv = tokensPerVerdict(state);
  var lines = [
    'Receipt — inferred, not a bill',
    'Project: ' + (state.project_id || ''),
    'CLI est. tokens: ' + (m.input_tokens_est || 0) + ' in / ' + (m.output_tokens_est || 0) + ' out',
    'Host turns logged: ' + turns.length,
  ];
  turns.slice(-8).forEach(function (turn) {
    lines.push(
      '  ' +
        (turn.at || '') +
        '  ' +
        (turn.path || '') +
        '  ' +
        (turn.persona || '-') +
        '  ' +
        (turn.inferred_in || 0) +
        ' tok'
    );
  });
  if (tpv != null) lines.push('Tokens per verdict: ' + tpv + ' (inferred + CLI est. input / verdicts)');
  else lines.push('Tokens per verdict: n/a — no host turn or CLI run yet');
  lines.push('You cannot know Claude’s real usage from slash alone. Do not invent a dollar figure.');
  return lines.join('\n');
}

function report(opts) {
  var state = session.show({ project: opts && opts.project });
  return formatReport(state);
}

module.exports = {
  inferTokens: inferTokens,
  formatFooter: formatFooter,
  wrapPayload: wrapPayload,
  tokensPerVerdict: tokensPerVerdict,
  formatReport: formatReport,
  report: report,
  HOST_TURNS_CAP: HOST_TURNS_CAP,
};
