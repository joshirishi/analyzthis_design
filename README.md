# Analyzthis_Design

A set of AI design personas and a task-first evaluation framework that plugs into Cursor, Claude Code, and Codex CLI as slash commands.

Install once. Run structured UX critiques, multi-phase ideation, and task-grounded screen reviews — directly inside your AI chat.

**npm:** [analyzthis_design](https://www.npmjs.com/package/analyzthis_design)

---

## Install

```bash
# Cursor (default)
npx analyzthis_design

# Claude Code
npx analyzthis_design --target claude

# Codex CLI
npx analyzthis_design --target codex

# All three at once
npx analyzthis_design --target all
```

| Tool | Skills installed to |
|---|---|
| Cursor | `~/.cursor/skills/` |
| Claude Code | `~/.claude/commands/` |
| Codex CLI | `~/.codex/skills/` |

---

## Skills Overview

### Entry points (start here)

| Command | What it does |
|---|---|
| `/ux-story-gate` | **Recommended first step.** Discovers PRDs and user stories from your knowledge bank and repo, builds a task map, routes to the right personas, and synthesises findings by task with P0/P1/P2 priorities. |
| `/design-critic` | 4-persona critique → `SHIP / REVISE / BLOCK` verdict with a Composite Score out of 20. |
| `/ux-ideator` | 6-phase ideation → two competing IA concepts, deliberation, delight pass, feasibility check. |

### 7 Individual Personas

Invoke directly for targeted, already-grounded questions. For full screen evaluation, prefer `/ux-story-gate`.

| Command | Persona | What they evaluate |
|---|---|---|
| `/arjun` | UX Agent | UX Honeycomb (7 dimensions, A–F): Useful, Usable, Findable, Credible, Accessible, Desirable, Valuable |
| `/meera` | Business Agent | Retention, ARR, GTM lever, adoption risk by customer segment |
| `/priya` | Feasibility Agent | Engineering effort (T-shirt sizing, 2-axis model), state machine traps, implementation risks |
| `/zara` | Delight Agent | Picks exactly ONE peak delight moment — or says "speed is the craft" for working surfaces |
| `/noor` | IA Architect | Minimalist, progressive-disclosure wireframe — Concept A, ≤3 nav levels |
| `/anuj` | Power-User Advocate | Dense, expert-optimized wireframe — Concept B, bulk actions, keyboard shortcuts |
| `/raj` | Arbitrator | Resolves persona stalemates using 5 ranked product principles. Never speaks first. |

### Supporting skills

| Command | Purpose |
|---|---|
| `/design-personas` | Session context template — fill in once before a session to ground all 7 personas in project-specific data |
| `/knowledge-bank` | Auto-populated from your connected vault. All personas read this first. |

---

## UX Story Gate — How it works

`/ux-story-gate` is the task-first entry point for any screen evaluation. It runs in 5 phases:

**Phase 0 — PRD Discovery (automatic)**
Before asking you anything, it scans:
1. Your connected knowledge bank for user stories, PRDs, acceptance criteria
2. The current repo for `PRD*.md`, `docs/**/*.md`, `requirements/*.md`, and any file containing "user story / acceptance criteria / done when"

It builds a draft task map from what it finds and asks you to confirm — you correct, not fill in from scratch.

**Phase 1 — Task Map Gate**
If no PRD context is found anywhere, it asks for the task map manually:
- Which persona? (e.g. Retailer Admin, Media Sales)
- What task? (verb + object)
- How often? (daily / weekly / one-time)
- Done when?
- Fails when?

**Phase 2 — Field Veto Pass**
Every field, button, and section on the screen gets a verdict:
- ✅ Keep — maps to a task
- ❌ Cut — no task owner
- ⚠️ Clarify — ambiguous

**Phase 3 — Scale & States**
Forces declaration of scale (rows/entities), and checks for Empty / Error / Loading / Edge states before personas run.

**Phase 4 — Persona Routing**
Routes to the right personas based on task characteristics — not screen type.

**Phase 5 — Synthesis**
A Task × Finding table with P0 / P1 / P2 priorities and a build-ready verdict.

---

## Knowledge Bank — Connect your vault

The knowledge bank lets you connect an Obsidian vault or any markdown folder so that personas read your actual project context — brand guidelines, design decisions, PRDs, research — before forming any opinion.

```bash
# Connect a vault (all notes)
npx analyzthis_design connect --vault ~/Documents/MyVault

# Connect with tag filter (only notes tagged #design, #brand, #prd)
npx analyzthis_design connect --vault ~/vault --tags design,brand,prd,product

# Connect with folder filter
npx analyzthis_design connect --vault ~/vault --include Design,Brand,PRDs,Research

# Sync to Cursor
npx analyzthis_design sync

# Sync to all tools
npx analyzthis_design sync --target all

# Check what's connected
npx analyzthis_design status

# Remove a source
npx analyzthis_design disconnect --vault ~/Documents/MyVault
```

Once synced, the knowledge bank is auto-read at the start of every persona session. Your project-specific context takes full precedence over built-in persona defaults.

**PRDs and user stories** in your vault are automatically detected and surfaced at the top of the knowledge bank — `ux-story-gate` reads them in Phase 0 to build the task map without you having to type it out.

Config is stored at `~/.analyzthis_design/config.json` — global across all projects.

---

## CLI Reference

```bash
# ── Install ────────────────────────────────────────────────────────────────
npx analyzthis_design                          # install for Cursor
npx analyzthis_design --target claude          # install for Claude Code
npx analyzthis_design --target codex           # install for Codex CLI
npx analyzthis_design --target all             # install for all tools
npx analyzthis_design --force                  # overwrite existing skills

# ── Remove ─────────────────────────────────────────────────────────────────
npx analyzthis_design remove                   # remove from Cursor
npx analyzthis_design remove --target all      # remove from all tools

# ── List ───────────────────────────────────────────────────────────────────
npx analyzthis_design list                     # show Cursor installs
npx analyzthis_design list --target all        # show all tool installs

# ── Knowledge bank ─────────────────────────────────────────────────────────
npx analyzthis_design connect --vault <path>
npx analyzthis_design connect --vault <path> --tags design,prd,brand
npx analyzthis_design connect --vault <path> --include Design,PRDs,Research
npx analyzthis_design sync
npx analyzthis_design sync --target all
npx analyzthis_design disconnect --vault <path>
npx analyzthis_design status
```

---

## How it fits together

```
Your vault / repo PRDs
        ↓
  knowledge bank  ←── npx analyzthis_design sync
        ↓
  /ux-story-gate
        ↓
  Phase 0: read knowledge bank + scan repo for PRDs
        ↓
  Build task map (or confirm draft from PRDs)
        ↓
  Route to: /noor  /anuj  /arjun  (+/meera  /zara  as needed)
        ↓
  Task × Finding table  →  P0 / P1 / P2 verdict
```

---

## Repository structure

```
bin/
  cli.js              CLI entry point
lib/
  install.js          Skill installation logic (copies to ~/.cursor/skills/ etc.)
  knowledge.js        Vault reading, sync, PRD categorisation
scripts/
  obfuscate.js        Build step — obfuscates lib/ and bin/ into dist/ before publish
skills/
  arjun/              UX Agent — Honeycomb scoring
  meera/              Business Agent — retention, ARR, GTM
  priya/              Feasibility Agent — effort sizing
  zara/               Delight Agent — peak-end moment
  noor/               IA Architect — minimalist Concept A
  anuj/               Power-User Advocate — dense Concept B
  raj/                Arbitrator — stalemate resolution
  design-critic/      Orchestrator — 4-persona critique
  ux-ideator/         Orchestrator — 6-phase ideation
  ux-story-gate/      Orchestrator — task-first gate + PRD discovery
  design-personas/    Session context template
  knowledge-bank/     Auto-populated from connected vault
  design-reference/   12 CSV files — colors, typography, UX guidelines,
                      component patterns, charts, icons, 16 framework stacks
```

---

## Requirements

- Node.js 16+
- [Cursor](https://cursor.com) with Agent Mode (for `/skill` commands)
- Claude Code or Codex CLI if using those targets

---

## License

MIT — [Rishikesh Joshi](https://github.com/rishikeshjoshi)
