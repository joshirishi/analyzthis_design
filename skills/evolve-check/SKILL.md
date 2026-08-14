---
name: evolve-check
description: Devi skill — after a successful critique run, check if personas have enough data to evolve and offer to run the evolution cycle. Shows evolution metrics dashboard.
disable-model-invocation: true
---

# Evolve Check

After a successful critique run, Devi checks if the team has accumulated enough lessons and outcomes to propose evolution patches (prompt edits, CSV reference rows, router changes).

## When to invoke

Invoke this skill **after** a completed `run` or `run-unchunked` where:
- Personas produced outputs
- User accepted at least one output (`session accept --persona X`)
- Ideally, user confirmed an outcome (`outcome --confirm --persona X --result shipped`)

## What to do

### Step 1 — Check readiness

```bash
npx analyzthis_design evolve --ready --project <projectId>
```

This prints:
- Whether evolution is ready (enough lessons/outcomes)
- The team evolution dashboard with per-persona scores

### Step 2 — If ready, extract patches

```bash
npx analyzthis_design evolve --extract --dry-run
```

This proposes:
- **Prompt patches** — new canonical failure patterns added to persona SKILL.md
- **Reference rows** — new CSV rows learned from accepted outputs
- **Router patches** — routing changes based on outcome data

### Step 3 — Ask the user

Present the proposed patches and ask:

> The team has accumulated enough data to evolve. I found:
> - **2 prompt patches** (Arjun, Meera)
> - **1 reference row** (Zara — new color palette pattern)
> - **1 router patch** (full_screen_review → Arjun)
>
> Would you like me to apply any of these? I'll show a dry-run preview first.

### Step 4 — If user says yes

For each patch the user wants to apply:

```bash
npx analyzthis_design evolve --apply <patchId> --dry-run   # preview first
npx analyzthis_design evolve --apply <patchId>              # apply for real
```

Router patches require manual review — point the user to `agents/router.json`.

### Step 5 — If not ready

Tell the user what's needed:

> Not enough data yet. The team has **2/5 lessons** and **0/10 outcomes**.
> To trigger evolution:
> 1. Run more critiques: `npx analyzthis_design run --task "..."`
> 2. Accept good outputs: `npx analyzthis_design session accept --persona arjun`
> 3. Confirm outcomes: `npx analyzthis_design outcome --confirm --persona arjun --result shipped`

## Evolution metrics

The dashboard shows per-persona evolution scores (0-100):

| Score | Level | Meaning |
|-------|-------|---------|
| 0-19 | Novice | No data yet |
| 20-39 | Developing | Some lessons extracted |
| 40-59 | Proficient | Lessons + outcomes accumulating |
| 60-79 | Advanced | Patches proposed and some applied |
| 80-100 | Expert | Significant evolution, patches applied |

Scoring:
- 10 pts per lesson (cap 100)
- 15 pts per confirmed outcome (cap 100)
- 20 pts per proposed patch (cap 100)
- 25 pts bonus per applied patch

## CLI reference

```bash
# Check readiness + dashboard
npx analyzthis_design evolve --ready

# Just the dashboard
npx analyzthis_design evolve --metrics

# Extract patches (dry-run by default)
npx analyzthis_design evolve --extract --dry-run

# Apply a patch
npx analyzthis_design evolve --apply <patchId> --dry-run
npx analyzthis_design evolve --apply <patchId>
```