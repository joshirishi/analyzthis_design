'use strict';

/**
 * Format-aware output validation shared by normal runs and calibration.
 * Hard failures may trigger a bounded retry; warnings only affect quality score.
 */

var VERSION = 1;

var PERSONA_FORBIDDEN = {
  arjun: [/delight pass/i, /ARR impact/i],
  meera: [/color contrast/i, /typography scale/i, /WCAG/i],
  priya: [/delight moment/i, /north-star metric/i],
  zara: [/--color-primary/i, /contrast ratio/i, /fix the token/i],
};

function issue(code, message, hard) {
  return { code: code, message: message, hard: !!hard };
}

function validateOutput(text, opts) {
  opts = opts || {};
  text = typeof text === 'string' ? text.trim() : '';
  var format = String(opts.outputFormat || opts.format || 'generic').toLowerCase();
  var persona = String(opts.persona || '').toLowerCase();
  var issues = [];

  if (!text) issues.push(issue('empty', 'The model returned no text.', true));
  if (text && text.length < 40) issues.push(issue('too_short', 'The answer is too short to evaluate.', true));

  if (format === 'persona_lite' || format === 'lite') {
    if (!/##\s*[A-Za-z]+(?:\s*[—-]\s*Lite)?/i.test(text)) {
      issues.push(issue('missing_header', 'Missing persona output header.', false));
    }
    if (!/Top\s*2|fix|verdict|no delight needed/i.test(text)) {
      issues.push(issue('missing_action', 'Missing an actionable finding or verdict.', true));
    }
  } else if (format === 'ux_audit') {
    if (!/usab|access|hierarch|visual|UX/i.test(text)) {
      issues.push(issue('missing_audit', 'UX audit has no UX or visual assessment.', true));
    }
    if (!/fix|recommend|change|keep|revise|ship|block/i.test(text)) {
      issues.push(issue('missing_action', 'UX audit has no actionable conclusion.', true));
    }
  } else if (format === 'premise_assessment' || format === 'premise_check') {
    if (!/premise|problem|assumption|framing|right problem/i.test(text)) {
      issues.push(issue('missing_premise', 'Premise assessment does not examine the framing.', true));
    }
    if (!/proceed|change|reject|accept|revise|evidence/i.test(text)) {
      issues.push(issue('missing_decision', 'Premise assessment has no decision or evidence request.', true));
    }
  } else if (format === 'synthesis') {
    if (!/\b(SHIP|REVISE|BLOCK)\b/i.test(text)) {
      issues.push(issue('missing_verdict', 'Synthesis has no SHIP, REVISE, or BLOCK verdict.', true));
    }
    if (!/top\s*3|action|next step|fix/i.test(text)) {
      issues.push(issue('missing_actions', 'Synthesis has no next actions.', false));
    }
  }

  var forbidden = PERSONA_FORBIDDEN[persona] || [];
  for (var i = 0; i < forbidden.length; i++) {
    if (forbidden[i].test(text)) {
      issues.push(issue('forbidden_scope', 'The persona crossed into a forbidden scope.', true));
    }
  }

  var hardFailures = issues.filter(function(item) { return item.hard; });
  var warnings = issues.filter(function(item) { return !item.hard; });
  var score = Math.max(0, 1 - hardFailures.length * 0.35 - warnings.length * 0.1);
  return {
    version: VERSION,
    format: format,
    pass: hardFailures.length === 0,
    score: Number(score.toFixed(2)),
    issues: issues,
    hard_failures: hardFailures.length,
    warnings: warnings.length,
  };
}

function classifyError(error) {
  var message = String(error && error.message ? error.message : error || '');
  if (/429|rate.?limit|too many requests|quota/i.test(message)) return 'rate_limit';
  if (/timeout|timed out|ECONNRESET|ENOTFOUND|network|socket/i.test(message)) return 'transport';
  if (/401|403|unauthori|forbidden|api.?key/i.test(message)) return 'auth';
  return 'provider';
}

module.exports = {
  VERSION: VERSION,
  PERSONA_FORBIDDEN: PERSONA_FORBIDDEN,
  validateOutput: validateOutput,
  classifyError: classifyError,
};
