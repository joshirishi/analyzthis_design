#!/usr/bin/env node
'use strict';

/**
 * Live quality run via host provider + fixture hostResponder (real engine, no API keys).
 */

const session = require('../lib/session');
const { run: orchestratorRun } = require('../lib/orchestrator/run');
const { printReport, checkSession } = require('./quality-check');
const fs = require('fs');
const path = require('path');

const TASK = 'Full screen review FlowPay invoice approval dashboard — finance managers must approve and pay vendor invoices in under 90 seconds. Primary Approve & Pay CTA is buried below the fold. Screen uses invented purple #4F46E5 instead of design system --color-primary. High-frequency working surface.';

const FIXTURES = {
  arjun: `## Arjun — Lite
UX grades: Useful[B] Usable[C] Findable[D] Credible[B] Accessible[B] Desirable[C] Valuable[B]
Visual grades: Hierarchy[D] Color[C] Type[B] Spacing[B] Components[C] StyleFit[C] Micro[B]
Top 2 fixes: 1. Sticky header — move Approve & Pay CTA above fold 2. Replace #4F46E5 with --color-primary on primary Button
Combined score: 2.6/5
\`\`\`json deliberation
{"grounding":[{"type":"task_map","ref":"task_map[0]","note":"90s approval requires CTA visible without scroll"}],"satisfaction_with_prior":1.0,"accepts_prior":true,"objections":[],"questions":["Is mobile approval in scope?"],"revisions":["Sticky Approve & Pay in header"],"verdict":"REVISE"}
\`\`\``,

  meera_r0: `## Meera — Lite
Metric impact: hurts it — scroll friction opposes 40% processing-time reduction
Hierarchy check: does not match — rank #1 driver not rank #1 on screen
Top 2 fixes: 1. Sticky Approve & Pay 2. Surface amount + vendor before line items
Score: 2.5
\`\`\`json deliberation
{"grounding":[{"type":"task_map","ref":"task_map[0]","note":"Daily approve path"}],"satisfaction_with_prior":0.2,"accepts_prior":false,"objections":[{"target_persona":"arjun","claim":"Two visual fixes sufficient without click-path proof","evidence_required":"Approve path in ≤3 interactions with time estimate","blocking":true,"grounded_in":"task_map[0]: 90 seconds"}],"questions":["Batch vs single-invoice % for MVP?"],"revisions":["Sticky header CTA"],"verdict":"CONTEST"}
\`\`\``,

  meera_r1: `## Meera — Lite (Rebuttal round 1)
Metric impact: still hurts it — Arjun has not shown ≤3-click path timing
Hierarchy check: does not match
Score: 2.5
New evidence: finance managers process 15–30 invoices/day per PRD — 8s scroll × 20 = 2.6 min/day lost.
\`\`\`json deliberation
{"grounding":[{"type":"task_map","ref":"task_map[0]","note":"Volume math on scroll cost"}],"satisfaction_with_prior":0.35,"accepts_prior":false,"objections":[{"target_persona":"arjun","claim":"Sticky header alone proves 90s path","evidence_required":"Interaction count from landing to paid","blocking":true,"grounded_in":"ui_region: primary CTA"}],"questions":[],"revisions":["Sticky header + inline amount confirmation"],"verdict":"CONTEST"}
\`\`\``,

  priya_r0: `## Priya — Lite
Effort: M — UI M × State S
Top 2 risks: 1. Double-scroll on short viewports 2. Batch needs API
Simpler alternative: Reuse Button in layout shell
Score: 3.5
\`\`\`json deliberation
{"grounding":[{"type":"ds_token","ref":"@/components/ui/button","note":"Existing primitive"}],"satisfaction_with_prior":0.3,"accepts_prior":false,"objections":[{"target_persona":"meera","claim":"Batch approve is MVP","evidence_required":"PRD citation for >10 invoices/session at launch","blocking":true,"grounded_in":"PRD: single-invoice MVP"}],"questions":["Optimistic UI on approve?"],"revisions":["Ship sticky header first; backlog bulk"],"verdict":"CONTEST"}
\`\`\``,

  priya_r1: `## Priya — Lite (Rebuttal round 1)
Effort: M — unchanged; sticky header is one layout PR
Score: 3.5
Concede: Meera's volume math is valid; still blocking batch for MVP — API spike estimated 2 sprints.
\`\`\`json deliberation
{"grounding":[{"type":"task_map","ref":"task_map[0]","note":"Single-invoice MVP"}],"satisfaction_with_prior":0.45,"accepts_prior":false,"objections":[{"target_persona":"meera","claim":"Batch approve in MVP","evidence_required":"Launch requirement for bulk","blocking":true,"grounded_in":"PRD: single-invoice MVP"}],"questions":[],"revisions":["Sticky CTA + token fix in one PR"],"verdict":"CONTEST"}
\`\`\``,

  zara: `## Zara — Lite
no delight needed here — speed is the craft.
\`\`\`json deliberation
{"grounding":[{"type":"ui_region","ref":"invoice table","note":"High-frequency surface"}],"satisfaction_with_prior":0.75,"accepts_prior":true,"objections":[],"questions":[],"revisions":[],"verdict":"ACCEPT"}
\`\`\``,

  raj: `## Raj — Stalemate Resolution
Principle #2 (Speed of core workflow) wins. REVISE — ship sticky CTA + DS token; defer batch to v2.
\`\`\`json deliberation
{"grounding":[{"type":"task_map","ref":"task_map[0]","note":"MVP single-invoice"}],"satisfaction_with_prior":1.0,"accepts_prior":true,"objections":[],"questions":[],"revisions":[],"verdict":"REVISE"}
\`\`\``,
};

const meeraCalls = [];
const priyaCalls = [];

async function hostResponder({ personaId }) {
  if (personaId === 'meera') {
    meeraCalls.push(meeraCalls.length);
    return FIXTURES[`meera_r${Math.min(meeraCalls.length - 1, 1)}`] || FIXTURES.meera_r1;
  }
  if (personaId === 'priya') {
    priyaCalls.push(priyaCalls.length);
    return FIXTURES[`priya_r${Math.min(priyaCalls.length - 1, 1)}`] || FIXTURES.priya_r1;
  }
  return FIXTURES[personaId];
}

async function main() {
  session.init({});
  session.update({
    patch: {
      task_map: [{ task: 'Approve and pay a vendor invoice in under 90 seconds', frequency: 'daily', priority: 'P0' }],
      information_hierarchy: { ranking: ['Approve & Pay', 'Invoice amount', 'Vendor name'] },
      ds_checklist: { no_invented_hex: false, kit_components_preferred: true },
      digest: { hierarchy_top3: ['Approve & Pay', 'Invoice amount', 'Vendor name'], ds_at_risk: ['no_invented_hex'] },
    },
  });

  console.log('\n🧪 Host-mode quality run (Devi bridge + fixtures)\n');

  const final = await orchestratorRun({
    task: TASK,
    full: true,
    maxRounds: 2,
    provider: 'host',
    hostResponder,
  });

  const roundLog = final.deliberation?.round_log || [];
  const personas = roundLog.map((r) => r.persona);
  const zaraIdx = personas.indexOf('zara');
  const rajIdx = personas.lastIndexOf('raj');

  console.log('\n── Order check ──');
  console.log(`  Persona order: ${personas.join(' → ')}`);
  console.log(`  Zara before Raj: ${zaraIdx >= 0 && rajIdx >= 0 ? zaraIdx < rajIdx : 'n/a'}`);
  console.log(`  Meera rebuttal evolved: ${meeraCalls.length > 1 ? 'yes' : 'no'}`);
  console.log(`  Synthesis verdict: ${final.synthesis?.verdict}`);

  const outPath = path.join(__dirname, 'output', 'flowpay-host-session.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(final, null, 2));

  printReport(checkSession(final));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
