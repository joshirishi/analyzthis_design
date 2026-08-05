'use strict';

/**
 * Adversarial deliberation engine (v1.19).
 * Personas review prior output with low default satisfaction until consensus or Raj.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_FILE = path.join(os.homedir(), '.analyzthis_design', 'config.json');

const DEFAULTS = {
  satisfaction_threshold: 0.4,
  max_rounds: 3,
  parallel_pairs: [['noor', 'anuj'], ['meera', 'priya']],
  objection_token_cap: 600,
  escalate_to_raj_after_round: 2,
  default_mode: 'adversarial',
};

const DELIBERATION_JSON_HINT = `
End your response with a fenced JSON block:
\`\`\`json deliberation
{
  "grounding": [{"type": "task_map", "ref": "task_map[0]", "note": "..."}],
  "satisfaction_with_prior": 0.3,
  "accepts_prior": false,
  "objections": [{"target_persona": "arjun", "claim": "...", "evidence_required": "...", "blocking": true, "grounded_in": "..."}],
  "questions": ["..."],
  "revisions": ["..."],
  "verdict": "CONTEST"
}
\`\`\``;

function loadDeliberationConfig(configIn) {
  let cfg = configIn;
  if (!cfg) {
    try {
      cfg = fs.existsSync(CONFIG_FILE) ? JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) : {};
    } catch {
      cfg = {};
    }
  }
  const d = cfg.deliberation || {};
  return {
    satisfaction_threshold: d.satisfaction_threshold ?? DEFAULTS.satisfaction_threshold,
    max_rounds: d.max_rounds ?? DEFAULTS.max_rounds,
    parallel_pairs: d.parallel_pairs ?? DEFAULTS.parallel_pairs,
    objection_token_cap: d.objection_token_cap ?? DEFAULTS.objection_token_cap,
    escalate_to_raj_after_round: d.escalate_to_raj_after_round ?? DEFAULTS.escalate_to_raj_after_round,
    default_mode: d.default_mode ?? DEFAULTS.default_mode,
  };
}

function readVaultExcerpt(vaultPath, maxChars = 2000) {
  if (!vaultPath || !fs.existsSync(vaultPath)) return '';
  const parts = [];
  const folders = ['PRDs', 'Brand', 'Components', 'Product'];
  for (const folder of folders) {
    const dir = path.join(vaultPath, folder);
    if (!fs.existsSync(dir)) continue;
    try {
      for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.md')).slice(0, 2)) {
        const text = fs.readFileSync(path.join(dir, f), 'utf8');
        parts.push(`--- ${folder}/${f} ---\n${text.slice(0, 500)}`);
      }
    } catch { /* skip unreadable */ }
    if (parts.join('').length > maxChars) break;
  }
  return parts.join('\n\n').slice(0, maxChars);
}

/**
 * Build shared context pack from session state.
 */
function buildContextPack(state, task, figma = '') {
  const taskMap = (state.task_map || []).slice(0, 8).map((t, i) => ({
    id: i,
    task: t.task,
    frequency: t.frequency,
    priority: t.priority,
  }));

  return {
    task,
    figma: figma || state.figma_node?.url || '',
    task_map: taskMap,
    task_map_summary: state.digest?.task_map_summary || task.slice(0, 240),
    hierarchy_top3: state.digest?.hierarchy_top3 || state.information_hierarchy?.ranking?.slice(0, 3) || [],
    ds_checklist: state.ds_checklist || {},
    ds_at_risk: state.digest?.ds_at_risk || [],
    design_spec_status: state.digest?.design_spec_status || state.design_spec?.status || '',
    vault_excerpt: readVaultExcerpt(state.vault_path),
    mode: state.mode || 'assess_only',
  };
}

/**
 * Parse deliberation JSON from persona LLM output.
 */
function parseDeliberationOutput(text) {
  const empty = {
    grounding: [],
    satisfaction_with_prior: 0,
    accepts_prior: false,
    objections: [],
    questions: [],
    revisions: [],
    verdict: 'CONTEST',
    synthesis: '',
  };

  if (!text || typeof text !== 'string') return { ...empty, parse_error: 'empty' };

  const fence = text.match(/```json\s*deliberation\s*([\s\S]*?)```/i)
    || text.match(/```json\s*([\s\S]*?)```/);
  if (fence) {
    try {
      const parsed = JSON.parse(fence[1].trim());
      return {
        grounding: parsed.grounding || [],
        satisfaction_with_prior: Number(parsed.satisfaction_with_prior) || 0,
        accepts_prior: !!parsed.accepts_prior,
        objections: Array.isArray(parsed.objections) ? parsed.objections : [],
        questions: Array.isArray(parsed.questions) ? parsed.questions : [],
        revisions: Array.isArray(parsed.revisions) ? parsed.revisions : [],
        verdict: parsed.verdict || 'CONTEST',
        synthesis: parsed.synthesis || '',
      };
    } catch (e) {
      return { ...empty, parse_error: e.message };
    }
  }

  // Fallback: infer low satisfaction if output mentions objection language
  const lower = text.toLowerCase();
  const hasObjection = /objection|contest|disagree|not satisfied|blocking|evidence required/.test(lower);
  return {
    ...empty,
    satisfaction_with_prior: hasObjection ? 0.2 : 0.5,
    accepts_prior: !hasObjection,
    verdict: hasObjection ? 'CONTEST' : 'ACCEPT',
    synthesis: text.slice(0, 500),
    parse_error: 'no_json_fence',
  };
}

function objectionKey(obj) {
  return `${obj.target_persona || ''}:${(obj.claim || '').slice(0, 80)}`.toLowerCase();
}

/**
 * Compute round status from round log and threshold.
 */
function computeRoundStatus(roundLog, threshold, priorOpen = []) {
  const open = [...priorOpen];
  const seenClaims = new Set();
  let objectionsRaised = 0;
  let objectionsResolved = 0;
  const personasMustRerun = new Set();

  for (const entry of roundLog) {
    const parsed = entry.parsed || {};
    if (parsed.objections?.length) {
      for (const obj of parsed.objections) {
        objectionsRaised += 1;
        const key = objectionKey(obj);
        if (obj.blocking && !parsed.accepts_prior) {
          if (!seenClaims.has(key)) {
            seenClaims.add(key);
            open.push({ ...obj, raised_by: entry.persona, round: entry.round });
          }
          if (obj.target_persona) personasMustRerun.add(obj.target_persona);
        }
      }
    }
    if (parsed.accepts_prior && parsed.satisfaction_with_prior >= threshold) {
      objectionsResolved += parsed.objections?.filter((o) => !o.blocking).length || 0;
    } else if (entry.persona) {
      personasMustRerun.add(entry.persona);
    }
  }

  // Remove resolved: target persona accepted in a later round
  const filteredOpen = open.filter((obj) => {
    const resolved = roundLog.some((e) =>
      e.persona === obj.target_persona
      && e.parsed?.accepts_prior
      && (e.parsed?.satisfaction_with_prior || 0) >= threshold);
    if (resolved) objectionsResolved += 1;
    return !resolved;
  });

  const blockingCount = filteredOpen.filter((o) => o.blocking).length;
  const repeatClaims = new Set();
  const claimCounts = {};
  for (const o of filteredOpen) {
    const k = objectionKey(o);
    claimCounts[k] = (claimCounts[k] || 0) + 1;
    if (claimCounts[k] >= 2) repeatClaims.add(k);
  }

  return {
    open_objections: filteredOpen,
    blocking_count: blockingCount,
    repeat_claims: [...repeatClaims],
    personas_must_rerun: [...personasMustRerun],
    consensus_reached: blockingCount === 0 && roundLog.length > 0
      && roundLog.every((e) => (e.parsed?.satisfaction_with_prior || 0) >= threshold || e.parsed?.accepts_prior),
    objections_raised: objectionsRaised,
    objections_resolved: objectionsResolved,
  };
}

function shouldEscalateToRaj(status, config, currentRound) {
  if (status.blocking_count >= 2) return true;
  if (status.repeat_claims.length >= 1) return true;
  if (currentRound >= (config.escalate_to_raj_after_round || 2) && status.blocking_count >= 1) return true;
  return false;
}

/**
 * Resolve deliberation groups for this run.
 */
function getDeliberationGroups(chain, { full_chain, ideation_chain, experts, mode }) {
  const groups = chain.deliberation_groups || {};
  if (ideation_chain) return groups.ideation || [['meera'], ['noor', 'anuj'], ['arjun'], ['zara', 'priya']];
  if (full_chain) return groups.critique || [['arjun'], ['meera', 'priya'], ['zara']];
  if (mode === 'lite') {
    const lite = groups.lite || [['arjun'], ['meera']];
    const expertSet = new Set(experts || []);
    return lite.map((g) => g.filter((p) => expertSet.has(p))).filter((g) => g.length);
  }
  // MoE subset: one persona per group max, preserve order
  const result = [];
  for (const id of experts || []) result.push([id]);
  return result;
}

function summarizePriorOutputs(personaOutputs, personaIds) {
  const lines = [];
  for (const id of personaIds) {
    const entry = personaOutputs[id];
    if (!entry?.text) continue;
    lines.push(`### ${id}\n${entry.text.slice(0, 1200)}${entry.text.length > 1200 ? '…' : ''}`);
  }
  return lines.join('\n\n');
}

/**
 * Build user prompt for review/objection round.
 */
function buildObjectionPrompt({
  persona,
  contextPack,
  priorOutputs,
  openObjections,
  round,
  maxRounds,
  threshold,
  isProduceRound,
  task,
  routingLine,
  referenceCitations,
}) {
  const priorIds = Object.keys(priorOutputs || {}).filter((id) => id !== persona);
  const priorSummary = summarizePriorOutputs(priorOutputs, priorIds);

  const modeLine = isProduceRound
    ? 'PRODUCE MODE (final round): synthesize your full output after deliberation.'
    : `REVIEW MODE (round ${round}/${maxRounds}): critique prior output — do NOT rewrite full wireframe/critique essays.`;

  const parts = [
    modeLine,
    `Satisfaction threshold: ${threshold} — default accepts_prior=false until evidence addresses objections.`,
    '',
    `Task: ${task}`,
    routingLine || '',
    referenceCitations ? `Reference data:\n${referenceCitations}` : '',
    '',
    'Context pack (cite these in grounding[]):',
    JSON.stringify(contextPack, null, 2).slice(0, 3000),
  ];

  if (priorSummary) {
    parts.push('', 'Prior persona outputs (read critically — contest specific claims):', priorSummary);
  }

  if (openObjections?.length) {
    parts.push('', 'Open objections you must address or extend:', JSON.stringify(openObjections.slice(0, 10), null, 2));
  }

  if (!isProduceRound) {
    if (round > 0) {
      parts.push('', `Rebuttal round ${round}/${maxRounds}: address open objections with NEW evidence. Do not repeat prior paragraphs verbatim.`);
    }
    parts.push('', 'Requirements:',
      '- Every objection must include grounded_in citing task_map, PRD, UI region, or DS token.',
      '- Ask at least one contextual question about the real task/UI/PRD.',
      '- Do not write generic handoff paragraphs.',
      DELIBERATION_JSON_HINT);
  } else {
    parts.push('', 'Produce final structured output + deliberation JSON block.', DELIBERATION_JSON_HINT);
  }

  return parts.filter(Boolean).join('\n');
}

function buildRajPrompt(contextPack, personaOutputs, openObjections, roundLog) {
  return [
    'STALEMATE — arbitrate unresolved persona disagreements using your 5 product principles.',
    '',
    'Context:', JSON.stringify(contextPack, null, 2).slice(0, 2000),
    '',
    'Persona outputs:', summarizePriorOutputs(personaOutputs, Object.keys(personaOutputs || {})),
    '',
    'Open objections:', JSON.stringify(openObjections, null, 2),
    '',
    'Round log summary:', JSON.stringify(roundLog.slice(-8).map((r) => ({
      round: r.round, persona: r.persona, verdict: r.parsed?.verdict, blocking: r.parsed?.objections?.filter((o) => o.blocking).length,
    })), null, 2),
    '',
    'Output mandatory Stalemate Resolution block + deliberation JSON with verdict SHIP|REVISE|BLOCK.',
    DELIBERATION_JSON_HINT,
  ].join('\n');
}

/**
 * Extract score from persona text for digest.prior_scores.
 */
function extractScore(text) {
  const m = text.match(/(\d+(?:\.\d+)?)\s*\/\s*5/) || text.match(/score[:\s]+(\d+(?:\.\d+)?)/i);
  return m ? Number(m[1]) : null;
}

/**
 * Run full adversarial deliberation loop.
 * @param {object} opts
 * @param {function} opts.callPersona — async (personaId, system, user, opts) => { text, tokens... }
 */
async function runDeliberation(opts) {
  const {
    chain,
    experts,
    full_chain,
    ideation_chain,
    mode,
    task,
    routing,
    state,
    figma,
    config,
    callPersona,
    loadPersonaContext,
    buildReferencePack,
    noDeliberate = false,
  } = opts;

  const dConfig = loadDeliberationConfig(config);
  const threshold = opts.satisfaction_threshold ?? dConfig.satisfaction_threshold;
  const maxRounds = opts.max_rounds ?? dConfig.max_rounds;

  if (noDeliberate || dConfig.default_mode === 'legacy') {
    return runLegacySequential(opts);
  }

  const contextPack = buildContextPack(state, task, figma);
  const groups = getDeliberationGroups(chain, { full_chain, ideation_chain, experts, mode });
  const checkpoint = opts.resume_checkpoint || state.host_run?.checkpoint || null;

  const persona_outputs = { ...(checkpoint?.persona_outputs || state.persona_outputs || {}) };
  const round_log = [...(checkpoint?.round_log || [])];
  let open_objections = [...(checkpoint?.open_objections || [])];
  let round = checkpoint?.round ?? 0;
  let raj_escalated = checkpoint?.raj_escalated ?? false;
  let llm_calls = checkpoint?.llm_calls ?? 0;
  let input_tokens_est = checkpoint?.input_tokens_est ?? 0;
  let output_tokens_est = checkpoint?.output_tokens_est ?? 0;
  const effort_log = [...(checkpoint?.effort_log || [])];
  let objections_raised = checkpoint?.objections_raised ?? 0;
  let objections_resolved = checkpoint?.objections_resolved ?? 0;

  const routingLine = `Routing: ${routing.problem_type} → ${experts.join(', ')}`;
  const startGroupIndex = checkpoint?.group_index ?? 0;
  const startGroupRound = checkpoint?.group_round ?? 0;

  // Execute deliberation groups — Raj runs AFTER all groups (never before Zara)
  for (let groupIndex = startGroupIndex; groupIndex < groups.length; groupIndex++) {
    const group = groups[groupIndex];
    let groupRound = groupIndex === startGroupIndex ? startGroupRound : 0;
    while (groupRound <= maxRounds) {
      const isProduceRound = groupRound === maxRounds;
      const personasToRun = group.filter((id) => {
        if (groupRound === 0) return true;
        const status = computeRoundStatus(round_log, threshold, open_objections);
        return status.personas_must_rerun.includes(id) || !round_log.some((e) => e.persona === id && e.parsed?.accepts_prior);
      });

      if (!personasToRun.length && groupRound > 0) break;

      const runOne = async (personaId) => {
        const { system, manifest, effort, callProvider, callModel, maxTokens, referencePack } =
          await loadPersonaContext(personaId, {
            isProduceRound,
            isObjectionRound: !isProduceRound,
            objectionCap: dConfig.objection_token_cap,
          });

        const user = buildObjectionPrompt({
          persona: personaId,
          contextPack,
          priorOutputs: persona_outputs,
          openObjections: open_objections,
          round: groupRound,
          maxRounds,
          threshold,
          isProduceRound,
          task,
          routingLine,
          referenceCitations: referencePack?.citations?.join('\n'),
        });

        let result;
        try {
          result = await callPersona(personaId, system, user, {
            provider: callProvider,
            model: callModel,
            maxTokens: isProduceRound ? maxTokens : Math.min(maxTokens, dConfig.objection_token_cap),
            effort,
          });
        } catch (err) {
          if (err.name === 'HostLlmPendingError') {
            err.checkpoint = {
              group_index: groupIndex,
              group_round: groupRound,
              persona_outputs,
              round_log,
              round,
              open_objections,
              raj_escalated,
              llm_calls,
              input_tokens_est,
              output_tokens_est,
              effort_log,
              objections_raised,
              objections_resolved,
            };
          }
          throw err;
        }

        llm_calls += 1;
        input_tokens_est += result.input_tokens_est || 0;
        output_tokens_est += result.output_tokens_est || 0;
        effort_log.push(result.effort_log_entry);

        const parsed = parseDeliberationOutput(result.text);
        const entry = {
          round: round,
          persona: personaId,
          parsed,
          raw_length: result.text.length,
          at: new Date().toISOString(),
        };
        round_log.push(entry);

        persona_outputs[personaId] = {
          text: result.text,
          deliberation: parsed,
          at: entry.at,
          accepted: null,
        };

        return entry;
      };

      await Promise.all(personasToRun.map((id) => runOne(id)));

      round += 1;
      const status = computeRoundStatus(round_log, threshold, open_objections);
      open_objections = status.open_objections;
      objections_raised += status.objections_raised;
      objections_resolved += status.objections_resolved;

      if (status.consensus_reached) break;

      groupRound += 1;
      if (groupRound > maxRounds) break;
    }
  }

  // Raj escalation after ALL deliberation groups (critique: Zara always runs before Raj)
  const preRajStatus = computeRoundStatus(round_log, threshold, open_objections);
  open_objections = preRajStatus.open_objections;
  if (shouldEscalateToRaj(preRajStatus, dConfig, round) && !raj_escalated) {
    raj_escalated = true;
    const rajCtx = await loadPersonaContext('raj', { isProduceRound: true, isObjectionRound: false });
    const rajUser = buildRajPrompt(contextPack, persona_outputs, open_objections, round_log);
    const rajResult = await callPersona('raj', rajCtx.system, rajUser, {
      provider: rajCtx.callProvider,
      model: rajCtx.callModel,
      maxTokens: rajCtx.maxTokens,
      effort: 'hard',
    });
    llm_calls += 1;
    input_tokens_est += rajResult.input_tokens_est || 0;
    output_tokens_est += rajResult.output_tokens_est || 0;
    const rajParsed = parseDeliberationOutput(rajResult.text);
    round_log.push({ round, persona: 'raj', parsed: rajParsed, raw_length: rajResult.text.length, at: new Date().toISOString() });
    persona_outputs.raj = { text: rajResult.text, deliberation: rajParsed, at: new Date().toISOString(), accepted: null };
    open_objections = [];
  }

  const prior_scores = { ...(state.digest?.prior_scores || {}) };
  for (const [id, out] of Object.entries(persona_outputs)) {
    const score = extractScore(out.text);
    if (score != null) prior_scores[id] = score;
  }

  const finalStatus = computeRoundStatus(round_log, threshold, []);

  return {
    persona_outputs,
    deliberation: {
      round,
      max_rounds: maxRounds,
      satisfaction_threshold: threshold,
      open_objections: finalStatus.open_objections,
      round_log,
      consensus_reached: finalStatus.consensus_reached,
      raj_escalated,
      mode: 'adversarial',
    },
    digest_patch: { prior_scores },
    metrics: {
      llm_calls,
      input_tokens_est,
      output_tokens_est,
      deliberation_rounds: round,
      objections_raised,
      objections_resolved,
      raj_escalations: raj_escalated ? 1 : 0,
      effort_log,
    },
  };
}

/** Legacy sequential pass-the-parcel ( --no-deliberate ) */
async function runLegacySequential(opts) {
  const {
    experts, task, routing, state, figma, callPersona, loadPersonaContext, buildReferencePack,
  } = opts;

  const persona_outputs = {};
  let llm_calls = 0;
  let input_tokens_est = 0;
  let output_tokens_est = 0;
  const effort_log = [];
  const contextPack = buildContextPack(state, task, figma);
  const digest = { ...(state.digest || {}) };

  for (const id of experts) {
    const ctx = await loadPersonaContext(id, { isProduceRound: true, isObjectionRound: false });
    const referencePack = buildReferencePack ? buildReferencePack(id, task) : null;
    const priorSummary = summarizePriorOutputs(persona_outputs, Object.keys(persona_outputs));

    const user = [
      `Task: ${task}`,
      figma ? `Figma: ${figma}` : '',
      `Routing: ${routing.problem_type} → ${experts.join(', ')}`,
      referencePack ? `Reference data:\n${referencePack.citations.join('\n')}` : '',
      `Session digest: ${JSON.stringify(digest).slice(0, 1500)}`,
      `Context pack: ${JSON.stringify(contextPack).slice(0, 1500)}`,
      priorSummary ? `Prior persona outputs:\n${priorSummary}` : '',
      'Produce your structured output block as defined in your card/skill.',
    ].filter(Boolean).join('\n');

    const result = await callPersona(id, ctx.system, user, {
      provider: ctx.callProvider,
      model: ctx.callModel,
      maxTokens: ctx.maxTokens,
      effort: ctx.effort,
    });

    llm_calls += 1;
    input_tokens_est += result.input_tokens_est || 0;
    output_tokens_est += result.output_tokens_est || 0;
    effort_log.push(result.effort_log_entry);
    persona_outputs[id] = { text: result.text, at: new Date().toISOString(), accepted: null };

    const score = extractScore(result.text);
    if (score != null) {
      digest.prior_scores = { ...(digest.prior_scores || {}), [id]: score };
    }
  }

  return {
    persona_outputs,
    deliberation: {
      round: 0,
      max_rounds: 0,
      satisfaction_threshold: 0,
      open_objections: [],
      round_log: [],
      consensus_reached: true,
      raj_escalated: false,
      mode: 'legacy',
    },
    digest_patch: { prior_scores: digest.prior_scores || {} },
    metrics: {
      llm_calls,
      input_tokens_est,
      output_tokens_est,
      deliberation_rounds: 0,
      objections_raised: 0,
      objections_resolved: 0,
      raj_escalations: 0,
      effort_log,
    },
  };
}

module.exports = {
  loadDeliberationConfig,
  buildContextPack,
  parseDeliberationOutput,
  computeRoundStatus,
  shouldEscalateToRaj,
  getDeliberationGroups,
  buildObjectionPrompt,
  buildRajPrompt,
  runDeliberation,
  runLegacySequential,
  DELIBERATION_JSON_HINT,
  DEFAULTS,
};
