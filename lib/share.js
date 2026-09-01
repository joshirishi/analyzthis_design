'use strict';

/**
 * Designer share — send local corrections back to the published package.
 * Slash /share talks in yes/no. HTTP submit if configured; else GitHub issue.
 */

var { spawnSync } = require('child_process');
var accept = require('./accept');
var submit = require('./feedback-submit');

var REPO = 'joshirishi/analyzthis_design';
var ISSUE_NEW = 'https://github.com/' + REPO + '/issues/new';

function preview(opts) {
  opts = opts || {};
  var cfg = submit.resolveSubmitConfig();
  var entries = submit.collectUnsentEntries({
    project: opts.project,
    all: !!opts.all,
    persona: opts.persona,
  });
  var rows = entries.map(function (e) {
    var payload = submit.entryToSubmitPayload(e, cfg);
    return {
      id: e.id,
      persona: payload.persona,
      comment: payload.user_comment,
      correction: payload.assistant_preferred,
    };
  });
  return {
    count: rows.length,
    rows: rows,
    hasHttp: !!(cfg.url && cfg.anonKey),
    endpoint: cfg.url || '',
    consent: !!(submit.loadConsent() && submit.loadConsent().opted_in),
  };
}

function formatIssueBody(rows) {
  var lines = [
    'Shared from `/share` (designer keep/skip). Redacted. No paths, emails, or keys.',
    '',
  ];
  rows.forEach(function (r, i) {
    lines.push('### ' + (i + 1) + '. ' + r.persona);
    if (r.comment) lines.push('**What was wrong:** ' + r.comment);
    if (r.correction) lines.push('**What we did instead:** ' + r.correction);
    lines.push('');
  });
  return lines.join('\n');
}

function issueWebUrl(title, body) {
  return ISSUE_NEW
    + '?labels=persona-feedback'
    + '&title=' + encodeURIComponent(title)
    + '&body=' + encodeURIComponent(body);
}

function tryGithubIssue(title, body) {
  var created = spawnSync(
    'gh',
    ['issue', 'create', '--repo', REPO, '--title', title, '--label', 'persona-feedback', '--body', body],
    { encoding: 'utf8', timeout: 20000 }
  );
  if (created.status === 0 && created.stdout) {
    return { ok: true, url: created.stdout.trim() };
  }
  return { ok: false, error: (created.stderr || created.stdout || 'gh failed').trim() };
}

async function send(opts) {
  opts = opts || {};
  var because = String(opts.because || opts.comment || '').trim();
  if (because) {
    accept.fix({
      project: opts.project,
      persona: opts.persona,
      because: because,
      correction: opts.correction || because,
    });
  }

  var peek = preview(opts);
  if (!peek.count) {
    var empty = new Error('NOTHING');
    empty.code = 'NOTHING';
    throw empty;
  }

  if (peek.hasHttp) {
    var result = await submit.submitFeedback({
      project: opts.project,
      all: !!opts.all,
      persona: opts.persona,
      yes: true,
    });
    return {
      sent: result.submitted || 0,
      via: 'http',
      url: result.endpoint || '',
      message: result.message,
    };
  }

  var title = '[feedback] ' + peek.rows[0].persona + ': ' + (peek.rows[0].comment || 'correction').slice(0, 72);
  var body = formatIssueBody(peek.rows);
  var gh = tryGithubIssue(title, body);
  if (gh.ok) {
    submit.markEntriesSubmitted(peek.rows.map(function (r) { return r.id; }));
    return {
      sent: peek.count,
      via: 'github',
      url: gh.url,
      message: 'Opened a GitHub issue so the package can learn.',
    };
  }

  return {
    sent: 0,
    via: 'github-link',
    url: issueWebUrl(title, body),
    title: title,
    body: body,
    message: 'Could not open GitHub from here. Use the link — nothing secret is in it.',
  };
}

module.exports = { preview, send, formatIssueBody, issueWebUrl, REPO };
