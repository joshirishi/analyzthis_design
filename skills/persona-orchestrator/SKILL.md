---
name: persona-orchestrator
description: Agentic critique entry point for existing designs — MoE router, session state, ux-story-gate intake, persona chain, DS/hierarchy/verify gates, SHIP/REVISE/BLOCK verdict. Not for wireframes; use ux-ideator, noor, or anuj for new screen layout and text wireframes.
---

# Persona Orchestrator

The graph, not the room. This skill doesn't have a design opinion of its own — it loads the manifests in `agents/`, runs `ux-story-gate` for intake, picks the right personas via the MoE router, drives them through the chain with shared session state, and enforces the hard gates before handing back a verdict.

Use this as the **default entry point for critique** — reviewing, scoring, and gating existing designs. For wireframes and new screen layout, use `/ux-ideator`, `/noor`, or `/anuj` instead (see below).

---

## Not for wireframes — redirect to ideation skills

**Do not run this orchestrator when the user asks for wireframes, mockups, screen layout, IA concepts, or designing a new screen from scratch.**

When you detect these signals — `wireframe`, `mockup`, `new screen`, `design from scratch`, `layout`, `IA concept`, `ux ideator` — **stop and tell the user to invoke `/ux-ideator`** (full two-concept flow) or `/noor` / `/anuj` (single text wireframe). Do not run the critique chain or lite persona cards for wireframe asks.

`/noor`, `/arjun`, `/zara`, and the other persona skills still work standalone for targeted follow-ups after a wireframe or critique session.

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
- **Ideation / concept-generation ask:** use `ideation_chain` from `agents/chain.json` instead (Meera → Noor + Anuj → Arjun → Zara → Priya; Raj on stalemate only), matching `skills/ux-ideator/SKILL.md`.

**Early DS exit (before running the chain):** if `ds_checklist` has any item marked "at risk" from Phase 0.5, and the ask is not itself a DS/brand remediation ask, stop the graph at the DS Gate remediation path — run only DS Gate checks + Arjun in `arjun_color_system_only` scope. Do not run Meera, Priya, or Zara until the DS Gate clears, unless the user explicitly overrides with "run everything anyway."

**Parallel execution:** check each persona's manifest for `parallel_safe_with`. If two selected experts list each other there (e.g. Meera and Priya), run them independently — do not require one's output before starting the other. Only sequence experts that actually need a prior handoff.

Announce the selected graph and why it's smaller than the full chain, one line: *"Running [chain name] with [persona list] (budget: N) — excluding [excluded personas] per the router. Full chain not run because [reason]."*

---

## Step 3 — Execute adversarial deliberation (v1.19)

Read `deliberation-protocol` from your host skills dir (sibling preferred), e.g. `~/.cursor/skills/deliberation-protocol/SKILL.md`, `~/.claude/skills/deliberation-protocol/SKILL.md`, `~/.grok/skills/deliberation-protocol/SKILL.md`, `~/.agents/skills/deliberation-protocol/SKILL.md`, or legacy `~/.claude/commands/deliberation-protocol.md` **first**. Personas **debate** — they do not pass generic handoff documents.

**Preferred (CLI):** `npx analyzthis_design run --task "..." [--full] [--satisfaction 0.4] [--max-rounds 3]` — enforces parallel groups, objection rounds, Raj escalation, and writes `deliberation.round_log` to session.

**Chat workflow** when not using CLI:

1. Build **context pack** from session: `task_map`, `ds_checklist`, `information_hierarchy`, knowledge bank excerpts
2. Run **deliberation groups** from `agents/chain.json` → `deliberation_groups` (critique / ideation / lite)
3. **Review mode (rounds 0..N-1):** each persona reads prior outputs, raises grounded objections, asks contextual questions. Default `accepts_prior: false`. Output deliberation JSON block per `agents/deliberation-schema.json`
4. **Parallel pairs:** Noor∥Anuj, Meera∥Priya — critique each other's claims in the same round
5. **Produce mode (final round):** full output schema only after objections resolve or Raj rules
6. After each persona: append to `persona_outputs`, update `digest.prior_scores`, append to `deliberation.round_log`
7. **Raj** on stalemate: 2+ blocking objections, repeated claims, or round >= `escalate_to_raj_after_round`

Forbidden in review rounds: generic handoff lines without citing a specific prior claim; rewriting full wireframes/critiques before deliberation closes.

For reference data: `npx analyzthis_design retrieve --file <csv> --column <col> --keywords <a,b>`

Legacy sequential mode: `npx analyzthis_design run --no-deliberate` or skip deliberation-protocol in chat (not recommended).

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

## Step 6.5 — Capture user corrections and outcomes (v1.16 / v1.21)

When the user is **unhappy** with a persona's output or **rewrites/corrects** it, record that signal so future training can learn from mistakes:

```bash
npx analyzthis_design feedback record --persona arjun --rating 2 \
  --comment "What was wrong" \
  --correction "What they wanted instead" \
  --tags wrong_hierarchy,invented_tokens
```

Or in one step when rejecting:

```bash
npx analyzthis_design session accept --persona arjun --reject \
  --comment "..." --correction "..." --rating 2 --tags off_brief
```

Suggest this when the user says things like *"that's not what I meant,"* *"use our tokens,"* or *"the hierarchy is wrong."* Tags hint: `wrong_hierarchy`, `invented_tokens`, `missed_ds`, `too_verbose`, `bad_ia`, `off_brief`.

List or export later: `feedback list`, `feedback export --persona arjun --all`.

**Track whether the advice actually shipped.** After the user implements changes, confirm the outcome so the evolution loop can learn:

```bash
npx analyzthis_design outcome --confirm --persona arjun --result shipped
# or: revised, blocked_correctly, missed
```

**Set visual direction with the team.** Use `/mood-board` when the user wants references and a team-deliberated direction:

```bash
npx analyzthis_design moodboard create --task "B2B fintech dashboard, trustworthy, high-contrast" --auto
npx analyzthis_design moodboard critique --board <boardId>
```

References are tagged, design-system patterns are pulled, and Arjun/Meera/Priya/Zara/Noor deliberate with Honeycomb scoring until consensus.

**Evolve the team.** Periodically (e.g., weekly), run:

```bash
npx analyzthis_design evolve --extract --dry-run   # preview proposed patches
npx analyzthis_design evolve --extract             # write patch files for review
npx analyzthis_design evolve --apply <patchId> --dry-run   # preview a patch
npx analyzthis_design evolve --apply <patchId>    # apply after review
```

This harvests accepted outputs + confirmed outcomes, extracts lessons into `~/.analyzthis_design/lessons/`, and proposes patches to:
- persona SKILL.md / cards (new canonical failure patterns),
- `skills/design-reference/*.csv` rows (new product-type guidance),
- `agents/router.json` rules (task_type → best-performing expert).

Patches are **dry-run by default** and require human review before apply.

**Share with maintainers (opt-in):** after recording, suggest `npx analyzthis_design feedback submit --yes` so anonymized corrections help improve personas for everyone. Preview first with `--dry-run`.

---

## What this skill is not

- **Not a persona.** It has no design opinion — it routes to the ones that do.
- **Not a replacement for `ux-story-gate` or `design-critic`.** It calls them; it doesn't duplicate their logic.
- **Not a code generator by default.** Respects assess-only mode like every other skill in this system.

---

## Files this depends on

- `agents/router.json` — MoE routing rules
- `agents/chain.json` — default and ideation chains, deliberation_groups, gate ordering, token caps
- `agents/deliberation-schema.json` — objection/satisfaction output contract
- `deliberation-protocol` skill — adversarial review rules (v1.19); host path e.g. `~/.claude/skills/deliberation-protocol/SKILL.md`
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
