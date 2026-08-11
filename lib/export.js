'use strict';

/**
 * LoRA readiness (Phase 5 of the efficiency plan) — export hook only, no
 * training/serving in this release. Writes JSONL training pairs from session
 * state where a persona's output was explicitly marked accepted (see
 * `session.markAccepted`). Schema: { system_card, digest, user, assistant }.
 *
 * Not run automatically — call `npx analyzthis_design export-training --persona <id>`
 * once you have accepted runs to harvest.
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const session = require('./session');

const { resolvePackageRoot } = require('./platforms');
const PACKAGE_ROOT = resolvePackageRoot(__dirname);

const DEFAULT_OUTPUT_DIR = path.join(os.homedir(), '.analyzthis_design', 'training');

function loadCard(personaId) {
  const cardPath = path.join(PACKAGE_ROOT, 'agents', 'cards', `${personaId}.md`);
  if (!fs.existsSync(cardPath)) return '';
  return fs.readFileSync(cardPath, 'utf8');
}

/**
 * @param {{ persona: string, project?: string, all?: boolean, output?: string }} opts
 * @returns {{ pairs: number, filePath: string, projects: string[] }}
 */
function exportTraining({ persona, project, all = false, output } = {}) {
  if (!persona) throw new Error('--persona is required');

  const projectIds = all ? session.listProjects() : [project || session.getProjectId()];
  const card = loadCard(persona);
  const pairs = [];
  const touchedProjects = [];

  for (const projectId of projectIds) {
    const state = session.show({ project: projectId });
    if (!state) continue;
    const entry = state.persona_outputs?.[persona];
    if (!entry || entry.accepted !== true) continue;

    touchedProjects.push(projectId);
    const fullPrompt = (state.full_prompts && state.full_prompts[persona]) || null;
    const structured = (state.structured_outputs && state.structured_outputs[persona]) || null;
    let outcomeVal = 'unknown';
    if (state.outcome && state.outcome.confirmed && state.outcome.confirmed[persona]) {
      outcomeVal = state.outcome.confirmed[persona].value;
    } else if (state.outcome && state.outcome.inferred && state.outcome.inferred[persona]) {
      outcomeVal = state.outcome.inferred[persona].value;
    }

    pairs.push({
      system_card: card,
      system_prompt_full: fullPrompt ? fullPrompt.system : card,
      user_prompt_full: fullPrompt ? fullPrompt.user : '',
      digest: state.digest || {},
      user: state.digest?.task_map_summary || (state.task_map || []).map((t) => t.task).join('; '),
      assistant: entry.text,
      structured_output: structured,
      outcome: outcomeVal,
      task_type: state.task_type || '',
    });
  }

  const filePath = path.resolve(output || path.join(DEFAULT_OUTPUT_DIR, `${persona}.jsonl`));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, pairs.map((p) => JSON.stringify(p)).join('\n') + (pairs.length ? '\n' : ''));

  return { pairs: pairs.length, filePath, projects: touchedProjects };
}

module.exports = { exportTraining, DEFAULT_OUTPUT_DIR };
