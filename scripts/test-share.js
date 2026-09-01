#!/usr/bin/env node
'use strict';

var assert = require('assert');
var accept = require('../lib/accept');
var share = require('../lib/share');
var session = require('../lib/session');

var project = 'share-test-' + Date.now();
session.init({ project: project });

var empty = share.preview({ project: project, all: false });
assert.strictEqual(empty.count, 0);

accept.fix({
  project: project,
  persona: 'zara',
  because: 'too much motion on the daily table',
});

var peek = share.preview({ project: project, all: false });
assert.ok(peek.count >= 1);
assert.strictEqual(peek.rows[0].persona, 'zara');
assert.ok(String(peek.rows[0].comment).indexOf('motion') !== -1);
assert.ok(peek.rows[0].comment.indexOf('/Users/') === -1);

var body = share.formatIssueBody(peek.rows);
assert.ok(body.indexOf('zara') !== -1);
assert.ok(body.indexOf('motion') !== -1);

var url = share.issueWebUrl('[feedback] zara: test', body);
assert.ok(url.indexOf('joshirishi/analyzthis_design') !== -1);
assert.ok(url.indexOf('persona-feedback') !== -1);

console.log('ok  share preview / redact / issue body');
