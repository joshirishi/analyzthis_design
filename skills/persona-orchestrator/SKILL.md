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

## Step 2 — Select the execution graph

Read `agents/router.json` and `agents/chain.json`.

- **If the routing decision from Step 1 names a full-screen review:** run `default_chain` from `agents/chain.json` (Arjun → Meera → Priya → Zara) — this mirrors `skills/design-critic/SKILL.md`.
- **If the routing decision names a narrower problem type:** run only the expert(s) listed in the matching `agents/router.json` rule's `route_to`, in the order their `chain_position` implies. Never include a persona listed under that rule's `never_route_to`.
- **If the ask is an ideation / concept-generation task:** use `ideation_chain` from `agents/chain.json` instead (Meera → Noor + Anuj → Arjun → Zara → Priya → Raj), matching `skills/ux-ideator/SKILL.md`.

Announce the selected graph in one line: *"Running [chain name] with [persona list] — excluding [excluded personas] per the router."*

---

## Step 3 — Execute the chain

For each persona in the selected graph, in order:

1. Load its manifest from `agents/manifests/<persona>.json` — respect `allowed_jobs`, `forbidden_jobs`, and `hard_gates`.
2. Read the persona's `skills/<persona>/SKILL.md` and activate it, passing:
   - The confirmed task map, DS checklist, and information hierarchy from session state
   - The prior persona's output, using the handoff line convention from `skills/design-critic/SKILL.md` (e.g. *"Arjun scored UX at [X/5]. The friction points flagged — [...] — translate to the following business risk..."*)
3. Append the persona's structured output block to `persona_outputs` in session state, keyed by persona id.
4. If a persona's manifest lists `hard_gates` (e.g. Arjun's `ds_gate`, `information_hierarchy_gate`), do not let that persona's output stand until the referenced gate has been checked — see Step 4.

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
DS Gate:          [PASS / FAIL — item(s) at risk]
Hierarchy Gate:   [PASS / FAIL]
Verify Gate:      [pass / fail / not_run]
Verdict:          [SHIP / REVISE / BLOCK]
Mode:             [assess_only / build_approved]
```

If any gate failed or the verdict is BLOCK, escalate to Raj per `design-critic`'s BLOCK escalation rules.

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
- `agents/chain.json` — default and ideation chains, gate ordering
- `agents/session-schema.json` — session state shape
- `agents/manifests/*.json` — per-persona allowed/forbidden jobs and hard gates
- `skills/ux-story-gate/SKILL.md` — intake phases 0 – 1.5, 4.5, 5.5
- `skills/design-critic/SKILL.md` — chain handoff format, Information Hierarchy Gate, BLOCK escalation
- `npx analyzthis_design session init|show|reset` — session state CLI
- `npx analyzthis_design research --url|--query` — writes `web-context.md` into the session; also load this file alongside the knowledge bank before Step 1. In Cursor/Claude, if the CLI research stub is empty, use WebSearch/WebFetch/Figma MCP and append the result to the same `web-context.md` path.
