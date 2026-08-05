#!/usr/bin/env node
'use strict';

/**
 * Fictional end-to-end walkthrough — FlowPay invoice dashboard.
 * Exercises deliberation parser + routing dry-runs per skill (no LLM calls).
 */

const session = require('../lib/session');
const deliberation = require('../lib/deliberation');
const { classifyProblems, resolveExpertsForRules } = require('../lib/orchestrator/run');
const fs = require('fs');
const path = require('path');

const FICTION = {
  product: 'FlowPay',
  task: 'Design the vendor invoice approval screen for finance managers',
  primary_task: 'Approve and pay a vendor invoice in under 90 seconds',
  north_star: 'Reduce weekly invoice processing time by 40%',
  ds_tokens: '--color-primary, spacing-4, Button from @/components/ui/button',
};

const SAMPLE_OUTPUTS = {
  arjun: {
    text: `## Arjun — Lite
UX grades: Usable[C] Findable[D] Accessible[B]
Top 2 fixes: 1. Primary Pay CTA below fold 2. Invoice table lacks row actions
Combined score: 2.8/5
\`\`\`json deliberation
{"grounding":[{"type":"task_map","ref":"task_map[0]","note":"90s approval requires CTA visible without scroll"}],"satisfaction_with_prior":1.0,"accepts_prior":true,"objections":[],"questions":["Is mobile in scope for approvers on the go?"],"revisions":[],"verdict":"REVISE"}
\`\`\``,
  },
  meera: {
    text: `## Meera — Lite (Round 1 — CONTEST)
Metric impact: hurts it — buried CTA delays approval velocity
\`\`\`json deliberation
{"grounding":[{"type":"task_map","ref":"task_map[0]","note":"North-star is processing time; scroll adds ~8s per invoice"}],"satisfaction_with_prior":0.25,"accepts_prior":false,"objections":[{"target_persona":"arjun","claim":"Fixing hierarchy alone is enough","evidence_required":"Show approval path in ≤3 clicks from landing","blocking":true,"grounded_in":"task_map[0]"}],"questions":["Why is batch approve not rank #1 for power users?"],"revisions":["Move Pay + Approve to sticky header"],"verdict":"CONTEST"}
\`\`\``,
  },
  priya: {
    text: `## Priya — Lite (parallel with Meera)
Effort: M — sticky header + row actions need state handling
\`\`\`json deliberation
{"grounding":[{"type":"ds_token","ref":"Button from components/ui/button","note":"Reuse existing; no new primitives"}],"satisfaction_with_prior":0.35,"accepts_prior":false,"objections":[{"target_persona":"meera","claim":"Batch approve is P0","evidence_required":"Confirm >10 invoices/session in PRD","blocking":true,"grounded_in":"PRD: single-invoice flow MVP"}],"questions":["Do we need bulk API or UI-only batch?"],"revisions":["Ship sticky CTA first; defer batch to v2"],"verdict":"CONTEST"}
\`\`\``,
  },
  zara: {
    text: `## Zara — Lite
Delight budget: low (high-frequency working surface)
no delight needed here — speed is the craft.
\`\`\`json deliberation
{"grounding":[{"type":"ui_region","ref":"invoice table","note":"Power-user surface"}],"satisfaction_with_prior":0.7,"accepts_prior":true,"objections":[],"questions":[],"revisions":[],"verdict":"ACCEPT"}
\`\`\``,
  },
  noor: {
    text: `## Noor — Concept A wireframe (minimalist)
[Header: FlowPay] [Invoice #4021 summary card] [Primary: Approve & Pay — full width]
Progressive disclosure: line items collapsed by default
\`\`\`json deliberation
{"grounding":[{"type":"task_map","ref":"task_map[0]","note":"Single primary action above fold"}],"satisfaction_with_prior":1.0,"accepts_prior":true,"objections":[],"questions":[],"revisions":[],"verdict":"ACCEPT"}
\`\`\``,
  },
  anuj: {
    text: `## Anuj — Concept B wireframe (dense)
[Split: invoice list 40% | detail 60%] [Bulk select] [⌘+Enter Approve]
\`\`\`json deliberation
{"grounding":[{"type":"task_map","ref":"task_map[0]","note":"Power users process 20+ invoices"}],"satisfaction_with_prior":0.2,"accepts_prior":false,"objections":[{"target_persona":"noor","claim":"Full-width CTA scales to batch workflow","evidence_required":"Show keyboard path for 10+ approvals","blocking":true,"grounded_in":"ui_region: list+detail"}],"questions":["Where is multi-select in Concept A?"],"revisions":["Add list+detail with bulk actions"],"verdict":"CONTEST"}
\`\`\``,
  },
  raj: {
    text: `## Raj — Stalemate Resolution
Principle #2 (Speed of core workflow) wins over density for MVP.
Verdict: REVISE — ship Noor sticky CTA; backlog Anuj bulk to v2 with API spike.
\`\`\`json deliberation
{"grounding":[{"type":"task_map","ref":"task_map[0]","note":"MVP is single-invoice 90s path"}],"satisfaction_with_prior":1.0,"accepts_prior":true,"objections":[],"questions":[],"revisions":[],"verdict":"REVISE"}
\`\`\``,
  },
};

function route(task, mode = 'full') {
  const chainPath = path.join(__dirname, '..', 'agents', 'chain.json');
  const chain = JSON.parse(fs.readFileSync(chainPath, 'utf8'));
  const rules = classifyProblems(task);
  return resolveExpertsForRules(rules, chain, { mode });
}

function printSkillHeader(name, invoke) {
  console.log('\n' + '═'.repeat(72));
  console.log(`SKILL: /${name}  (${invoke})`);
  console.log('═'.repeat(72));
}

function showParsed(personaId) {
  const raw = SAMPLE_OUTPUTS[personaId];
  if (!raw) return;
  const parsed = deliberation.parseDeliberationOutput(raw.text);
  console.log(`\n[${personaId}] satisfaction=${parsed.satisfaction_with_prior} accepts=${parsed.accepts_prior} verdict=${parsed.verdict}`);
  if (parsed.objections.length) {
    console.log(`  objections: ${parsed.objections.map((o) => `${o.target_persona}: ${o.claim.slice(0, 50)}…`).join(' | ')}`);
  }
  if (parsed.questions.length) console.log(`  questions: ${parsed.questions[0]}`);
}

// Seed fictional session
const { projectId } = session.init({});
session.update({
  project: projectId,
  patch: {
    task_map: [{ task: FICTION.primary_task, frequency: 'daily', priority: 'P0' }],
    information_hierarchy: { declared_by: 'noor', ranking: ['Approve & Pay', 'Invoice amount', 'Vendor name', 'Line items'] },
    ds_checklist: { no_invented_hex: true, kit_components_preferred: true },
    digest: {
      task_map_summary: FICTION.primary_task,
      hierarchy_top3: ['Approve & Pay', 'Invoice amount', 'Vendor name'],
      experts: [],
      prior_scores: {},
    },
  },
});

const state = session.show({ project: projectId });
const ctx = deliberation.buildContextPack(state, FICTION.task);

console.log('\n🧪 FICTIONAL USE CASE: FlowPay — B2B Invoice Approval Dashboard');
console.log('─'.repeat(72));
console.log(`Product:     ${FICTION.product}`);
console.log(`Primary job: ${FICTION.primary_task}`);
console.log(`North star:  ${FICTION.north_star}`);
console.log(`DS tokens:   ${FICTION.ds_tokens}`);
console.log('\nContext pack (engine input):');
console.log(JSON.stringify({ ...ctx, vault_excerpt: ctx.vault_excerpt ? '(vault linked)' : '(none)' }, null, 2));

// ── Per skill ─────────────────────────────────────────────────────────────

printSkillHeader('kavi', 'npx analyzthis_design collect');
console.log('Producer — scans repo, no deliberation.');
console.log('Expected: Vault notes for PRDs/, Brand/tokens, Components/Button.tsx');
console.log('Next step: personas read knowledge bank before critique.');

printSkillHeader('getting-started', 'entry guide');
console.log('Routes user: wireframe → /ux-ideator | critique → /persona-orchestrator | index → /kavi');

printSkillHeader('ux-ideator', 'wireframe + deliberation Phase 4');
const ideation = route('wireframe new invoice approval screen ux ideator', 'full');
console.log('Router:', ideation);
console.log('Deliberation groups:', deliberation.getDeliberationGroups(
  JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'agents', 'chain.json'), 'utf8')),
  { full_chain: false, ideation_chain: ideation.ideation_chain, experts: ideation.experts, mode: 'full' },
));
showParsed('noor');
showParsed('anuj');
console.log('\n→ Parallel objection round: Noor vs Anuj on 5 IA dimensions');
console.log('→ Raj would activate if 2+ blocking objections persist');

printSkillHeader('noor', 'Concept A minimalist wireframe');
showParsed('noor');

printSkillHeader('anuj', 'Concept B power-user wireframe');
showParsed('anuj');

printSkillHeader('design-critic', '4-persona critique chain');
const critique = route('full screen review invoice approval dashboard', 'full');
console.log('Router:', critique);
console.log('Deliberation groups:', deliberation.getDeliberationGroups(
  JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'agents', 'chain.json'), 'utf8')),
  { full_chain: critique.full_chain, ideation_chain: false, experts: critique.experts, mode: 'full' },
));
['arjun', 'meera', 'priya', 'zara'].forEach(showParsed);

const roundLog = ['arjun', 'meera', 'priya', 'zara'].map((p, i) => ({
  round: i,
  persona: p,
  parsed: deliberation.parseDeliberationOutput(SAMPLE_OUTPUTS[p].text),
}));
const status = deliberation.computeRoundStatus(roundLog, 0.4);
console.log('\nRound status after critique deliberation:');
console.log(`  blocking_count=${status.blocking_count} consensus=${status.consensus_reached}`);
console.log(`  open_objections=${status.open_objections.length} escalate_raj=${deliberation.shouldEscalateToRaj(status, deliberation.loadDeliberationConfig({}), 2)}`);

printSkillHeader('persona-orchestrator', 'agentic entry + adversarial Step 3');
console.log('Flow: ux-story-gate intake → deliberation groups → gates → SHIP/REVISE/BLOCK');
console.log('CLI: npx analyzthis_design run --task "Review FlowPay invoice screen" --full --dry-run');

printSkillHeader('arjun', 'UX + visual');
showParsed('arjun');

printSkillHeader('meera', 'business');
showParsed('meera');

printSkillHeader('priya', 'feasibility');
showParsed('priya');

printSkillHeader('zara', 'delight');
showParsed('zara');

printSkillHeader('raj', 'arbitrator (stalemate)');
showParsed('raj');

printSkillHeader('design-director', 'wireframe → DesignSpec → adversarial spec review');
console.log('Phase 4: Arjun contests hierarchy in spec; Priya contests import_path; Zara scopes delight');
console.log('Sample spec gate objection: invented hex #4F46E5 → must use --color-primary');

printSkillHeader('design-spec', 'DesignSpec contract');
console.log(`Sample component row: { region: "header", component: "Button", import_path: "@/components/ui/button", hierarchy_rank: 1 }`);

printSkillHeader('ux-story-gate', 'task-first gate');
console.log('Phase 0: PRD discovery | Phase 1: task_map | Phase 1.5: MoE router → deliberation');

printSkillHeader('deliberation-protocol', 'shared adversarial rules');
console.log('Default threshold=0.4 | max_rounds=3 | parallel Meera∥Priya, Noor∥Anuj');

printSkillHeader('design-personas', 'session context template');
console.log('User fills: Product, Primary user, North-star, Tech stack before session');

printSkillHeader('knowledge-bank', 'ground truth from Kavi');
console.log('Overrides persona defaults with project PRDs, tokens, components');

printSkillHeader('design-reference', 'CSV retrieve-on-demand');
console.log('Example: retrieve colors.csv for SaaS dashboard palette citations');

printSkillHeader('collect-knowledge', 'alias for /kavi');
console.log('Same as kavi — scan → vault → sync');

// Composite verdict (design-critic Phase 5)
console.log('\n' + '═'.repeat(72));
console.log('FINAL SYNTHESIS (after deliberation + Raj if needed)');
console.log('═'.repeat(72));
console.log(`
## Composite Score — FlowPay Invoice Approval
Arjun (UX + Visual): 2.8/5
Meera (Business):    2.5/5
Priya (Feasibility): 3.5/5
Zara (Delight):      N/A — speed is the craft
Total:               8.8/20 → BLOCK → escalates toward REVISE after Raj

Verdict: REVISE

Top 3 actionable changes:
1. [P0] Move Approve & Pay to sticky header — grounded in task_map[0] 90s goal
2. [P1] Add row-level quick actions on invoice table — Arjun + Meera consensus
3. [P2] Defer bulk approve to v2 — Priya feasibility; Raj ruling

Deliberation metrics (simulated):
  rounds: 2 | objections_raised: 3 | resolved: 1 | raj_escalations: 1
`);

console.log('Run live dry-run: npx analyzthis_design run --task "Full screen review FlowPay invoice approval" --full --dry-run\n');
