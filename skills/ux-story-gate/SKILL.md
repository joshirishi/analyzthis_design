---
name: ux-story-gate
description: Task-first gate and router for screen evaluation. Discovers PRDs and user stories from your knowledge bank and repo, runs a design-system/Figma discovery pass and an MoE routing decision, then routes to Noor (IA), Anuj (power-user), and Arjun (UX). Ends with a browser verify gate and an assess-only mode check. No task map = no critique. The right entry point for any screen review.
---

# UX Story Gate

A gate and a router. Has no design opinion of its own. Ensures no screen is evaluated without first knowing who the user is, what task they're completing, how often, and what success and failure look like.

The personas (Noor, Anuj, Arjun) are the rooms. This is the front door.

---

## Phase 0 — PRD Discovery (runs before anything else)

Before asking the user for anything, scan for existing context in this order:

### 0a — Check the knowledge bank

Read `~/.cursor/skills/knowledge-bank/SKILL.md` (or `~/.claude/commands/knowledge-bank.md` / `~/.codex/skills/knowledge-bank.md`).

Look for sections containing:
- User stories (`As a [persona], I want to...`, `Given / When / Then`)
- Acceptance criteria, PRD sections, requirements
- Named user personas with roles and tasks
- Epics, features, job-to-be-done statements
- Any section titled or tagged: PRD, requirements, user-stories, specs, product-context

If the knowledge bank contains relevant content for the screen being reviewed: **extract it into a draft task map** (see format in Phase 1). Mark each entry with `[source: knowledge-bank]`.

### 0b — Scan the current repo

Look for files matching these patterns in the project root and common sub-directories:
- `PRD*.md`, `*prd*.md`, `*requirements*.md`, `*user-stories*.md`, `*specs*.md`
- `docs/**/*.md`, `specs/**/*.md`, `requirements/**/*.md`, `planning/**/*.md`
- Any `.md` file containing keywords: "user story", "acceptance criteria", "as a [role]", "given when then", "persona", "job to be done", "JTBD", "done when", "fails when"

Read all matching files. Extract task-relevant content. Mark each entry with `[source: filename]`.

### 0c — Build a draft task map from discovered content

From everything found in 0a and 0b, construct a draft task map using the format:

```
PERSONA:    [named role from the PRD / story]
TASK:       [verb + object — extracted or inferred from acceptance criteria]
FREQUENCY:  [daily / weekly / one-time / first-time-only — from PRD or inferred]
DONE WHEN:  [success condition from acceptance criteria, or inferred]
FAILS WHEN: [failure condition from acceptance criteria, or inferred]
SOURCE:     [knowledge-bank / filename]
```

Present the draft task map to the user:

> "I found the following tasks relevant to this screen in [sources]. Does this capture what the screen needs to support? Add, remove, or correct anything before I proceed — I'll run the critique against your confirmed version, not my guess."

If the user confirms: proceed to Phase 1 with the confirmed task map.
If the user corrects: apply corrections, confirm again, then proceed.

### 0d — If no PRD context found anywhere

If no relevant content is found in the knowledge bank or the repo, switch to the manual intake mode from Phase 1 below.

If the user has a vault but hasn't synced it:

> "I don't see a knowledge bank connected. If you have PRDs or user stories in an Obsidian vault or docs folder, run `npx analyzthis_design connect --vault /path/to/vault && npx analyzthis_design sync` to make them available. I'll read them automatically next time.
> For now — tell me the tasks this screen needs to support:"

---

## Phase 0.5 — Design System & Figma Discovery (GATE)

**Purpose:** No persona touches brand color, contrast, or component styling before the design system is on the table. This is the fix for personas inventing hex values or patching contrast with `!important`.

### 0.5a — Figma discovery (if a Figma URL is present in the ask)

If the user shared a `figma.com` URL, this is **mandatory before any persona speaks**:
1. Call the Figma MCP `get_screenshot` for the linked node — this is the visual ground truth.
2. Call the Figma MCP `get_variable_defs` for the linked node — this is the token ground truth (colors, type scale, spacing).
3. Write both to session state (`figma_node.url`, `figma_node.confirmed: true`) via `npx analyzthis_design session init` / the session file directly.

If no Figma URL is present, proceed without this step and note `figma_node.confirmed: false`.

### 0.5b — Brand / design-system tokens

Read the `## Brand & Design Guidelines` section of the knowledge bank (`~/.cursor/skills/knowledge-bank/SKILL.md` or platform equivalent).

- **If found:** extract the token set (colors, type scale, spacing scale, component library) into the DS Token Checklist below.
- **If missing:** flag it and ask the user directly:

> "I don't see brand or design-system tokens in the knowledge bank. Before I let any persona touch color, spacing, or component choices, I need your token source — a Figma variables link, a design-tokens file, or a short list of approved hex/spacing values. Without this, Arjun's Color System and Style Fit grades will be marked unverified."

### 0.5c — DS Token Checklist (exit criteria for this phase)

Output before proceeding, and re-check it after any visual fix is proposed:

```
## DS Token Checklist
No invented hex / no !important overrides:     [ ] confirmed / [ ] at risk
Kit components preferred over custom CSS:      [ ] confirmed / [ ] at risk
Light/dark surfaces sourced from tokens only:  [ ] confirmed / [ ] at risk
Contrast checked against WCAG:                 [cite ux-guidelines row, or "not yet checked"]
```

Persist this to `session-state.json` (`ds_checklist`). Any item left "at risk" travels with the task map into Phase 4 routing — it forces the **DS Gate** route from Phase 1.5, not a direct Zara or Noor-alone pass.

---

## Phase 1 — Task Map Intake (GATE)

**Used when Phase 0 finds no context, or to supplement what was found.**

A valid task map must contain, for each task:

```
PERSONA:    [named persona — Retailer Admin / Media Sales / Ad Ops Manager / etc.]
TASK:       [verb + object — "Import a Google audience by ID"]
FREQUENCY:  [daily / weekly / one-time / first-time-only]
DONE WHEN:  [the user knows the task succeeded because...]
FAILS WHEN: [the user knows something went wrong because...]
```

**If a valid task map is present (from Phase 0 or user input):** proceed to Phase 2.

**If no task map is present:** do NOT proceed. Ask:

> "Before I run any critique, I need the task map for this screen. For each user task this screen should support, tell me:
> - Which persona? (e.g. Retailer Admin, Media Sales)
> - What task? (verb + object)
> - How often? (daily / weekly / one-time)
> - Done when? (one sentence)
> - Fails when? (one sentence)
>
> Once I have these, I'll route to the right personas grounded in your tasks — not abstract principles."

Never assume a task map. Never infer tasks from the screen description alone. If PRD context was found but incomplete, ask only for the missing fields — not the whole form.

---

## Phase 1.5 — Problem-Type Router (MoE)

**Purpose:** Pick the right expert(s) for the problem, not the loudest persona for the screen type. This is a Mixture-of-Experts router: it classifies the ask into a problem type, then reads `agents/router.json` to select which personas run and which are explicitly excluded.

1. Classify the confirmed task map + DS Token Checklist into one or more problem types using the table below (mirrors `agents/router.json`):

| Problem signal | Route to | Never route to |
|---|---|---|
| Structure / IA / nested UI | **Noor** | Zara |
| UX friction / accessibility / responsive | **Arjun** | Zara for contrast fixes |
| Brand / tokens / contrast / DS compliance | **DS Gate** then Arjun Color System only | Zara, Noor alone |
| Business priority / metric alignment | **Meera** | — |
| Build size / modal vs wizard | **Priya** | — |
| Delight / onboarding peak moment | **Zara** (only after DS Gate passes) | — |
| Daily-use density / bulk actions | **Anuj** (only if Frequency = daily/weekly) | — |
| Stalemate / BLOCK | **Raj** | — |

2. Write the routing decision to `session-state.json` (`routing_decision: { problem_type, experts, reason }`) — e.g. via the session file, so later phases and persona hand-offs don't re-derive it.
3. Announce the decision in one line per persona:

> "Routing to **Arjun** — Task 2 has an unresolved contrast risk (DS Gate item 'at risk'). **Zara excluded** — delight is out of scope until the DS Gate clears."

If any DS Token Checklist item is "at risk," the DS Gate route takes precedence over any other route for that task — no persona touches color/contrast/tokens until it clears. This also means: **do not run Meera, Priya, or Zara yet** — stop at DS Gate remediation + Arjun's Color System dimension only, and resume the rest of the chain once the checklist clears (or the user explicitly says to proceed anyway).

**Expert budget:** default to the smallest expert set that covers the routed problem type(s) — usually 1–2 personas. Only expand to the full Noor+Anuj+Arjun+Meera+Zara routing table in Phase 4 below when the ask is a genuine full-screen review, not a narrow question.

---

## Phase 2 — Field Veto Pass

**Purpose:** Catch fields and elements that exist without a task owner before personas evaluate them.

Scan the screen description for every distinct field, button, label, and section. For each, run the veto test:

> *"Which persona, in which task from the confirmed task map, would fail if this element didn't exist?"*

Output: a Field Veto Table.

```
| Element          | Task it serves     | Verdict         |
|------------------|--------------------|-----------------|
| Cohort Name      | Task 1, Task 2     | ✅ Keep         |
| Tags (max 3)     | None               | ❌ Cut / Justify|
| Audience ID      | Task 2             | ✅ Keep         |
| Description      | [task unclear]     | ⚠️ Clarify      |
```

Three verdicts only:
- **✅ Keep** — maps to at least one task
- **❌ Cut** — no task owner; recommend removal before personas run
- **⚠️ Clarify** — ambiguous; ask the user to confirm which task this serves before proceeding

Do not remove fields. Flag and ask. User confirms. Then proceed.

---

## Phase 3 — Scale & States Declaration

**Purpose:** Force the two questions most commonly skipped in story-writing.

**Scale question (required for any screen with a list or table):**

> "At how many rows does this screen need to work? (e.g. 10 / 100 / 1000+)"
> "Does the list need sorting? If yes, which columns and what's the default order?"
> "Does the list need filtering? If yes, which filters, and should selected state persist across sessions?"

If scale is not declared, flag: *"Scale not specified. Personas will note this as unverified and may give incomplete Usable scores."*

**States checklist (required for every screen):**

Check the input for all four states. Flag any that are missing before personas run.

```
EMPTY STATE:   [what the user sees at zero data — does it teach the next action?]
ERROR STATE:   [what the user sees when input is wrong — is recovery actionable?]
LOADING STATE: [skeleton / spinner / nothing — is perceived latency acceptable?]
EDGE STATE:    [what the user sees at max scale / stale data / partial data]
```

If a state is missing: *"[State] not defined. Arjun will flag this as untested — defining it now will produce a more accurate Credible score."*

Can proceed with undefined states, but mark them explicitly as gaps that will surface in persona output.

---

## Phase 4 — Persona Routing

**Purpose:** Select the right personas for the task map, not for the screen type. This refines the Phase 1.5 MoE decision down to per-task assignments.

Read the confirmed task map and route based on task characteristics:

| Task characteristic | Route to |
|---|---|
| Any creation / form / IA structure task | Noor |
| Any daily-use / list / scan / sort / filter task (Frequency = daily or weekly) | Anuj |
| Any task with a named error / empty / loading state risk | Arjun |
| Any task involving pricing, access control, or business rules | Flag for Meera |
| Any task involving a first-time / onboarding experience | Flag for Zara |

Always route to at least **Noor + Arjun**. Add **Anuj** whenever any task has Frequency = daily or weekly.

Announce routing decisions — one line each:

> "Routing to **Noor** — Tasks 1 and 2 are creation flows with IA structure decisions.
> Routing to **Anuj** — Tasks 4 and 5 are daily-use list tasks at 100+ rows.
> Routing to **Arjun** — Task 2 has an unrecovered error state risk; Task 1 has an undefined empty state."

Each persona receives:
1. The confirmed task map (not the raw screen description)
2. The Field Veto Table with verdicts
3. The Scale declaration
4. The States checklist with gaps flagged
5. The instruction: *"Evaluate only against the tasks in this map. Do not evaluate against abstract principles unless they directly explain a task failure."*

---

## Phase 4.5 — Verify Gate (Browser Automation)

**Purpose:** No screen is declared done on the strength of a critique alone. This is the fix for bugs that personas miss and users catch — the critique must be checked against a running browser, not just read off a screenshot.

Run this after the persona chain completes, before Phase 5 synthesis:

1. **Navigate** to the screen under review (`browser_navigate`).
2. **Snapshot** the page (`browser_snapshot`) to confirm structure matches what personas critiqued.
3. **Click through the primary task** from the confirmed task map — the highest-priority task, end to end (`browser_click`, `browser_type`, etc.).
4. **Screenshot** at both mobile and desktop viewports.
5. Record the result in `session-state.json` (`verify_results: { primary_task: "pass" | "fail", screenshots: [...] }`).

**FAIL conditions — do not declare the screen done if any of these are true:**
- The primary interaction is broken (e.g. state cycling incorrectly, stuck loading, dead click)
- Modal/dialog roles are missing or focus is not trapped
- Contrast visibly fails at either viewport despite the DS Gate marking it "confirmed"

If verification fails, loop back: flag the specific broken step, do not proceed to Phase 5 synthesis until it's fixed or explicitly deferred by the user.

If browser tools are unavailable in the current environment, state this explicitly and mark `verify_results.primary_task: "not_run"` — do not silently skip the gate.

**Skip condition (still explicit, not silent):** if `mode: assess_only` (see Phase 5.5) and no running URL is available to navigate to, do not attempt this phase — record `verify_results.primary_task: "not_run"` with the reason "assess_only, no URL" and move to Phase 5. This avoids burning a browser-automation pass on a proposal nobody asked to be built yet.

---

## Phase 5 — Synthesis Output

After all routed personas complete their critiques, synthesise into a Task × Finding table:

```
| Task | Status | Noor | Anuj | Arjun | Priority |
|------|--------|------|------|-------|----------|
| Task 1: Create My Cohort | ❌ | Paths not built | No bulk import | Empty state undefined | P0 |
| Task 2: Import by ID     | ⚠️ | —  | — | No format hint, silent fail | P0 |
| Task 3: Set pricing      | ✅ | Remove asterisks | — | — | P1 |
| Task 4: Daily list scan  | ❌ | — | 6 columns missing, no sort | Credible D at 100+ rows | P0 |
| Task 5: Filter / persist | ❌ | — | No persisted state | — | P0 |
```

Priority is set by the gate, not by any persona:
- **P0** — task cannot be completed at all, or fails on first attempt
- **P1** — task can be completed but with significant friction
- **P2** — task completes but with minor friction or missing polish

End with a build-ready verdict:

> *"[N] tasks are P0 — these must be resolved before the screen ships. [N] tasks are P1 — these should ship in the same sprint. [N] tasks are P2 — these can follow."*

---

## Phase 5.5 — Assess-Only Mode

**Purpose:** Fix the "Ask/Agent double spend" failure — a user who asked for an assessment should not wake up to code changes they didn't approve.

Check the original ask for intent before writing or editing any code:

- If the user's language was **assess / propose / critique / review / what's wrong / evaluate**: this is `assess_only` mode. Output stops at the Phase 5 synthesis and the proposed fixes. Set `session-state.json` (`mode: "assess_only"`). Do not touch code.
- If the user's language was **build / implement / apply / fix it / ship it**: this is `build_approved` mode. Proceed to implement the P0/P1 fixes from the synthesis table. Set `mode: "build_approved"`.
- If intent is ambiguous, default to `assess_only` and ask: *"I've completed the assessment above — want me to implement the P0 fixes now, or would you like to review the proposal first?"*

This gate applies to every persona downstream, not just the gate itself — restate `mode` when handing off to `design-critic` or any individual persona.

---

## Trigger phrases

Use this skill when you see:
- "Review this screen" / "What's wrong with this?" / "Critique this"
- "Are we building this right?"
- "Does this match the user task?"
- "Run the personas on this"
- "Evaluate this before we build"
- Any Figma link, screenshot, or screen description shared without a task map

---

## What this skill is not

- **Not a persona.** No design opinion of its own.
- **Not a PRD generator.** Does not write stories. Validates that stories were written correctly before design evaluation begins.
- **Not a replacement for the personas.** Noor, Anuj, and Arjun still run in full. This ensures they run on the right input.
- **Not optional.** If someone invokes `/noor`, `/anuj`, or `/arjun` directly without a task map, they bypass the gate. Use this as the entry point for any screen evaluation. For a fully agentic run (routing + chain + gates + session state in one call), prefer `/persona-orchestrator`.

---

## Persona skills this depends on

- `~/.cursor/skills/noor/SKILL.md`
- `~/.cursor/skills/anuj/SKILL.md`
- `~/.cursor/skills/arjun/SKILL.md`
- `~/.cursor/skills/knowledge-bank/SKILL.md` (for Phase 0 PRD discovery)

## Agentic layer this depends on

- `agents/router.json` — MoE routing table used in Phase 1.5
- `agents/session-schema.json` — shape of the session state written throughout this gate
- `npx analyzthis_design session init|show|reset` — CLI for reading/writing session state between turns
- For a fully orchestrated run instead of using this gate directly, use `skills/persona-orchestrator/SKILL.md`
