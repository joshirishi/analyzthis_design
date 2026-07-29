---
name: persona-orchestrator
description: Single entry point for a fully agentic persona run — loads the MoE router and shared session state, runs the ux-story-gate intake phases, executes the right persona chain (full or MoE subset), enforces the DS/hierarchy/verify gates, and synthesizes a Task x Finding table with a SHIP/REVISE/BLOCK verdict. Use this instead of calling individual personas or design-critic directly when you want the whole graph run in one pass, with state persisted between turns.
---

# Persona Orchestrator

The graph, not the room. This skill doesn't have a design opinion of its own — it loads the manifests in `agents/`, runs `ux-story-gate` for intake, picks the right personas via the MoE router, drives them through the chain with shared session state, and enforces the hard gates before handing back a verdict.

Use this as the default entry point. `/noor`, `/arjun`, `/zara`, and the other persona skills still work standalone, but calling them directly bypasses the gate and the router — only do that for a narrow, already-scoped follow-up question.

---

## Step 0 — Load session state

Run (or instruct the host to run) `npx analyzthis_design session show`.

- If a session already exists for this project: read it. Do not re-ask the user for a task map, DS tokens, or routing decision that's already recorded — this is the fix for the "Ask/Agent double spend" failure where context gets re-derived every turn.
- If no session exists: run `npx analyzthis_design session init` to create one, then proceed to Step 1.

Load `agents/session-schema.json` to know the exact shape you're reading and writing.

---

## Step 1 — Run ux-story-gate intake (Phases 0 – 1.5)

Read `skills/ux-story-gate/SKILL.md` and run:
- Phase 0 (PRD discovery) — skip re-deriving anything already present in session state
- Phase 0.5 (DS/Figma discovery) — populate `ds_checklist` and `figma_node`
- Phase 1 (task map intake gate) — populate `task_map`
- Phase 1.5 (MoE router) — populate `routing_decision`

Persist all four outputs to session state before moving on. Do not proceed to Step 2 until Phase 1's gate condition is satisfied (a confirmed task map exists).

---

## Step 2 — Select the execution graph (MoE subset is the default)

Read `agents/router.json` and `agents/chain.json`.

**Default budget is 1–2 experts.** Only run the full `default_chain` (Arjun → Meera → Priya → Zara) when one of these is explicitly true:
- The routing decision's `problem_type` is `full_screen_review`, OR
- The user explicitly asked for a "full critique", "full review", "design-critic", or "run all personas"

Otherwise:
- **Narrower problem type:** run only the expert(s) listed in the matching `agents/router.json` rule's `route_to`, in the order their `chain_position` implies. Never include a persona listed under that rule's `never_route_to`.
- **Ideation / concept-generation ask:** use `ideation_chain` from `agents/chain.json` instead (Meera → Noor + Anuj → Arjun → Zara → Priya → Raj), matching `skills/ux-ideator/SKILL.md`.

**Early DS exit (before running the chain):** if `ds_checklist` has any item marked "at risk" from Phase 0.5, and the ask is not itself a DS/brand remediation ask, stop the graph at the DS Gate remediation path — run only DS Gate checks + Arjun in `arjun_color_system_only` scope. Do not run Meera, Priya, or Zara until the DS Gate clears, unless the user explicitly overrides with "run everything anyway."

**Parallel execution:** check each persona's manifest for `parallel_safe_with`. If two selected experts list each other there (e.g. Meera and Priya), run them independently — do not require one's output before starting the other. Only sequence experts that actually need a prior handoff.

Announce the selected graph and why it's smaller than the full chain, one line: *"Running [chain name] with [persona list] (budget: N) — excluding [excluded personas] per the router. Full chain not run because [reason]."*

---

## Step 3 — Execute the chain

For each persona in the selected graph, in order (or in parallel where Step 2 identified `parallel_safe_with` pairs):

1. Load its manifest from `agents/manifests/<persona>.json` — respect `allowed_jobs`, `forbidden_jobs`, and `hard_gates`.
2. Prefer the persona's short **card** (`agents/cards/<persona>.md`, ~400–800 tokens) as the system context instead of pasting the full `skills/<persona>/SKILL.md`. Only open the full SKILL.md when: scoring a dimension C or below and the rubric detail is needed, the user asked for a "deep dive" or "full critique," or the card itself says to consult it (e.g. Arjun's Grade Rubric tables).
3. Use the **session digest** (`session-state.json` → `digest`) instead of the full `persona_outputs` history when passing prior context — the digest carries `task_map_summary`, `hierarchy_top3`, `ds_at_risk`, and `prior_scores`, which is enough for handoff without re-pasting every prior persona's full essay.
4. Pass the confirmed task map, DS checklist, and information hierarchy from session state, plus the prior persona's output using the handoff line convention from `skills/design-critic/SKILL.md` (e.g. *"Arjun scored UX at [X/5]. The friction points flagged — [...] — translate to the following business risk..."*).
   - For reference-data citations, prefer `npx analyzthis_design retrieve --file <csv> --column <col> --keywords <a,b>` over opening the full CSV — it returns only the matching rows for the active dimension (e.g. brand route → `colors.csv` + contrast rows from `ux-guidelines.csv`), pre-formatted for the mandatory citation line.
5. Use the **lite output schema** by default (grades + Top 2 fixes + score only — see the persona's card). Use the **deep schema** (full blocks as in the persona's SKILL.md) only when the user asked for a full/deep critique, or `agents/chain.json`'s `default_chain` is running.
6. Append the persona's structured output block to `persona_outputs` in session state, keyed by persona id, and update `digest.prior_scores[persona_id]`.
7. If a persona's manifest lists `hard_gates` (e.g. Arjun's `ds_gate`, `information_hierarchy_gate`), do not let that persona's output stand until the referenced gate has been checked — see Step 4.

If a persona's manifest forbids the job being asked of it (e.g. asking Zara to fix contrast), refuse on that persona's behalf and re-route per `agents/router.json` instead of forcing the run.

---

## Step 4 — Hard gates

Run in this order, after the chain completes:

1. **DS Gate** — re-check the DS Token Checklist from Phase 0.5. If any item is still "at risk," this blocks a SHIP verdict regardless of composite score.
2. **Information Hierarchy Gate** — read `skills/design-critic/SKILL.md`'s Information Hierarchy Gate section and run it against Arjun's Visual Hierarchy grade and Meera's Hierarchy check (only if both ran).
3. **Verify Gate** — run `ux-story-gate` Phase 4.5 (browser automation) against the primary task. Record `verify_results` in session state.

Any gate failure is inserted into the Top 3 actionable changes automatically, same as the Information Hierarchy Gate rule in `design-critic`.

---

## Step 5 — Synthesize verdict

Produce the Task × Finding table (format from `ux-story-gate` Phase 5) or the Composite Score block (format from `design-critic` Phase 5), depending on which graph ran. Include:

```
## Orchestrator Run Summary
Graph:            [default_chain / ideation_chain / MoE subset: persona list]
Experts run:      [N] (budget) — [persona list]
DS Gate:          [PASS / FAIL — item(s) at risk]
Hierarchy Gate:   [PASS / FAIL]
Verify Gate:      [pass / fail / not_run]
Verdict:          [SHIP / REVISE / BLOCK]
Mode:             [assess_only / build_approved]
Est. tokens:      [input/output estimate — see metrics in session state]
```

Update `session-state.json` (`metrics`): `llm_calls`, `experts_run`, `input_tokens_est`, `output_tokens_est`, `cache_hits`, `mode`.

If any gate failed or the verdict is BLOCK, escalate to Raj per `design-critic`'s BLOCK escalation rules.

**Delta re-evaluation (mandatory on any follow-up after REVISE):** when the user applies changes and asks for a re-check, do NOT re-run the full graph. Read `session-state.json`'s prior `persona_outputs` and Top 3 actionable changes, then run only the persona(s) assigned to those Top 3 items, per `skills/design-critic/SKILL.md`'s Re-evaluation Protocol. Update only the affected `digest.prior_scores` entries and re-check the Information Hierarchy Gate. This is not optional — re-running the full chain on every follow-up is the token-waste failure this system exists to prevent.

---

## Step 6 — Respect assess-only mode

Run `ux-story-gate` Phase 5.5. If `mode: assess_only`, stop here — do not write or edit code. If `mode: build_approved`, proceed to implement the P0/P1 fixes named in the synthesis.

---

## What this skill is not

- **Not a persona.** It has no design opinion — it routes to the ones that do.
- **Not a replacement for `ux-story-gate` or `design-critic`.** It calls them; it doesn't duplicate their logic.
- **Not a code generator by default.** Respects assess-only mode like every other skill in this system.

---

## Files this depends on

- `agents/router.json` — MoE routing rules
- `agents/chain.json` — default and ideation chains, gate ordering, `parallel_safe_with`, tiers, token caps
- `agents/session-schema.json` — session state shape, including `digest` and `metrics`
- `agents/manifests/*.json` — per-persona allowed/forbidden jobs, hard gates, `system_card`, `tier`, `max_output_tokens`
- `agents/cards/*.md` — short persona system prompts used by default instead of full SKILL.md
- `skills/ux-story-gate/SKILL.md` — intake phases 0 – 1.5, 4.5, 5.5
- `skills/design-critic/SKILL.md` — chain handoff format, Information Hierarchy Gate, BLOCK escalation, Re-evaluation Protocol
- `npx analyzthis_design session init|show|reset` — session state CLI
- `npx analyzthis_design research --url|--query` — writes `web-context.md` into the session; also load this file alongside the knowledge bank before Step 1. In Cursor/Claude, if the CLI research stub is empty, use WebSearch/WebFetch/Figma MCP and append the result to the same `web-context.md` path.

## Efficiency defaults

- Default to the **MoE subset**, not the full chain — see Step 2.
- Default to **cards + lite schema**, not full SKILL.md + deep schema — see Step 3.
- Default to **delta re-evaluation** on follow-ups, not a full re-run — see Step 5.
- Skip Phase 4.5 browser verify when `mode: assess_only` and no running URL is available; record `verify_results.primary_task: "not_run"` rather than skipping silently.
