---
name: ux-ideator
description: Wireframe a new feature, screen, or flow from scratch — full text wireframes, two competing IA concepts (minimalist vs dense), deliberation, delight pass, and feasibility check. Use for mockups, screen layout, IA concepts, and design-from-scratch asks.
---

# UX Ideator

Seven personas collaborate across 6 phases to produce a single, deliberated, implementation-ready IA design. Each phase has a clear owner and output format.

---

## Step -1: Load knowledge bank (highest priority)

Before anything else, read the knowledge-bank skill from your host (sibling preferred): `~/.cursor/skills/knowledge-bank/SKILL.md`, `~/.claude/skills/knowledge-bank/SKILL.md`, `~/.grok/skills/knowledge-bank/SKILL.md`, `~/.agents/skills/knowledge-bank/SKILL.md`, or legacy `~/.claude/commands/knowledge-bank.md`.

If the knowledge bank has content (i.e. it is not the "No knowledge bank connected yet" placeholder):
- Treat every section as **ground truth** — brand guidelines, product decisions, research insights, and technical constraints override built-in persona defaults
- All 7 personas must reference applicable knowledge bank entries during their respective phases
- Design decisions already made in the knowledge bank are non-negotiable constraints — do not re-debate them

If the knowledge bank is empty or missing, proceed without it.

---

## Step 0: Load session context

Read session context from the user or from `_session-context`:

```
Product name:
Primary user (role, session frequency, entity volume):
North-star metric:
Tech stack + design system:
Is this a high-frequency working surface? [yes / no / mixed]
First-time user surfaces in scope? [yes / no]
Known research data:
Out of scope:
```

All 7 personas read this before their phase begins. Fields left blank = "unknown — do not assume."

---

## Phase 1 — Business reframe (Meera)

Read `~/.cursor/skills/meera/SKILL.md` and activate Meera.

Meera maps the feature request to business outcome before any design happens:
- Which north-star metric does this move?
- Which customer segment benefits?
- Is this competitive parity, differentiation, or net-new revenue?
- What is the adoption risk?

Output: One-paragraph business framing that the other personas use as a constraint.

---

## Phase 2 — IA audit (Noor + Anuj)

Read `~/.cursor/skills/noor/SKILL.md` and activate Noor.
Read `~/.cursor/skills/anuj/SKILL.md` and activate Anuj.
Read `~/.cursor/skills/arjun/SKILL.md` and activate Arjun for research grounding.

**Noor** maps the existing IA (or proposes a clean-slate structure) using progressive disclosure principles.
**Anuj** audits for power-user gaps: missing bulk actions, hidden high-frequency config, keyboard shortcut gaps.
**Arjun** flags any friction points backed by user research data from session context.

Output: A list of IA gaps and opportunities, attributed to each persona.

---

## Phase 3 — Two competing concepts (Noor vs Anuj)

**Mandatory: use the DEEP / full wireframe format from each persona's SKILL.md — never the lite card schema (grades-only summary).**

Individual `/noor` and `/anuj` invocations must also use the full Concept A / Concept B text wireframe blocks, not the lite schema.

### Concept A — Noor
Read `~/.cursor/skills/noor/SKILL.md` (or sibling install path). Noor produces a **full** minimalist, progressive-disclosure text wireframe using the complete "Output — Concept A" block.

### Concept B — Anuj
Read `~/.cursor/skills/anuj/SKILL.md` (or sibling install path). Anuj produces a **full** dense, expert-optimized text wireframe using the complete "Output — Concept B" block.

Both concepts must:
- Use the full wireframe template (hierarchy, primary action, nav level, visible-on-load, progressive disclosure, nav path, rationale)
- Name components from the design system (not abstract descriptions)
- Respect the navigation level constraint (≤3 levels, Noor's rule)
- Address the business framing from Phase 1

---

## Phase 4 — Deliberation (Noor vs Anuj, Raj on standby) — ENFORCED (v1.19)

Read `skills/deliberation-protocol/SKILL.md`. This is **multi-round adversarial review**, not a single paragraph summary.

**Round 0:** Noor and Anuj produce wireframes (parallel).

**Rounds 1..N:** Each critiques the other's concept on 5 dimensions:
1. Task completion speed for primary persona
2. Learnability for first-time users
3. Information density match for expert users
4. Navigation depth
5. Design system feasibility (component availability)

Each round: grounded objections + deliberation JSON. Default `accepts_prior: false`. Ask contextual questions tied to `task_map` and Meera's business framing.

**CLI enforcement:** `npx analyzthis_design run --task "wireframe ..."` runs Noor∥Anuj objection loops automatically.

**Stalemate Protocol:** If 2+ structural objections are unresolved after configured rounds, or the same argument repeats without new evidence, activate Raj.

Output: One synthesized concept with explicit record of what each persona won and gave up — **only after** deliberation closes.

---

## Phase 5 — Arjun UX validation

Read `~/.cursor/skills/arjun/SKILL.md` and activate Arjun.

Arjun scores the synthesized concept on the UX Honeycomb. Any dimension scoring C or below triggers a revision to the concept before proceeding.

---

## Phase 5.5 — Zara delight pass

Read `~/.cursor/skills/zara/SKILL.md` and activate Zara.

Zara identifies exactly one delight moment in the synthesized concept.

If high-frequency working surface: "no delight needed here — speed is the craft."
Otherwise: produce the full Delight Pass output block.

---

## Phase 6 — Priya feasibility sanity check

Read `~/.cursor/skills/priya/SKILL.md` and activate Priya.

Priya evaluates the final synthesized concept:
- T-shirt size effort estimate (two-axis model)
- Hard blockers if any
- Top 2 implementation risks
- Simpler alternative if effort is L or XL

If effort is XL: flag to user and ask whether to proceed or adopt the simpler alternative before output.

---

## Final output

```
## UX Ideator — Final Concept
[Synthesized concept text wireframe]

Business framing (Meera): [one sentence]
UX score (Arjun): [/35 or /5]
Delight moment (Zara): [one moment or "speed is the craft"]
Effort estimate (Priya): [S/M/L/XL + rationale]

Key deliberation decisions:
- [what Noor won]
- [what Anuj won]
- [Raj arbitration if used]

Ready to implement: [yes / revise first — list changes]
```

---

## Phase 7 — DesignSpec (mandatory before build)

Read `skills/design-spec/SKILL.md`.

Convert the synthesized concept into a **machine-readable DesignSpec** — layout regions, token classes, real component mapping (`import_path` from repo), all four states, do/don't.

- Set `"status": "spec_review"` on first pass
- Run spec gates (DS, hierarchy, Arjun visual on spec) per design-spec skill
- Only set `"status": "ship"` when all gates pass

Emit the spec as:

```design-spec
{ ... full JSON per agents/design-spec-schema.json ... }
```

For full **design → build** orchestration (spec gates + implementation), use `/design-director` instead of stopping here.

**Individual `/noor` and `/anuj` runs:** after a single wireframe, produce a minimal DesignSpec if the user asked to implement — otherwise wireframe only.
