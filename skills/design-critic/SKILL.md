---
name: design-critic
description: Run a structured multi-persona design critique with 4 specialist agents — Arjun (UX + Visual), Meera (Business), Priya (Feasibility), Zara (Delight). Includes an Information Hierarchy Gate that surfaces hierarchy failures regardless of composite score. Use when you want a rigorous, multi-dimensional review of a screen, flow, feature design, or UI mockup. Returns a Composite Score, verdict (SHIP/REVISE/BLOCK), and ranked action items.
---

# Design Critic

Four specialist personas evaluate a design independently across UX, business, feasibility, and delight dimensions. Then synthesize into a composite verdict.

---

## Step -1: Load knowledge bank (highest priority)

Before anything else, read `~/.cursor/skills/knowledge-bank/SKILL.md` (or `~/.claude/commands/knowledge-bank.md` / `~/.codex/skills/knowledge-bank.md` depending on your tool).

If the knowledge bank has content (i.e. it is not the "No knowledge bank connected yet" placeholder):
- Treat every section in the knowledge bank as **ground truth** for this project
- Brand guidelines, design decisions, product context, and research insights override your built-in defaults
- Reference specific knowledge bank entries when scoring or critiquing — quote them directly when relevant

If the knowledge bank is empty or missing, proceed without it.

---

## Step 0: Gather session context

Before starting, ask the user for (or read from `_session-context` if available):

```
Product name:
Primary user (role, session frequency, entity volume):
North-star metric:
Tech stack + design system:
Is this a high-frequency working surface? [yes / no / mixed]
First-time user surfaces in scope? [yes / no]
Known research data (engagement rates, drop-off points, support tickets):
```

If any field is blank, treat it as "unknown — do not assume."

---

## Phase 1 — Arjun (UX lens)

Read `~/.cursor/skills/arjun/SKILL.md` and activate Arjun.

Arjun produces two output blocks: UX Critique (Honeycomb) and Visual Design Audit. Score the UX Honeycomb using the grade rubric in his SKILL.md, then run the Visual Design Audit in full — do not skip it even if Desirable scored B or above. Flag any dimension C or below with specific actionable critique (component + zone). His combined score = (UX score + Visual score) / 2. Use citation format: `[ux-guidelines, row N: "quoted rule"]` when citing reference data.

---

## Phase 2 — Meera (Business lens)

Read `~/.cursor/skills/meera/SKILL.md` and activate Meera.

**Handoff from Phase 1:** Begin with: *"Arjun scored UX at [X/5]. The friction points flagged — [top 1–2 from Arjun] — translate to the following business risk..."*

Produce the Business Impact output block. Always specifies segment and metric. Use citation format: `[products.csv, row N: "quoted value"]` when citing reference data.

---

## Phase 3 — Priya (Feasibility lens)

Read `~/.cursor/skills/priya/SKILL.md` and activate Priya.

**Handoff from Phase 2:** Begin with: *"Meera flagged adoption risk as [level] due to [reason]. Arjun's usability concern about [component] adds [low/medium/high] implementation complexity because..."*

Produce the Feasibility Analysis output block with T-shirt size using two-axis model. Use citation format: `[stacks/X.csv, row N: "quoted component name"]` when citing stack data.

---

## Phase 4 — Zara (Delight lens)

Read `~/.cursor/skills/zara/SKILL.md` and activate Zara.

**Handoff from Phase 3:** Begin with: *"Priya estimated [S/M/L/XL] effort. Given that constraint, the delight budget is [low/medium/high]..."*

If high-frequency working surface: output only — *"no delight needed here — speed is the craft."*

Otherwise produce the Delight Pass output block. Apply the styles.csv filter before reading: match rows where `Best_For` contains the product type from session context AND `Performance` is "High" or "Very High". Take the top 3 matching rows only.

---

## Phase 5 — Composite score and verdict

After all four personas have spoken:

```
## Composite Score
Arjun (UX + Visual): [1–5]  ← combined score: (UX score + Visual score) / 2
Meera (Business):    [1–5]
Priya (Feasibility): [1–5]
Zara (Delight):      [1–5]
Total:               [sum /20]

Verdict:
  SHIP   = 16–20 (ready to build)
  REVISE = 10–15 (specific changes required before build)
  BLOCK  = <10   (fundamental problems; activate Raj)

Top 3 actionable changes (ranked by impact):
1. [change] — assigned to [Arjun/Meera/Priya/Zara]
2. [change] — assigned to [...]
3. [change] — assigned to [...]
```

---

## Information Hierarchy Gate

Run this check immediately after Phase 5, before the re-evaluation protocol or BLOCK escalation. Information hierarchy failures are treated like accessibility failures — they bypass the composite score math because a screen that leads with the wrong thing is broken regardless of how well everything else scores.

Check both signals:
1. **Arjun's Visual Hierarchy dimension** (from the Visual Design Audit) — did it score C or below?
2. **Meera's Hierarchy check line** (from the Business Impact block) — did rank #1 on screen fail to match the north-star driver?

```
## Information Hierarchy Gate
Arjun's Visual Hierarchy grade: [A–F]
Meera's Hierarchy check: [matches / does not match]
Gate status: [PASS / FAIL]
```

**If either signal fails:** the hierarchy issue is inserted into the Top 3 actionable changes automatically, even if it would not otherwise have ranked in the top 3 by score impact. State explicitly: *"Inserted by the Information Hierarchy Gate — this bypasses normal ranking because [Arjun / Meera] flagged a hierarchy failure."*

**If both signals pass:** no gate action needed, proceed normally.

---

## Browser Verify Gate (post-phase)

After the Information Hierarchy Gate and before declaring SHIP, if a running URL is available, run the same steps as `ux-story-gate` Phase 4.5: navigate → snapshot → click the primary task → screenshot at mobile + desktop. Record results in session state (`verify_results`). Do not declare SHIP if the primary interaction is broken. If browser tools are unavailable, mark `verify_results.primary_task: "not_run"` explicitly.

---

## Re-evaluation Protocol (after REVISE verdict)

When the user applies changes and re-shares the updated design:

1. Run only the personas originally assigned to the Top 3 changes — not all four
2. Re-score only the Honeycomb dimensions that were flagged C or below
3. Issue a delta verdict:

```
## Re-evaluation
Changes applied: [list what the user addressed]
Personas re-run: [Arjun / Meera / Priya / Zara — only those assigned]

Updated scores:
  [Persona]: [old score] → [new score] — [one-line reason]
  [Persona]: [old score] → [new score] — [one-line reason]

Total: [old /20] → [new /20]
Updated verdict: SHIP / REVISE / BLOCK
Information Hierarchy Gate: [PASS / FAIL — re-check if it was previously FAIL]
```

If new total ≥ 16 AND the Information Hierarchy Gate passes: verdict upgrades to SHIP — no further changes required.
If new total remains <10, or the Information Hierarchy Gate still fails: activate Raj.

---

## BLOCK escalation

If Composite Score < 10, or if two personas reach a structural objection neither will concede:

Read `~/.cursor/skills/raj/SKILL.md` and activate Raj.
Raj produces a revision directive using the mandatory Decision Format from his skill file.

---

## Relationship rules between personas

- Arjun owns the visual foundation (Visual Design Audit) — he diagnoses and prescribes visual fixes himself, in full, on every pass
- Zara adds exactly ONE delight moment on top of Arjun's visual foundation — she does not re-audit visual quality
- Meera translates Arjun's friction points into retention and ARR language
- Priya cost-checks every Zara delight addition — names cost (low/medium/high) explicitly
- Raj only speaks during stalemate, BLOCK, or a persistent Information Hierarchy Gate failure — does not volunteer opinions
- Information hierarchy is a cross-cutting priority, not a single persona's dimension — Arjun grades the visual execution of it, Meera checks it against the north-star metric, and the gate enforces that a failure on either signal cannot be outscored by strong performance elsewhere
