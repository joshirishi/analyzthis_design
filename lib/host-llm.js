'use strict';

/**
 * Host LLM bridge — orchestrator writes persona prompts; Devi (host IDE agent) writes responses.
 * No external API keys required.
 *
 * Run dir: ~/.analyzthis_design/runs/{projectId}/{runId}/
 *   pending/001-arjun.json
 *   responses/001-arjun.md
 *   manifest.json
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { enforceOutputCap } = require('./token-gate');

const RUNS_ROOT = path.join(os.homedir(), '.analyzthis_design', 'runs');

class HostLlmPendingError extends Error {
  constructor({ runDir, runId, stepId, personaId, pendingPath, completedSteps, totalSteps }) {
    super(`Host LLM pending: ${personaId} (${stepId})`);
    this.name = 'HostLlmPendingError';
    this.runDir = runDir;
    this.runId = runId;
    this.stepId = stepId;
    this.personaId = personaId;
    this.pendingPath = pendingPath;
    this.completedSteps = completedSteps;
    this.totalSteps = totalSteps;
  }
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function createRun({ projectId, task }) {
  const runId = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const runDir = path.join(RUNS_ROOT, projectId, runId);
  ensureDir(path.join(runDir, 'pending'));
  ensureDir(path.join(runDir, 'responses'));
  const manifest = {
    run_id: runId,
    project_id: projectId,
    task: task || '',
    created_at: new Date().toISOString(),
    step_counter: 0,
    completed_steps: [],
  };
  fs.writeFileSync(path.join(runDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return { runId, runDir, manifest };
}

function loadManifest(runDir) {
  const p = path.join(runDir, 'manifest.json');
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function saveManifest(runDir, manifest) {
  fs.writeFileSync(path.join(runDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

function nextStepId(manifest) {
  manifest.step_counter = (manifest.step_counter || 0) + 1;
  return String(manifest.step_counter).padStart(3, '0') + `-${manifest.pending_persona || 'step'}`;
}

function pendingPath(runDir, stepId) {
  return path.join(runDir, 'pending', `${stepId}.json`);
}

function responsePath(runDir, stepId) {
  return path.join(runDir, 'responses', `${stepId}.md`);
}

function writePending(runDir, manifest, { personaId, system, user, meta = {} }) {
  manifest.pending_persona = personaId;
  const stepId = `${String(manifest.step_counter + 1).padStart(3, '0')}-${personaId}`;
  const payload = {
    step_id: stepId,
    persona_id: personaId,
    system,
    user,
    max_tokens: meta.max_tokens ?? meta.maxTokens ?? null,
    output_char_cap: meta.output_char_cap ?? null,
    created_at: new Date().toISOString(),
    ...meta,
  };
  fs.writeFileSync(pendingPath(runDir, stepId), JSON.stringify(payload, null, 2));
  return stepId;
}

function readResponse(runDir, stepId) {
  const p = responsePath(runDir, stepId);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8');
}

function submitResponse(runDir, stepId, text, { maxTokens } = {}) {
  ensureDir(path.join(runDir, 'responses'));
  let capped = text;
  const pendingFile = pendingPath(runDir, stepId);
  if (fs.existsSync(pendingFile)) {
    try {
      const pending = JSON.parse(fs.readFileSync(pendingFile, 'utf8'));
      const cap = maxTokens ?? pending.max_tokens;
      if (cap) capped = enforceOutputCap(text, cap);
    } catch { /* use raw text */ }
  } else if (maxTokens) {
    capped = enforceOutputCap(text, maxTokens);
  }
  fs.writeFileSync(responsePath(runDir, stepId), capped);
  const manifest = loadManifest(runDir);
  if (manifest && !manifest.completed_steps.includes(stepId)) {
    manifest.completed_steps.push(stepId);
    saveManifest(runDir, manifest);
  }
}

function listPending(runDir) {
  const pendingDir = path.join(runDir, 'pending');
  if (!fs.existsSync(pendingDir)) return [];
  return fs.readdirSync(pendingDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const stepId = f.replace(/\.json$/, '');
      const data = JSON.parse(fs.readFileSync(path.join(pendingDir, f), 'utf8'));
      return {
        stepId,
        personaId: data.persona_id,
        hasResponse: fs.existsSync(responsePath(runDir, stepId)),
        pendingPath: path.join(pendingDir, f),
      };
    })
    .sort((a, b) => a.stepId.localeCompare(b.stepId));
}

function findLatestRun(projectId) {
  const dir = path.join(RUNS_ROOT, projectId);
  if (!fs.existsSync(dir)) return null;
  const runs = fs.readdirSync(dir).sort().reverse();
  for (const runId of runs) {
    const runDir = path.join(dir, runId);
    if (fs.existsSync(path.join(runDir, 'manifest.json'))) return { runId, runDir };
  }
  return null;
}

/**
 * Host provider call — write pending, return response if exists, else throw HostLlmPendingError.
 * @param {object} opts
 * @param {object} opts.runContext — { runDir, manifest, hostResponder }
 */
async function callHostLlm({ personaId, system, user, maxTokens, runContext }) {
  const { runDir, manifest, hostResponder } = runContext;
  if (!runDir || !manifest) throw new Error('host run context missing — call createRun first');

  const stepId = writePending(runDir, manifest, {
    personaId,
    system,
    user,
    meta: { provider: 'host', agent: 'devi', max_tokens: maxTokens },
  });
  manifest.step_counter += 1;
  saveManifest(runDir, manifest);

  const applyCap = (raw) => (maxTokens ? enforceOutputCap(raw, maxTokens) : raw);

  // Inline responder (tests / scripted fixtures)
  if (typeof hostResponder === 'function') {
    const text = await hostResponder({ personaId, system, user, stepId, runDir, maxTokens });
    if (text) {
      const capped = applyCap(text);
      submitResponse(runDir, stepId, capped, { maxTokens });
      return capped;
    }
  }

  // Pre-written response file
  let text = readResponse(runDir, stepId);
  if (text) {
    text = applyCap(text);
    manifest.completed_steps = manifest.completed_steps || [];
    if (!manifest.completed_steps.includes(stepId)) {
      manifest.completed_steps.push(stepId);
      saveManifest(runDir, manifest);
    }
    return text;
  }

  // Optional short poll (HOST_LLM_POLL_MS)
  const pollMs = Number(process.env.HOST_LLM_POLL_MS || 0);
  if (pollMs > 0) {
    const deadline = Date.now() + pollMs;
    while (Date.now() < deadline) {
      text = readResponse(runDir, stepId);
      if (text) {
        const capped = applyCap(text);
        submitResponse(runDir, stepId, capped, { maxTokens });
        return capped;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  const pending = listPending(runDir);
  throw new HostLlmPendingError({
    runDir,
    runId: manifest.run_id,
    stepId,
    personaId,
    pendingPath: pendingPath(runDir, stepId),
    completedSteps: manifest.completed_steps?.length || 0,
    totalSteps: pending.length,
  });
}

function printDeviInstructions(err) {
  console.log('\n╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║  DEVI — Host LLM pending                                             ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝\n');
  console.log(`  Persona waiting:  ${err.personaId}`);
  console.log(`  Step:             ${err.stepId}`);
  console.log(`  Prompt file:      ${err.pendingPath}`);
  console.log(`  Run directory:    ${err.runDir}`);
  console.log('\n  In Cursor, invoke:  /devi');
  console.log('  Or submit response:');
  console.log(`    npx analyzthis_design devi respond --run ${err.runDir} --step ${err.stepId} --file response.md`);
  console.log('  Then continue:');
  console.log(`    npx analyzthis_design run --continue --task "..." --project ${path.basename(path.dirname(err.runDir))}\n`);
}

module.exports = {
  HostLlmPendingError,
  RUNS_ROOT,
  createRun,
  loadManifest,
  saveManifest,
  writePending,
  readResponse,
  submitResponse,
  listPending,
  findLatestRun,
  callHostLlm,
  printDeviInstructions,
  pendingPath,
  responsePath,
};
