---
name: design-director
description: End-to-end design director — ideation, DesignSpec synthesis, spec gates (DS + hierarchy + visual), then guided implementation when build_approved. Use when you want personas to guide WHAT and HOW to design like a senior designer, not just critique.
---

# Design Director

Orchestrates **brief → wireframe → DesignSpec → spec gates → implementation → verify**.

Unlike `/persona-orchestrator` (critique-only) and unlike bare `/ux-ideator` (stops at wireframe), this skill owns the full **producer** path.

---

## When to use

- "Design and build this screen"
- "Guide the LLM on how to design our settings page"
- "Turn this wireframe into an implementable spec"
- After `/kavi` when starting a new feature

**Prerequisites:** Run `/kavi` or `npx analyzthis_design collect` so tokens and components come from the repo.

---

## Phase 0 — Session + knowledge

1. `npx analyzthis_design session show` — init if missing
2. Read knowledge-bank skill (sibling or `~/.cursor/skills/knowledge-bank/SKILL.md`)
3. Set `mode`:
   - User said assess/propose/review only → `assess_only` (stop after spec)
   - User said build/implement/ship/apply → `build_approved`

Persist `mode` to session state.

---

## Phase 1 — Intake (ux-story-gate)

Run Phases 0–1.5 from `skills/ux-story-gate/SKILL.md`:

- PRD / task map
- DS checklist + Figma node if available
- MoE routing (for context only — this skill overrides chain selection)

Do not skip the task map.

---

## Phase 2 — Ideation (wireframes)

Run `skills/ux-ideator/SKILL.md` Phases 1–4 (Meera → Noor + Anuj → deliberation).

**Mandatory:** full Concept A/B text wireframes (deep schema), not lite cards.

Output: one **synthesized wireframe** with declared information hierarchy.

---

## Phase 3 — DesignSpec synthesis

Read `skills/design-spec/SKILL.md`.

Convert the synthesized wireframe into a complete **DesignSpec** JSON block:

- Map every visible region → `layout.regions`
- Map every interactive element → `components[]` with real import paths from the repo
- Copy token values from knowledge bank / tailwind.config — set `tokens.source`
- Fill all four `states`
- Add `do` / `dont` from persona deliberation
- Set `"status": "spec_review"`

Persist:

```bash
npx analyzthis_design spec validate   # host extracts ```design-spec``` block and validates
```

Update session `design_spec` and `information_hierarchy.ranking` from the spec.

---

## Phase 4 — Spec gates + adversarial spec review (v1.19)

Read `deliberation-protocol` from your host skills dir (sibling preferred), e.g. `~/.cursor/skills/deliberation-protocol/SKILL.md`, `~/.claude/skills/deliberation-protocol/SKILL.md`, `~/.grok/skills/deliberation-protocol/SKILL.md`, `~/.agents/skills/deliberation-protocol/SKILL.md`, or legacy `~/.claude/commands/deliberation-protocol.md`. After DesignSpec draft, run **adversarial review loops** before `spec_verdict`:

| Persona | Contests |
|---------|----------|
| Arjun | Information hierarchy vs layout regions; visual/token choices |
| Priya | Component import paths, effort, state machine traps |
| Zara | Delight scope vs feasibility budget |

Each persona: Review mode first — grounded objections citing `task_map`, real `import_path` values, DS tokens. Default `accepts_prior: false`. Raj on stalemate.

CLI: personas debate during `npx analyzthis_design run --task "..." --full` with deliberation enabled.

### 4a — DS gate

Check `ds_checklist` from Phase 1. Spec must use token names, not invented hex. Fail → `"status": "revise"`, list fixes in `spec_verdict.notes`.

### 4b — Hierarchy gate

Rank #1 in `information_hierarchy` must match the component with `hierarchy_rank: 1` and the dominant layout region.

### 4c — Arjun visual pass on the spec

Read `skills/arjun/SKILL.md` — scoped **spec review only**:

- Typography scale consistent?
- Spacing rhythm (`tokens.spacing`) sufficient?
- Color classes WCAG-safe per knowledge bank?

Update `spec_verdict`. All three pass → set `"status": "ship"`.

**If any gate fails:** stop. Do not implement. Return Top 3 spec fixes.

---

## Phase 5 — Implementation (build_approved + ship only)

Skip entirely if `mode: assess_only` or `status !== "ship"`.

**The DesignSpec is the contract.** The host LLM must:

1. Read `session-state.json` → `design_spec`
2. Implement **only** what the spec lists — same components, tokens, regions, states
3. Use TypeScript + Tailwind + existing project components (match user stack)
4. No new colors, no extra primary CTAs, no components not in `components[]`

Handoff prompt to self:

> Implement `{design_spec.screen_name}` exactly per session `design_spec`. Run Priya sanity check after first draft.

Optional: run `skills/priya/SKILL.md` for effort confirmation before coding.

---

## Phase 6 — Post-build verify

1. Run ux-story-gate Phase 4.5 (browser) if URL available
2. Re-run **hierarchy gate** on the built UI (screenshot or DOM): is rank #1 still dominant?
3. Arjun delta: visual audit on implemented screen vs spec — REVISE only flagged sections

Record in `verify_results` and session `design_spec.spec_verdict`.

---

## Output summary block

```
## Design Director — Run Summary
Mode:              [assess_only | build_approved]
Wireframe:         [synthesized concept — one line]
Spec status:       [draft | spec_review | ship | revise]
DS gate:           [pass | fail]
Hierarchy gate:    [pass | fail]
Arjun spec pass:   [pass | fail]
Implementation:    [done | skipped — reason]
Verify:            [pass | fail | not_run]
Next step:         [implement | fix spec | fix UI per delta list]
```

---

## Relationship to other skills

| Skill | Role |
|---|---|
| `/ux-ideator` | Wireframes + deliberation (Phases 1–2 of this skill) |
| `/design-spec` | Spec format + validation rules |
| `/persona-orchestrator` | Critique existing UI — use **after** build for SHIP/REVISE |
| `/design-critic` | Multi-persona review — not the producer path |

---

## CLI helpers

```bash
npx analyzthis_design spec template
npx analyzthis_design spec show
npx analyzthis_design spec validate --file design-spec.json
```
