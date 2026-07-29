#!/usr/bin/env node
'use strict';

const fs     = require('fs');
const path   = require('path');
const os     = require('os');
const crypto = require('crypto');

const SESSIONS_ROOT = path.join(os.homedir(), '.analyzthis_design', 'sessions');

// ─── Project identity ────────────────────────────────────────────────────────

// A project id is a short, filesystem-safe slug derived from the working
// directory so different repos never collide, and the same repo always
// resolves to the same session file across turns.
function getProjectId(cwd = process.cwd()) {
  const abs  = path.resolve(cwd);
  const slug = path.basename(abs).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
  const hash = crypto.createHash('sha1').update(abs).digest('hex').slice(0, 8);
  return `${slug}-${hash}`;
}

function sessionDir(projectId) {
  return path.join(SESSIONS_ROOT, projectId);
}

function sessionPath(projectId) {
  return path.join(sessionDir(projectId), 'session-state.json');
}

// ─── Default shape (mirrors agents/session-schema.json) ─────────────────────

function defaultState(projectId) {
  const now = new Date().toISOString();
  return {
    project_id: projectId,
    created_at: now,
    updated_at: now,
    task_map: [],
    figma_node: { url: '', confirmed: false },
    content_sources: [],
    ds_checklist: {
      no_invented_hex: null,
      no_important_overrides: null,
      kit_components_preferred: null,
      light_dark_from_tokens_only: null,
      contrast_checked_against_wcag: null,
    },
    information_hierarchy: { declared_by: 'undeclared', ranking: [] },
    routing_decision: { problem_type: '', experts: [], reason: '' },
    persona_outputs: {},
    verify_results: { primary_task: 'not_run', screenshots: [] },
    mode: 'assess_only',
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Create (or overwrite) a fresh session-state.json for the given project.
 */
function init({ project } = {}) {
  const projectId = project || getProjectId();
  const dir = sessionDir(projectId);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = sessionPath(projectId);
  fs.writeFileSync(filePath, JSON.stringify(defaultState(projectId), null, 2));
  return { projectId, filePath };
}

/**
 * Read the current session state. Returns null if no session exists yet.
 */
function show({ project } = {}) {
  const projectId = project || getProjectId();
  const filePath = sessionPath(projectId);
  if (!fs.existsSync(filePath)) return null;
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return null; }
}

/**
 * Delete the session state for a project (or all projects if `all` is true).
 */
function reset({ project, all = false } = {}) {
  if (all) {
    fs.rmSync(SESSIONS_ROOT, { recursive: true, force: true });
    return { removed: 'all' };
  }
  const projectId = project || getProjectId();
  fs.rmSync(sessionDir(projectId), { recursive: true, force: true });
  return { removed: projectId };
}

/**
 * Merge a partial update into the session state, creating it first if needed.
 * Used by the orchestrator skill (via CLI) to persist routing decisions,
 * persona outputs, and gate results between turns.
 */
function update({ project, patch = {} } = {}) {
  const projectId = project || getProjectId();
  const existing = show({ project: projectId }) || defaultState(projectId);
  const merged = { ...existing, ...patch, updated_at: new Date().toISOString() };
  const dir = sessionDir(projectId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(sessionPath(projectId), JSON.stringify(merged, null, 2));
  return merged;
}

module.exports = { getProjectId, sessionPath, sessionDir, init, show, reset, update, SESSIONS_ROOT };
