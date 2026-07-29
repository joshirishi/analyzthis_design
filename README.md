# Analyzthis_Design

A set of AI design personas and a task-first evaluation framework that plugs into Cursor, Claude Code, and Codex CLI as slash commands — plus an agentic MoE router with shared session state so you can call the same graph from any IDE or from the CLI.

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
| `/persona-orchestrator` | **Recommended agentic entry point.** Loads MoE router + session state, runs ux-story-gate intake, executes the right persona chain, enforces DS / hierarchy / verify gates, synthesises a SHIP/REVISE/BLOCK verdict. |
| `/ux-story-gate` | Task-first gate: discovers PRDs, DS/Figma discovery, MoE routing, browser verify, assess-only mode. |
| `/design-critic` | 4-persona critique → `SHIP / REVISE / BLOCK` verdict with a Composite Score out of 20 + Information Hierarchy Gate. |
| `/ux-ideator` | 6-phase ideation → two competing IA concepts, deliberation, delight pass, feasibility check. |

### 7 Individual Personas

Invoke directly for targeted, already-grounded questions. For full screen evaluation, prefer `/persona-orchestrator` or `/ux-story-gate`.

| Command | Persona | What they evaluate |
|---|---|---|
| `/arjun` | UX + Visual Design | UX Honeycomb + Visual Design Audit (hierarchy, color, type, spacing, components, style fit, micro-interactions) |
| `/meera` | Business Agent | Retention, ARR, GTM lever, adoption risk; hierarchy vs north-star check |
| `/priya` | Feasibility Agent | Engineering effort (T-shirt sizing, 2-axis model), state machine traps |
| `/zara` | Delight Agent | Exactly ONE peak delight moment — never contrast/token recovery (routes to DS Gate + Arjun) |
| `/noor` | IA Architect | Minimalist Concept A + declared ranked information hierarchy |
| `/anuj` | Power-User Advocate | Dense Concept B — bulk actions, keyboard shortcuts, hierarchy kept prominent |
| `/raj` | Arbitrator | Resolves persona stalemates using 5 ranked product principles. Never speaks first. |

### Supporting skills

| Command | Purpose |
|---|---|
| `/design-personas` | Session context template — fill in once before a session |
| `/knowledge-bank` | Auto-populated from your connected vault. All personas read this first. |
| `/design-reference` | CSV reference data (colors, typography, UX guidelines, stacks, …) |

---

## Agentic system (v1.8)

```
User ask / Figma URL
        ↓
  /persona-orchestrator
        ↓
  ux-story-gate Phases 0–1.5 (PRD + DS/Figma + MoE router)
        ↓
  MoE subset OR design-critic / ideation chain
        ↓
  Hard gates: DS tokens → Information Hierarchy → Browser verify
        ↓
  Session state persisted  →  SHIP / REVISE / BLOCK
```

**Shared session state** lives at `~/.analyzthis_design/sessions/{project-id}/session-state.json` so Ask→Agent turns do not re-derive the task map, DS checklist, or routing decision.

```bash
npx analyzthis_design session init
npx analyzthis_design session show
npx analyzthis_design session reset
```

**Portable agent graph** (same manifests for Cursor / Claude / Codex / CLI):

```
agents/
  manifests/     # one JSON per persona + orchestrator
  router.json    # MoE problem-type → expert list
  chain.json     # default + ideation sequential graphs
  session-schema.json
```

**Standalone runtime (v2):**

```bash
# Print routing only (no API calls)
npx analyzthis_design run --task "Fix contrast on landing page" --dry-run

# Call Anthropic / OpenAI per persona step
export ANTHROPIC_API_KEY=sk-...
npx analyzthis_design run --task "Review this screen" --figma https://figma.com/... --provider anthropic
```

Provider defaults live in `~/.analyzthis_design/config.json`:

```json
{
  "orchestrator": { "provider": "anthropic", "model": "claude-sonnet-4-20250514" },
  "research": { "provider": "https://example.com/search?q={query}" }
}
```

**Web research:**

```bash
npx analyzthis_design research --url https://example.com/design-tokens
npx analyzthis_design research --query "EY design system tokens"
```

Writes to `~/.analyzthis_design/sessions/{id}/web-context.md` and merges into the knowledge bank on `sync`.

---

## UX Story Gate — How it works

`/ux-story-gate` is the task-first gate for any screen evaluation:

| Phase | What it does |
|---|---|
| 0 | PRD discovery from knowledge bank + repo |
| 0.5 | DS / Figma discovery + DS Token Checklist (exit criteria) |
| 1 | Task map intake gate |
| 1.5 | MoE problem-type router → writes `routing_decision` to session state |
| 2 | Field veto pass |
| 3 | Scale & states declaration |
| 4 | Per-task persona routing |
| 4.5 | Browser verify gate (navigate → snapshot → primary flow → mobile+desktop screenshot) |
| 5 | Task × Finding synthesis |
| 5.5 | Assess-only mode — no code changes until you say build / implement / apply |

---

## Knowledge Bank — Connect your vault

```bash
npx analyzthis_design connect --vault ~/Documents/MyVault
npx analyzthis_design connect --vault ~/vault --tags design,brand,prd,product
npx analyzthis_design connect --vault ~/vault --include Design,Brand,PRDs,Research
npx analyzthis_design sync
npx analyzthis_design sync --target all
npx analyzthis_design status
npx analyzthis_design disconnect --vault ~/Documents/MyVault
```

PRDs and user stories are surfaced at the top of the knowledge bank. Brand / design-system notes feed Phase 0.5. Web research merges under **Web Research Context**.

Config: `~/.analyzthis_design/config.json`.

---

## CLI Reference

```bash
# Install / remove / list
npx analyzthis_design
npx analyzthis_design --target all
npx analyzthis_design --force
npx analyzthis_design remove --target all
npx analyzthis_design list --target all

# Knowledge bank
npx analyzthis_design connect --vault <path> [--tags ...] [--include ...]
npx analyzthis_design sync [--target all]
npx analyzthis_design disconnect --vault <path>
npx analyzthis_design status

# Session (agentic)
npx analyzthis_design session init|show|reset [--project id] [--all]

# Research
npx analyzthis_design research --url <url>
npx analyzthis_design research --query <text>

# Standalone orchestrator
npx analyzthis_design run --task "..." [--figma URL] [--provider anthropic|openai] [--dry-run] [--output path]
```

---

## Repository structure

```
agents/                 Portable MoE graph (manifests, router, chain, session schema)
bin/cli.js              CLI entry point
lib/
  install.js            Skill installation
  knowledge.js          Vault sync + web-context merge
  session.js            Shared session-state.json
  research.js           URL / query → web-context.md
  orchestrator/run.js   Standalone LLM runtime (v2)
scripts/obfuscate.js    Build step → dist/
skills/
  persona-orchestrator/ Agentic entry point
  ux-story-gate/        Task-first gate + DS/MoE/verify/assess phases
  design-critic/        4-persona critique + hierarchy gate
  ux-ideator/           6-phase ideation
  arjun/ meera/ priya/ zara/ noor/ anuj/ raj/
  design-personas/ knowledge-bank/ design-reference/
```

---

## Requirements

- Node.js 16+
- [Cursor](https://cursor.com) with Agent Mode (for `/skill` commands)
- Claude Code or Codex CLI if using those targets
- For `run` (non–dry-run): `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`

---

## License

MIT — [Rishikesh Joshi](https://github.com/rishikeshjoshi)
