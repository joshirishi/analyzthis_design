#!/usr/bin/env node
'use strict';

/**
 * Quality check for persona LLM outputs vs skill + deliberation-protocol expectations.
 * Usage: node scripts/quality-check.js [--session path] [--project id]
 */

const fs = require('fs');
const path = require('path');
const session = require('../lib/session');
const deliberation = require('../lib/deliberation');

const EXPECTED = {
  arjun: {
    liteHeader: /##\s*Arjun\s*[—-]\s*Lite/i,
    scorePattern: /(\d+(?:\.\d+)?)\s*\/\s*5/,
    grades: /Useful\[[A-F]\]/i,
    forbidden: [/delight pass/i, /ARR impact/i],
  },
  meera: {
    liteHeader: /##\s*Meera\s*[—-]\s*Lite/i,
    scorePattern: /Score:\s*\[?(\d+(?:\.\d+)?)/i,
    required: [/metric impact/i, /hierarchy check/i],
    forbidden: [/color contrast/i, /typography scale/i, /WCAG/i],
  },
  priya: {
    liteHeader: /##\s*Priya\s*[—-]\s*Lite/i,
    scorePattern: /Score:\s*\[?(\d+(?:\.\d+)?)/i,
    required: [/Effort:/i],
    forbidden: [/delight moment/i, /north-star metric/i],
  },
  zara: {
    liteHeader: /##\s*Zara\s*[—-]\s*Lite|no delight needed here/i,
    forbidden: [/--color-primary/i, /contrast ratio/i, /fix the token/i],
  },
  raj: {
    header: /Raj|Stalemate Resolution/i,
  },
};

const VALID_VERDICTS = new Set(['CONTEST', 'ACCEPT', 'SHIP', 'REVISE', 'BLOCK']);

function checkDeliberationJson(personaId, text, parsed, { isReviewRound = true } = {}) {
  const issues = [];
  const passes = [];

  if (parsed.parse_error === 'no_json_fence') {
    issues.push({ severity: 'fail', rule: 'deliberation_json', msg: 'Missing ```json deliberation fence — parser used fallback inference' });
  } else if (parsed.parse_error) {
    issues.push({ severity: 'fail', rule: 'deliberation_json', msg: `JSON parse error: ${parsed.parse_error}` });
  } else {
    passes.push('deliberation_json: valid fenced block');
  }

  if (!VALID_VERDICTS.has(parsed.verdict)) {
    issues.push({ severity: 'fail', rule: 'verdict', msg: `Invalid verdict: ${parsed.verdict}` });
  } else {
    passes.push(`verdict: ${parsed.verdict}`);
  }

  if (typeof parsed.satisfaction_with_prior !== 'number' || parsed.satisfaction_with_prior < 0 || parsed.satisfaction_with_prior > 1) {
    issues.push({ severity: 'fail', rule: 'satisfaction', msg: 'satisfaction_with_prior must be 0.0–1.0' });
  } else {
    passes.push(`satisfaction: ${parsed.satisfaction_with_prior}`);
  }

  if (isReviewRound && personaId !== 'arjun' && parsed.satisfaction_with_prior > 0.85 && parsed.accepts_prior) {
    issues.push({ severity: 'warn', rule: 'adversarial', msg: 'Review round too easily satisfied — protocol default is low satisfaction until evidence' });
  }

  if (parsed.objections.length) {
    for (const [i, obj] of parsed.objections.entries()) {
      if (!obj.target_persona) issues.push({ severity: 'fail', rule: 'objection', msg: `Objection ${i}: missing target_persona` });
      if (!obj.claim || obj.claim.length < 10) issues.push({ severity: 'fail', rule: 'objection', msg: `Objection ${i}: claim too vague` });
      if (!obj.grounded_in) issues.push({ severity: 'fail', rule: 'objection', msg: `Objection ${i}: missing grounded_in (mandatory per protocol)` });
      if (!obj.evidence_required) issues.push({ severity: 'warn', rule: 'objection', msg: `Objection ${i}: missing evidence_required` });
    }
    passes.push(`objections: ${parsed.objections.length} with grounding`);
  }

  if (parsed.grounding.length) {
    passes.push(`grounding: ${parsed.grounding.length} citations`);
  } else if (parsed.objections.length && isReviewRound) {
    issues.push({ severity: 'warn', rule: 'grounding', msg: 'Objections present but grounding[] empty' });
  }

  if (isReviewRound && !parsed.questions?.length && personaId !== 'zara') {
    issues.push({ severity: 'warn', rule: 'questions', msg: 'Review round should ask ≥1 contextual question (protocol)' });
  } else if (parsed.questions?.length) {
    passes.push(`questions: ${parsed.questions.length}`);
  }

  // Generic handoff detection
  if (/therefore,?\s*(arjun|meera|priya|zara)\s*(scored|said|found)/i.test(text)) {
    issues.push({ severity: 'fail', rule: 'no_handoff', msg: 'Generic handoff paragraph detected — forbidden by deliberation-protocol' });
  }

  return { issues, passes };
}

function checkPersonaSchema(personaId, text) {
  const spec = EXPECTED[personaId];
  if (!spec) return { issues: [], passes: [] };
  const issues = [];
  const passes = [];

  if (spec.liteHeader && !spec.liteHeader.test(text)) {
    issues.push({ severity: 'warn', rule: 'lite_schema', msg: `Missing expected lite header for ${personaId}` });
  } else if (spec.liteHeader) {
    passes.push('lite_schema: header present');
  }

  if (spec.header && !spec.header.test(text)) {
    issues.push({ severity: 'warn', rule: 'schema', msg: `Missing expected header for ${personaId}` });
  }

  if (spec.scorePattern && !spec.scorePattern.test(text)) {
    issues.push({ severity: 'warn', rule: 'score', msg: 'No extractable score' });
  } else if (spec.scorePattern) {
    passes.push('score: present');
  }

  if (spec.grades && spec.grades.test(text)) passes.push('grades: honeycomb present');

  for (const req of spec.required || []) {
    if (!req.test(text)) issues.push({ severity: 'warn', rule: 'required_field', msg: `Missing required pattern: ${req}` });
    else passes.push(`required: ${req}`);
  }

  for (const forb of spec.forbidden || []) {
    if (forb.test(text)) issues.push({ severity: 'fail', rule: 'forbidden_scope', msg: `Persona crossed scope: matched ${forb}` });
  }

  return { issues, passes };
}

function checkSession(state) {
  const report = {
    personas: {},
    deliberation: {},
    summary: { pass: 0, warn: 0, fail: 0 },
  };

  const outputs = state.persona_outputs || {};
  for (const [id, entry] of Object.entries(outputs)) {
    const text = entry.text || '';
    const parsed = entry.deliberation || deliberation.parseDeliberationOutput(text);
    const isReview = !text.includes('PRODUCE MODE');
    const schema = checkPersonaSchema(id, text);
    const delib = checkDeliberationJson(id, text, parsed, { isReviewRound: isReview });
    const issues = [...schema.issues, ...delib.issues];
    const passes = [...schema.passes, ...delib.passes];
    for (const i of issues) report.summary[i.severity] += 1;
    report.personas[id] = { issues, passes, satisfaction: parsed.satisfaction_with_prior, verdict: parsed.verdict };
    report.summary.pass += passes.length;
  }

  const d = state.deliberation || {};
  if (d.mode === 'adversarial') {
    report.deliberation.mode = d.mode;
    report.deliberation.rounds = (d.round_log || []).length;
    report.deliberation.consensus = d.consensus_reached;
    report.deliberation.raj = d.raj_escalated;
    if (!d.round_log?.length) {
      report.summary.fail += 1;
      report.deliberation.issues = ['No round_log in session deliberation block'];
    } else {
      report.deliberation.passes = [`round_log: ${d.round_log.length} entries`];
    }
  }

  const m = state.metrics || {};
  report.metrics = {
    llm_calls: m.llm_calls,
    deliberation_rounds: m.deliberation_rounds,
    objections_raised: m.objections_raised,
    raj_escalations: m.raj_escalations,
  };

  return report;
}

function printReport(report) {
  console.log('\n╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║  QUALITY CHECK — Expected vs Actual                                  ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝\n');

  for (const [id, data] of Object.entries(report.personas)) {
    console.log(`── ${id.toUpperCase()} (satisfaction=${data.satisfaction}, verdict=${data.verdict}) ──`);
    for (const p of data.passes) console.log(`  ✓ ${p}`);
    for (const i of data.issues) {
      const icon = i.severity === 'fail' ? '✗' : '⚠';
      console.log(`  ${icon} [${i.rule}] ${i.msg}`);
    }
    console.log('');
  }

  console.log('── DELIBERATION ENGINE ──');
  console.log(`  mode=${report.deliberation.mode} rounds=${report.deliberation.rounds} consensus=${report.deliberation.consensus} raj=${report.deliberation.raj}`);
  if (report.deliberation.passes) report.deliberation.passes.forEach((p) => console.log(`  ✓ ${p}`));
  if (report.deliberation.issues) report.deliberation.issues.forEach((i) => console.log(`  ✗ ${i}`));

  console.log('\n── METRICS ──');
  console.log(`  ${JSON.stringify(report.metrics)}`);

  const { pass, warn, fail } = report.summary;
  const total = pass + warn + fail;
  console.log(`\n── SUMMARY: ${fail} fail, ${warn} warn, ${pass} pass checks ──`);
  if (fail === 0 && warn <= 2) console.log('  Overall: PASS (meets adversarial protocol expectations)');
  else if (fail === 0) console.log('  Overall: PASS WITH WARNINGS');
  else console.log('  Overall: FAIL — see issues above');

  return report;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const get = (n) => {
    const i = args.indexOf(`--${n}`);
    return i !== -1 && args[i + 1] ? args[i + 1] : null;
  };
  const sessionPath = get('session');
  let state;
  if (sessionPath) {
    state = JSON.parse(fs.readFileSync(path.resolve(sessionPath), 'utf8'));
  } else {
    state = session.show({ project: get('project') });
    if (!state) {
      console.error('No session found. Run scripts/run-live-quality.js first or pass --session path');
      process.exit(1);
    }
  }
  printReport(checkSession(state));
}

module.exports = { checkSession, checkDeliberationJson, checkPersonaSchema, printReport };
