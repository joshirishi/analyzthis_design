#!/usr/bin/env node
'use strict';

// Checks keep / skip without a prior CLI run (slash-style stub).
var assert = require('assert');
var accept = require('../lib/accept');
var session = require('../lib/session');

var project = 'accept-test-' + Date.now();

session.init({ project: project });

var kept = accept.keep({ project: project, persona: 'zara' });
assert.strictEqual(kept.persona, 'zara');
assert.strictEqual(kept.kept, true);
assert.strictEqual(kept.shipped, true);

var state = session.show({ project: project });
assert.ok(state.persona_outputs.zara);
assert.strictEqual(state.persona_outputs.zara.accepted, true);
assert.strictEqual(state.outcome.confirmed.zara.value, 'shipped');

var fixed = accept.fix({
  project: project,
  persona: 'zara',
  because: 'too much motion on the daily table',
});
assert.strictEqual(fixed.kept, false);

state = session.show({ project: project });
assert.strictEqual(state.persona_outputs.zara.accepted, false);
assert.strictEqual(state.outcome.confirmed.zara.value, 'revised');
assert.ok(state.feedback_log.some(function (e) {
  return e.comment.indexOf('too much motion') !== -1;
}));

session.init({ project: project + '-infer' });
session.update({
  project: project + '-infer',
  patch: {
    metrics: {
      host_turns: [{ at: new Date().toISOString(), path: 'slash', persona: 'arjun', inferred_in: 10 }],
    },
  },
});
assert.strictEqual(session.inferLastPersona({ project: project + '-infer' }), 'arjun');

var peeked = accept.preview({ project: project + '-infer' });
assert.strictEqual(peeked.persona, 'arjun');

console.log('ok  accept keep / fix / infer');
