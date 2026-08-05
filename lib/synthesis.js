'use strict';

/**
 * Phase 5 composite synthesis — design-critic output block from persona_outputs.
 */

const deliberation = require('./deliberation');

const CRITIQUE_PERSONAS = ['arjun', 'meera', 'priya', 'zara'];

function extractScore(text) {
  if (!text) return null;
  const m = text.match(/(\d+(?:\.\d+)?)\s*\/\s*5/)
    || text.match(/Combined score:\s*(\d+(?:\.\d+)?)/i)
    || text.match(/Score:\s*\[?(\d+(?:\.\d+)?)/i);
  return m ? Number(m[1]) : null;
}

function parseHierarchyCheck(meeraText) {
  if (!meeraText) return 'unknown';
  if (/does not match/i.test(meeraText)) return 'does not match';
  if (/hierarchy check:\s*matches/i.test(meeraText)) return 'matches';
  return 'unknown';
}

function parseVisualHierarchyGrade(arjunText) {
  if (!arjunText) return null;
  const m = arjunText.match(/Hierarchy\[([A-F])\]/i);
  return m ? m[1].toUpperCase() : null;
}

function gradeBelowC(grade) {
  if (!grade) return false;
  return ['D', 'E', 'F'].includes(grade.toUpperCase());
}

function verdictFromTotal(total, rajText) {
  const rajParsed = rajText ? deliberation.parseDeliberationOutput(rajText) : null;
  if (rajParsed?.verdict && ['SHIP', 'REVISE', 'BLOCK'].includes(rajParsed.verdict)) {
    return rajParsed.verdict;
  }
  if (total >= 16) return 'SHIP';
  if (total >= 10) return 'REVISE';
  return 'BLOCK';
}

function collectRevisions(personaOutputs) {
  const items = [];
  for (const [id, out] of Object.entries(personaOutputs || {})) {
    const revs = out.deliberation?.revisions || [];
    for (const r of revs) {
      items.push({ change: r, assigned: id.charAt(0).toUpperCase() + id.slice(1) });
    }
    const fixes = (out.text || '').match(/Top 2 fixes:\s*1\.\s*([^\n]+)/i);
    if (fixes) items.push({ change: fixes[1].trim(), assigned: id.charAt(0).toUpperCase() + id.slice(1) });
  }
  const seen = new Set();
  return items.filter((i) => {
    const k = i.change.slice(0, 60);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Build composite synthesis markdown + structured object.
 */
function buildSynthesis(personaOutputs, opts = {}) {
  const scores = {};
  let total = 0;
  let counted = 0;

  for (const id of CRITIQUE_PERSONAS) {
    const out = personaOutputs[id];
    if (!out) continue;
    if (id === 'zara' && /no delight needed/i.test(out.text || '')) {
      scores.zara = 'N/A';
      continue;
    }
    const s = extractScore(out.text);
    if (s != null) {
      scores[id] = s;
      total += s;
      counted += 1;
    }
  }

  const maxTotal = counted * 5;
  const verdict = verdictFromTotal(total, personaOutputs.raj?.text);

  const arjunGrade = parseVisualHierarchyGrade(personaOutputs.arjun?.text);
  const hierarchyCheck = parseHierarchyCheck(personaOutputs.meera?.text);
  const hierarchyFail = gradeBelowC(arjunGrade) || hierarchyCheck === 'does not match';

  const revisions = collectRevisions(personaOutputs);
  const top3 = revisions.slice(0, 3);

  if (hierarchyFail && top3.length) {
    const gateFix = 'Fix information hierarchy — primary task action must be rank #1 on screen';
    if (!top3.some((t) => /hierarchy/i.test(t.change))) {
      top3.unshift({ change: gateFix, assigned: 'Arjun', gate: true });
      if (top3.length > 3) top3.pop();
    }
  }

  const lines = [
    '## Composite Score',
    `Arjun (UX + Visual): ${scores.arjun ?? '—'}`,
    `Meera (Business):    ${scores.meera ?? '—'}`,
    `Priya (Feasibility): ${scores.priya ?? '—'}`,
    `Zara (Delight):      ${scores.zara ?? '—'}`,
    `Total:               ${total}/${maxTotal || 20}`,
    '',
    `Verdict: ${verdict}`,
    '',
    'Top 3 actionable changes (ranked by impact):',
  ];

  top3.forEach((item, i) => {
    const gateNote = item.gate ? ' — *Inserted by Information Hierarchy Gate*' : '';
    lines.push(`${i + 1}. ${item.change} — assigned to ${item.assigned}${gateNote}`);
  });

  lines.push(
    '',
    '## Information Hierarchy Gate',
    `Arjun's Visual Hierarchy grade: ${arjunGrade || 'unknown'}`,
    `Meera's Hierarchy check: ${hierarchyCheck}`,
    `Gate status: ${hierarchyFail ? 'FAIL' : 'PASS'}`,
  );

  if (personaOutputs.raj?.text) {
    const rajLines = personaOutputs.raj.text.split('\n').filter((l) => !/^## Raj/i.test(l.trim())).slice(0, 6);
    lines.push('', '## Raj — Stalemate Resolution', ...rajLines);
  }

  return {
    markdown: lines.join('\n'),
    composite: {
      scores,
      total,
      max_total: maxTotal || 20,
      verdict,
      top3,
      hierarchy_gate: {
        arjun_visual_hierarchy: arjunGrade,
        meera_hierarchy_check: hierarchyCheck,
        status: hierarchyFail ? 'FAIL' : 'PASS',
      },
    },
  };
}

module.exports = { buildSynthesis, extractScore, CRITIQUE_PERSONAS };
