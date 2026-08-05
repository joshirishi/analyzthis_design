'use strict';

/**
 * Opt-in anonymous submission of persona feedback to a central store (Supabase REST).
 * Users must consent once; payloads are redacted before upload.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const crypto = require('crypto');
const readline = require('readline');
const session = require('./session');
const { listFeedback } = require('./feedback');

const CONFIG_DIR = path.join(os.homedir(), '.analyzthis_design');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const CONSENT_FILE = path.join(CONFIG_DIR, 'feedback', 'submit-consent.json');

const MAX_SUBMIT_TEXT = 2000;
const PATH_PATTERN = /(?:\/Users\/|\/home\/|[A-Za-z]:\\)[^\s"'`,;)]+/g;
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const SECRET_PATTERN = /\b(sk-[a-zA-Z0-9_-]{10,}|api[_-]?key\s*[:=]\s*['"]?[a-zA-Z0-9_-]{8,})/gi;

function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) return { sources: [] };
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return { sources: [] };
  }
}

function saveConfig(config) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

function resolveSubmitConfig() {
  const config = loadConfig();
  const fb = config.feedback || {};
  const pkgVersion = safePackageVersion();

  return {
    url: process.env.ANALYZTHIS_FEEDBACK_URL || fb.submit_url || '',
    anonKey: process.env.ANALYZTHIS_FEEDBACK_ANON_KEY || fb.anon_key || '',
    enabled: fb.submit_enabled !== false,
    packageVersion: pkgVersion,
    installId: getInstallId(config),
  };
}

function safePackageVersion() {
  try {
    const pkg = require(path.join(__dirname, '..', 'package.json'));
    return pkg.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

function getInstallId(configIn) {
  const config = configIn || loadConfig();
  if (!config.feedback) config.feedback = {};
  if (!config.feedback.install_id) {
    config.feedback.install_id = crypto.randomBytes(16).toString('hex');
    saveConfig(config);
  }
  return config.feedback.install_id;
}

function loadConsent() {
  if (!fs.existsSync(CONSENT_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(CONSENT_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function saveConsent() {
  fs.mkdirSync(path.dirname(CONSENT_FILE), { recursive: true });
  fs.writeFileSync(
    CONSENT_FILE,
    JSON.stringify({ opted_in: true, at: new Date().toISOString(), version: 1 }, null, 2),
  );
}

function revokeConsent() {
  if (fs.existsSync(CONSENT_FILE)) fs.unlinkSync(CONSENT_FILE);
}

/**
 * Redact paths, emails, secrets; truncate long text.
 */
function anonymizeText(text, maxLen = MAX_SUBMIT_TEXT) {
  if (!text || typeof text !== 'string') return '';
  const home = os.homedir();
  let out = text.split(home).join('~/');
  out = out.replace(PATH_PATTERN, '[path]');
  out = out.replace(EMAIL_PATTERN, '[email]');
  out = out.replace(SECRET_PATTERN, '[redacted]');
  if (out.length > maxLen) out = out.slice(0, maxLen) + '…';
  return out.trim();
}

function entryToSubmitPayload(entry, cfg) {
  return {
    install_id: cfg.installId,
    package_version: cfg.packageVersion,
    feedback_id: entry.id,
    persona: entry.persona,
    satisfied: !!entry.satisfied,
    rating: entry.rating,
    tags: entry.tags || [],
    user_comment: anonymizeText(entry.comment, 800),
    assistant_rejected: anonymizeText(entry.original_output),
    assistant_preferred: anonymizeText(entry.correction || entry.comment, 1200),
    task_summary: anonymizeText(entry.context?.task_map_summary || '', 600),
    problem_type: entry.context?.problem_type || '',
    mode: entry.context?.mode || '',
    recorded_at: entry.at,
  };
}

function collectUnsentEntries({ project, all = false, persona, includePositive = false } = {}) {
  let entries = listFeedback({ project, all });
  if (persona) entries = entries.filter((e) => e.persona === persona);
  if (!includePositive) entries = entries.filter((e) => !e.satisfied);
  return entries.filter((e) => !e.submitted_at && (e.comment || e.correction));
}

function markEntriesSubmitted(entryIds) {
  const idSet = new Set(entryIds);
  let marked = 0;

  for (const projectId of session.listProjects()) {
    const state = session.show({ project: projectId });
    if (!state?.feedback_log?.length) continue;

    let changed = false;
    const feedback_log = state.feedback_log.map((e) => {
      if (!idSet.has(e.id) || e.submitted_at) return e;
      changed = true;
      marked += 1;
      return { ...e, submitted_at: new Date().toISOString() };
    });

    if (changed) {
      session.update({ project: projectId, patch: { feedback_log } });
    }
  }

  return marked;
}

function postJson(url, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = JSON.stringify(body);
    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          ...headers,
        },
      },
      (res) => {
        let chunks = '';
        res.on('data', (c) => { chunks += c; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ status: res.statusCode, body: chunks });
          } else {
            reject(new Error(`Submit failed (${res.statusCode}): ${chunks.slice(0, 300)}`));
          }
        });
      },
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function submitRows(rows, cfg) {
  if (!cfg.url) {
    throw new Error(
      'No feedback submit URL configured.\n'
      + '  Maintainer: set feedback.submit_url + feedback.anon_key in ~/.analyzthis_design/config.json\n'
      + '  Or env: ANALYZTHIS_FEEDBACK_URL and ANALYZTHIS_FEEDBACK_ANON_KEY\n'
      + '  See README → "Community feedback collection"',
    );
  }
  if (!cfg.anonKey) {
    throw new Error('Missing anon key. Set feedback.anon_key in config or ANALYZTHIS_FEEDBACK_ANON_KEY.');
  }

  await postJson(cfg.url, {
    apikey: cfg.anonKey,
    Authorization: `Bearer ${cfg.anonKey}`,
    Prefer: 'return=minimal',
  }, rows);

  return rows.length;
}

function askConsentQuestion() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(
      '\nShare anonymized persona feedback with analyzthis_design maintainers?\n'
      + '  Sends: persona, rating, tags, comment/correction, redacted output snippets\n'
      + '  Does NOT send: project paths, repo names, emails, or API keys\n'
      + 'Continue? [y/N] ',
      (answer) => {
        rl.close();
        resolve(/^y(es)?$/i.test((answer || '').trim()));
      },
    );
  });
}

async function ensureConsent({ yes = false } = {}) {
  if (loadConsent()?.opted_in) return true;
  if (yes) {
    saveConsent();
    return true;
  }
  if (!process.stdin.isTTY) {
    throw new Error('Non-interactive terminal. Pass --yes to confirm opt-in submit consent.');
  }
  const ok = await askConsentQuestion();
  if (ok) saveConsent();
  return ok;
}

/**
 * Submit unsent feedback entries (opt-in, anonymized).
 */
async function submitFeedback(opts = {}) {
  const {
    project,
    all = false,
    persona,
    includePositive = false,
    dryRun = false,
    yes = false,
    limit,
  } = opts;

  const cfg = resolveSubmitConfig();
  if (!cfg.enabled) {
    throw new Error('Feedback submit is disabled. Set feedback.submit_enabled: true in config.');
  }

  let entries = collectUnsentEntries({ project, all, persona, includePositive });
  if (limit != null && Number(limit) > 0) entries = entries.slice(0, Number(limit));

  if (!entries.length) {
    return { submitted: 0, dryRun, message: 'No unsent feedback entries with comment/correction.' };
  }

  const payloads = entries.map((e) => entryToSubmitPayload(e, cfg));

  if (dryRun) {
    return {
      submitted: 0,
      dryRun: true,
      payloads,
      endpoint: cfg.url || '(not configured)',
      message: `Would submit ${payloads.length} anonymized row(s).`,
    };
  }

  const consented = await ensureConsent({ yes });
  if (!consented) {
    return { submitted: 0, cancelled: true, message: 'Submit cancelled — consent not given.' };
  }

  const count = await submitRows(payloads, cfg);
  markEntriesSubmitted(entries.map((e) => e.id));

  return {
    submitted: count,
    ids: entries.map((e) => e.id),
    endpoint: cfg.url,
    message: `Submitted ${count} anonymized feedback row(s).`,
  };
}

function submitStatus() {
  const cfg = resolveSubmitConfig();
  const consent = loadConsent();
  const unsent = collectUnsentEntries({ all: true }).length;

  return {
    consent: consent?.opted_in ? `opted in (${consent.at})` : 'not opted in',
    endpoint: cfg.url || '(not configured — set feedback.submit_url)',
    anonKey: cfg.anonKey ? 'configured' : '(missing — set feedback.anon_key)',
    installId: cfg.installId,
    unsentCount: unsent,
    packageVersion: cfg.packageVersion,
  };
}

module.exports = {
  anonymizeText,
  entryToSubmitPayload,
  resolveSubmitConfig,
  submitFeedback,
  submitStatus,
  loadConsent,
  saveConsent,
  revokeConsent,
  CONSENT_FILE,
  CONFIG_FILE,
};
