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

The dashboard shows per-persona trust scores (0-100). A persona **starts at 50**
and moves in both directions, so a rejection genuinely costs it.

| Score | Level | Meaning |
|-------|-------|---------|
| 80-100 | Trusted | Consistently shipped; weight heavily |
| 60-79 | Reliable | More hits than misses |
| 40-59 | Baseline | Neutral, or not enough evidence yet |
| 20-39 | Developing | More rework than wins |
| 0-19 | At risk | Repeatedly wrong or missed |

Signed contributions:

| Signal | Points |
|---|---|
| outcome `shipped` | **+15** |
| outcome `blocked_correctly` | **+10** |
| outcome `revised` | **-5** |
| outcome `missed` | **-15** |
| each rating | `(rating - 3) x 4` → 5* = +8, 1* = -8 |
| each positive lesson | +10 |
| patch proposed / applied | +20 / +25 |

**Evidence gating:** below 5 signals a persona is reported as
`Baseline (insufficient evidence)` regardless of score — one bad note must not
brand a persona. Scores are derived on read, so changing weights re-scores history
with no migration.

Scope is **global per persona** by default. Pass `--project` to scope down.

## CLI reference

```bash
# Check readiness + dashboard
npx analyzthis_design evolve --ready

# Just the dashboard (or the shorter alias)
npx analyzthis_design evolve --metrics
npx analyzthis_design scores
npx analyzthis_design scores --persona arjun

# Extract patches (dry-run by default)
npx analyzthis_design evolve --extract --dry-run

# Apply a patch
npx analyzthis_design evolve --apply <patchId> --dry-run
npx analyzthis_design evolve --apply <patchId>
```