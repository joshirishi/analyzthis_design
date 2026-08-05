'use strict';

/**
 * Persona feedback — record when users are unhappy, how they corrected output,
 * and export correction pairs for future training (DPO / LoRA negatives).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const session = require('./session');

const { resolvePackageRoot } = require('./platforms');
const PACKAGE_ROOT = resolvePackageRoot(__dirname);
const GLOBAL_FEEDBACK_DIR = path.join(os.homedir(), '.analyzthis_design', 'feedback');
const GLOBAL_FEEDBACK_FILE = path.join(GLOBAL_FEEDBACK_DIR, 'corrections.jsonl');

const ISSUE_TAG_HINTS = [
  'wrong_hierarchy',
  'invented_tokens',
  'missed_ds',
  'too_verbose',
  'too_shallow',
  'bad_ia',
  'off_brief',
  'wrong_component',
  'accessibility_miss',
  'business_mismatch',
  'other',
];

function loadCard(personaId) {
  const cardPath = path.join(PACKAGE_ROOT, 'agents', 'cards', `${personaId}.md`);
  if (!fs.existsSync(cardPath)) return '';
  return fs.readFileSync(cardPath, 'utf8');
}

function parseTags(raw) {
  if (!raw) return [];
  return raw.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
}

/**
 * Record user feedback on a persona's last output.
 * @param {{
 *   project?: string,
 *   persona: string,
 *   rating?: number,
 *   comment?: string,
 *   correction?: string,
 *   tags?: string[],
 *   satisfied?: boolean,
 *   markRejected?: boolean,
 * }} opts
 */
function recordFeedback(opts = {}) {
  const {
    persona,
    rating,
    comment = '',
    correction = '',
    tags = [],
    satisfied = false,
    markRejected = true,
  } = opts;

  if (!persona) throw new Error('--persona is required');

  const projectId = opts.project || session.getProjectId();
  const state = session.show({ project: projectId });
  if (!state) throw new Error('No session found. Run: npx analyzthis_design session init');

  const outputEntry = state.persona_outputs?.[persona];
  if (!outputEntry) {
    throw new Error(`No output recorded for persona "${persona}" in this session yet.`);
  }

  const entry = {
    id: crypto.randomBytes(8).toString('hex'),
    at: new Date().toISOString(),
    project_id: projectId,
    persona,
    satisfied: !!satisfied,
    rating: rating != null ? Number(rating) : null,
    comment: String(comment).trim(),
    correction: String(correction).trim(),
    tags: tags.length ? tags : (satisfied ? ['positive'] : ['other']),
    original_output: typeof outputEntry.text === 'string'
      ? outputEntry.text.slice(0, 8000)
      : JSON.stringify(outputEntry).slice(0, 8000),
    context: {
      task_map_summary: state.digest?.task_map_summary || '',
      problem_type: state.routing_decision?.problem_type || '',
      mode: state.mode || state.digest?.mode || '',
    },
  };

  const feedbackLog = Array.isArray(state.feedback_log) ? state.feedback_log.slice() : [];
  feedbackLog.push(entry);

  if (markRejected && !satisfied) {
    outputEntry.accepted = false;
    outputEntry.feedback_id = entry.id;
  } else if (satisfied) {
    outputEntry.accepted = true;
    outputEntry.feedback_id = entry.id;
  }

  const persona_outputs = { ...state.persona_outputs, [persona]: outputEntry };
  session.update({
    project: projectId,
    patch: { feedback_log: feedbackLog, persona_outputs },
  });

  // Append to global cross-project log for aggregate learning
  fs.mkdirSync(GLOBAL_FEEDBACK_DIR, { recursive: true });
  fs.appendFileSync(GLOBAL_FEEDBACK_FILE, JSON.stringify(entry) + '\n');

  return { entry, projectId, globalFile: GLOBAL_FEEDBACK_FILE };
}

function listFeedback({ project, all = false } = {}) {
  if (all) {
    const items = [];
    for (const projectId of session.listProjects()) {
      const state = session.show({ project: projectId });
      if (!state?.feedback_log?.length) continue;
      for (const e of state.feedback_log) items.push({ ...e, project_id: projectId });
    }
    if (fs.existsSync(GLOBAL_FEEDBACK_FILE)) {
      // dedupe by id — session copies already included
    }
    return items.sort((a, b) => (a.at < b.at ? 1 : -1));
  }

  const projectId = project || session.getProjectId();
  const state = session.show({ project: projectId });
  return state?.feedback_log || [];
}

/**
 * Export correction pairs for training (rejected output + user correction).
 */
function exportCorrections({ persona, project, all = false, output, includePositive = false } = {}) {
  let entries = listFeedback({ project, all });
  if (persona) entries = entries.filter((e) => e.persona === persona);
  if (!includePositive) entries = entries.filter((e) => !e.satisfied);

  const pairs = [];
  for (const e of entries) {
    if (!e.correction && !e.comment) continue;
    pairs.push({
      persona: e.persona,
      project_id: e.project_id,
      rating: e.rating,
      tags: e.tags,
      system_card: loadCard(e.persona),
      user: e.context?.task_map_summary || '',
      assistant_rejected: e.original_output,
      assistant_preferred: e.correction || e.comment,
      user_comment: e.comment,
      recorded_at: e.at,
    });
  }

  const filePath = path.resolve(
    output || path.join(GLOBAL_FEEDBACK_DIR, persona ? `${persona}-corrections.jsonl` : 'all-corrections.jsonl'),
  );
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, pairs.map((p) => JSON.stringify(p)).join('\n') + (pairs.length ? '\n' : ''));

  return { pairs: pairs.length, filePath, entries: entries.length };
}

module.exports = {
  recordFeedback,
  listFeedback,
  exportCorrections,
  ISSUE_TAG_HINTS,
  GLOBAL_FEEDBACK_FILE,
};
