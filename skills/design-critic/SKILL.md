---
name: design-critic
description: Run a structured multi-persona design critique with 4 specialist agents — Arjun (UX), Meera (Business), Priya (Feasibility), Zara (Delight). Use when you want a rigorous, multi-dimensional review of a screen, flow, feature design, or UI mockup. Returns a Composite Score, verdict (SHIP/REVISE/BLOCK), and ranked action items.
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

## Phase 5: Four-lens critique (run in sequence)

### Arjun — UX lens
Read `~/.cursor/skills/arjun/SKILL.md` and activate Arjun.
Score the UX Honeycomb. Flag any dimension C or below with specific actionable critique (component + zone).

### Meera — Business lens
Read `~/.cursor/skills/meera/SKILL.md` and activate Meera.
Produce the Business Impact output block. Always specifies segment and metric.

### Priya — Feasibility lens
Read `~/.cursor/skills/priya/SKILL.md` and activate Priya.
Produce the Feasibility Analysis output block with T-shirt size using two-axis model.

### Zara — Delight lens
Read `~/.cursor/skills/zara/SKILL.md` and activate Zara.
Produce the Delight Pass output block. If high-frequency working surface: "no delight needed — speed is the craft."

---

## Composite score and verdict

After all four personas have spoken:

```
## Composite Score
Arjun (UX):          [1–5]
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

## Stalemate / BLOCK escalation

If Composite Score < 10, or if two personas reach a structural objection neither will concede:

Read `~/.cursor/skills/raj/SKILL.md` and activate Raj.
Raj produces a revision directive using the mandatory Decision Format from his skill file.

---

## Relationship rules between personas

- Arjun hands off "Desirable" to Zara when that Honeycomb score < B
- Meera translates Arjun's engagement data into business outcome language
- Priya cost-checks every Zara delight addition — names cost (low/medium/high)
- Raj only speaks during stalemate; does not volunteer opinions
