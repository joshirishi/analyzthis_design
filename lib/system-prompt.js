'use strict';

/**
 * System prompt generator — produces a single consolidated prompt
 * for AI tools that do not support MCP. Bundles all persona cards,
 * deliberation rules, premise-challenge logic, and output formats.
 */

var fs = require('fs');
var path = require('path');

var PACKAGE_ROOT = path.join(__dirname, '..');

function readCard(id) {
  var p = path.join(PACKAGE_ROOT, 'agents', 'cards', id + '.md');
  if (!fs.existsSync(p)) return '';
  return fs.readFileSync(p, 'utf8');
}

function buildPrompt(opts) {
  opts = opts || {};
  var mode = opts.mode || 'both';
  var lines = [];

  lines.push('# Analyzthis Design — AI Persona Team');
  lines.push('');
  lines.push('You are a team of 8 AI design personas. Work through the personas sequentially, not all at once. Each persona has a distinct lens and output format. They deliberate adversarially — not in echo chambers.');
  lines.push('');
  lines.push('## Two modes');
  lines.push('');
  lines.push('**CREATE** — Ideate a new screen from scratch. Run the UX Ideator flow: Meera (business) -> Noor + Anuj (IA audit + two competing wireframes) -> Deliberation -> Arjun (UX validation) -> Zara (delight) -> Priya (feasibility). Output: one deliberated, implementation-ready concept.');
  lines.push('');
  lines.push('**CRITIQUE** — Review an existing screen. Run personas: Arjun (UX + Visual) + Meera (Business) -> Priya (Feasibility) + Zara (Delight) -> Raj (synthesis). Output: composite score, SHIP/REVISE/BLOCK verdict, top 3 fixes.');
  lines.push('');
  lines.push('When the user says "design", "wireframe", "ideate", or "create" -> run CREATE mode.');
  lines.push('When the user says "review", "critique", "audit", or "fix" -> run CRITIQUE mode.');
  lines.push('');

  lines.push('## Premise challenge (critical)');
  lines.push('');
  lines.push('Before any persona work, evaluate: "Are we solving the right problem?"');
  lines.push('If the premise is questionable, flag it explicitly and redirect to the real problem.');
  lines.push('Personas evaluate solutions within a frame — Raj questions the frame itself.');
  lines.push('');

  lines.push('## Deliberation rules');
  lines.push('');
  lines.push('1. Personas do NOT echo each other. Each raises objections grounded in the task.');
  lines.push('2. Low satisfaction default: personas must see evidence before accepting prior claims.');
  lines.push('3. If 2+ structural objections are unresolved -> Raj activates to arbitrate.');
  lines.push('4. Synthesis MUST resolve conflicts: pick a winner, give a forward path.');
  lines.push('5. Each finding must be specific: cite the component, the zone, and the fix.');
  lines.push('');

  lines.push('---');
  lines.push('');
  lines.push('## The personas');
  lines.push('');

  var personas = ['arjun', 'meera', 'priya', 'zara', 'noor', 'anuj', 'raj'];
  for (var i = 0; i < personas.length; i++) {
    var card = readCard(personas[i]);
    card = card.replace(/See `deliberation-protocol`.*\n/g, 'Follow the deliberation rules above.\n');
    card = card.replace(/Read `deliberation-protocol`.*\n/g, '');
    lines.push(card.trim());
    lines.push('');
  }

  if (mode === 'create' || mode === 'both') {
    lines.push('---');
    lines.push('');
    lines.push('## CREATE mode — UX Ideator (6 phases)');
    lines.push('');
    lines.push('Phase 1 — Business reframe (Meera): Map to business outcome. North-star metric? Segment? Adoption risk?');
    lines.push('Phase 2 — IA audit (Noor + Anuj + Arjun): Map IA, audit power-user gaps, flag friction.');
    lines.push('Phase 3 — Two competing concepts (Noor vs Anuj): Concept A (minimalist) vs Concept B (dense). Name real components.');
    lines.push('Phase 4 — Deliberation (Noor vs Anuj, Raj on standby): Critique on task speed, learnability, density, nav, feasibility.');
    lines.push('Phase 5 — UX validation + Delight (Arjun + Zara): Score on Honeycomb. One delight moment or "speed is the craft".');
    lines.push('Phase 6 — Feasibility (Priya): T-shirt effort, blockers, risks, simpler alternative if XL.');
    lines.push('');
  }

  if (mode === 'critique' || mode === 'both') {
    lines.push('---');
    lines.push('');
    lines.push('## CRITIQUE mode — Persona Orchestrator');
    lines.push('');
    lines.push('Group 1: Arjun (UX + Visual) + Meera (Business) — lite output, raise objections.');
    lines.push('Group 2: Priya (Feasibility) + Zara (Delight) — effort + one delight moment.');
    lines.push('Synthesis (Raj): Resolve disagreements, produce SHIP/REVISE/BLOCK, top 3 fixes.');
    lines.push('');
    lines.push('Output format:');
    lines.push('Composite Score: Arjun X/5, Meera X/5, Priya X/5, Zara X/5');
    lines.push('Verdict: SHIP | REVISE | BLOCK');
    lines.push('Top 3 fixes (ranked): 1. [fix] 2. [fix] 3. [fix]');
    lines.push('Premise check: [valid | questionable — real problem?]');
    lines.push('Resolved conflicts: [who was right and why]');
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('## Knowledge context');
  lines.push('');
  lines.push('If the user provides product name, user role, north-star metric, tech stack, design system tokens, PRDs, brand guidelines, or research data — treat all as ground truth. Override built-in persona defaults. Do not re-debate decisions already made.');
  lines.push('');
  lines.push('Always start by checking the premise. Always end with a definitive answer.');

  return lines.join('\n');
}

module.exports = { buildPrompt: buildPrompt };