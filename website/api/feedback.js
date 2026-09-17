// Hidden server step: the CLI talks to this file, and this file talks to Neon.
// The Neon connection string stays on Vercel. The npm package never sees it —
// shipping a Postgres URL would hand every user write and DROP on the database.
//
// Env (Vercel project settings):
//   NEON_DATABASE_URL   pooled connection string from the Neon console
//
// The package only ever knows this URL, so moving off Neon later means editing
// this file — not republishing analyzthis_design.

import { neon } from "@neondatabase/serverless";

const MAX_ROWS = 50;

const LIMITS = {
  install_id: 64,
  package_version: 24,
  feedback_id: 64,
  persona: 32,
  outcome: 24,
  task_type: 64,
  user_comment: 2000,
  assistant_rejected: 4000,
  assistant_preferred: 4000,
  task_summary: 600,
  problem_type: 64,
  mode: 32,
  level: 24,
  benchmark_version: 40,
  validator_version: 40,
  judge_policy_version: 40,
  prompt_hash: 80,
  effort: 16,
  output_format: 48,
  model_id: 160,
};

const PERSONA_RE = /^[a-z][a-z0-9_-]{0,31}$/;
const OUTCOMES = new Set(["shipped", "revised", "blocked_correctly", "missed"]);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST." });
    return;
  }

  const url = process.env.NEON_DATABASE_URL;
  if (!url) {
    res.status(503).json({ error: "Feedback store is not connected yet." });
    return;
  }

  try {
    const payload = readBody(req);
    const kind = ["scores", "calibration"].includes(payload.kind) ? payload.kind : "corrections";
    const rows = Array.isArray(payload.rows) ? payload.rows : [];

    if (!rows.length) {
      res.status(400).json({ error: "No rows supplied." });
      return;
    }
    if (rows.length > MAX_ROWS) {
      res.status(413).json({ error: `At most ${MAX_ROWS} rows per request.` });
      return;
    }

    const sql = neon(url);
    const inserted = kind === "scores"
      ? await insertScores(sql, rows)
      : kind === "calibration"
        ? await insertCalibration(sql, rows)
        : await insertCorrections(sql, rows);

    res.status(200).json({ ok: true, inserted });
  } catch (error) {
    const status = error.status || 400;
    res.status(status).json({ error: error.message || "Unable to record feedback." });
  }
}

async function insertCorrections(sql, rows) {
  let inserted = 0;
  for (const raw of rows) {
    const r = validateCommon(raw);
    // Replays are idempotent — the client keeps its own unsent queue and a
    // dropped response must not double-count a persona.
    const out = await sql`
      insert into persona_feedback (
        install_id, package_version, feedback_id, persona, satisfied, rating,
        tags, outcome, task_type, user_comment, assistant_rejected,
        assistant_preferred, task_summary, problem_type, mode, recorded_at
      ) values (
        ${r.install_id}, ${r.package_version}, ${r.feedback_id}, ${r.persona},
        ${bool(raw.satisfied)}, ${rating(raw.rating)}, ${tags(raw.tags)},
        ${enumOrNull(raw.outcome, OUTCOMES)}, ${clean(raw.task_type, LIMITS.task_type)},
        ${clean(raw.user_comment, LIMITS.user_comment)},
        ${clean(raw.assistant_rejected, LIMITS.assistant_rejected)},
        ${clean(raw.assistant_preferred, LIMITS.assistant_preferred)},
        ${clean(raw.task_summary, LIMITS.task_summary)},
        ${clean(raw.problem_type, LIMITS.problem_type)},
        ${clean(raw.mode, LIMITS.mode)}, ${isoOrNull(raw.recorded_at)}
      )
      on conflict (install_id, feedback_id) do nothing
      returning id`;
    inserted += out.length;
  }
  return inserted;
}

async function insertScores(sql, rows) {
  let inserted = 0;
  for (const raw of rows) {
    const r = validateCommon(raw, { requireFeedbackId: false });
    const out = await sql`
      insert into persona_scores (
        install_id, package_version, persona, score, level, evidence_count,
        shipped, revised, blocked_correctly, missed, avg_rating
      ) values (
        ${r.install_id}, ${r.package_version}, ${r.persona},
        ${int(raw.score, 0, 100)}, ${clean(raw.level, LIMITS.level)},
        ${int(raw.evidence_count, 0, 1e6) ?? 0},
        ${int(raw.shipped, 0, 1e6) ?? 0}, ${int(raw.revised, 0, 1e6) ?? 0},
        ${int(raw.blocked_correctly, 0, 1e6) ?? 0}, ${int(raw.missed, 0, 1e6) ?? 0},
        ${num(raw.avg_rating, 0, 5)}
      )
      on conflict (install_id, persona, package_version) do update set
        score = excluded.score,
        level = excluded.level,
        evidence_count = excluded.evidence_count,
        shipped = excluded.shipped,
        revised = excluded.revised,
        blocked_correctly = excluded.blocked_correctly,
        missed = excluded.missed,
        avg_rating = excluded.avg_rating,
        updated_at = now()
      returning id`;
    inserted += out.length;
  }
  return inserted;
}

async function insertCalibration(sql, rows) {
  let inserted = 0;
  for (const raw of rows) {
    const r = validateCommon(raw, { requireFeedbackId: false });
    const benchmark = clean(raw.benchmark_version, LIMITS.benchmark_version);
    const validator = clean(raw.validator_version, LIMITS.validator_version);
    const judge = clean(raw.judge_policy_version, LIMITS.judge_policy_version);
    const promptHash = clean(raw.prompt_hash, LIMITS.prompt_hash);
    const effort = clean(raw.effort, LIMITS.effort);
    const outputFormat = clean(raw.output_format, LIMITS.output_format);
    const modelId = clean(raw.model_id, LIMITS.model_id);
    if (!benchmark || !validator || !judge || !promptHash || !effort || !outputFormat || !modelId) {
      throw bad("Calibration version, prompt, effort, format, and model fields are required.");
    }
    const out = await sql`
      insert into calibration_results (
        install_id, package_version, benchmark_version, validator_version,
        judge_policy_version, prompt_hash, persona, effort, output_format,
        model_id, sample_count, score_mean, score_variance, pass_rate,
        latency_ms, availability_rate, cost_usd
      ) values (
        ${r.install_id}, ${r.package_version}, ${benchmark}, ${validator},
        ${judge}, ${promptHash}, ${r.persona}, ${effort}, ${outputFormat},
        ${modelId}, ${int(raw.sample_count, 1, 10000) ?? 1},
        ${num(raw.score_mean, 0, 1)}, ${num(raw.score_variance, 0, 1)},
        ${num(raw.pass_rate, 0, 1)}, ${int(raw.latency_ms, 0, 86400000)},
        ${num(raw.availability_rate, 0, 1)}, ${num(raw.cost_usd, 0, 100000)}
      )
      on conflict (
        install_id, package_version, benchmark_version, validator_version,
        judge_policy_version, prompt_hash, persona, effort, output_format, model_id
      ) do update set
        sample_count = excluded.sample_count,
        score_mean = excluded.score_mean,
        score_variance = excluded.score_variance,
        pass_rate = excluded.pass_rate,
        latency_ms = excluded.latency_ms,
        availability_rate = excluded.availability_rate,
        cost_usd = excluded.cost_usd,
        updated_at = now()
      returning id`;
    inserted += out.length;
  }
  return inserted;
}

function validateCommon(raw, { requireFeedbackId = true } = {}) {
  const install_id = clean(raw.install_id, LIMITS.install_id);
  const persona = clean(raw.persona, LIMITS.persona).toLowerCase();
  if (!install_id) throw bad("install_id is required.");
  if (!PERSONA_RE.test(persona)) throw bad(`Invalid persona: ${persona || "(empty)"}`);
  const feedback_id = clean(raw.feedback_id, LIMITS.feedback_id);
  if (requireFeedbackId && !feedback_id) throw bad("feedback_id is required.");
  return {
    install_id,
    persona,
    feedback_id: feedback_id || null,
    package_version: clean(raw.package_version, LIMITS.package_version) || null,
  };
}

function readBody(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : String(req.body || "");
  if (!rawBody.trim()) throw bad("Missing request body.");
  try {
    return JSON.parse(rawBody);
  } catch {
    throw bad("Request body must be valid JSON.");
  }
}

function bad(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function clean(value, maxLength) {
  if (value === null || value === undefined) return "";
  const s = String(value).replace(/\s+/g, " ").trim();
  return s.length > maxLength ? s.slice(0, maxLength) : s;
}

function bool(v) { return v === true || v === "true"; }

function rating(v) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}

function int(v, lo, hi) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

function num(v, lo, hi) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(lo, Math.min(hi, n));
}

function enumOrNull(v, allowed) {
  const s = clean(v, 32);
  return allowed.has(s) ? s : null;
}

function isoOrNull(v) {
  const s = clean(v, 40);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function tags(v) {
  if (!Array.isArray(v)) return [];
  return v.map((t) => clean(t, 40)).filter(Boolean).slice(0, 12);
}
