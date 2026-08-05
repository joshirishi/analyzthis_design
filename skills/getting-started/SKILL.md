---
name: getting-started
description: First-run guide for Analyzthis Design — which slash command to use for wireframes, text wireframe layouts, IA concepts, critiques, and knowledge setup. Read this before your first design session.
---

# Getting Started — Analyzthis Design

Welcome. This package gives you **8 design personas** as slash commands in Cursor, Claude Code, Grok, Windsurf, and Codex.

---

## 60-second setup (recommended once per project)

```bash
npx analyzthis_design collect
```

This runs **Kavi** — scans your repo, builds an Obsidian vault, and syncs a **knowledge bank** so every persona reads your PRDs, components, and brand context first.

---

## Pick your path

| I want to… | Run this | Why |
|---|---|---|
| Wireframe a new screen or flow | `/ux-ideator` or `/noor` | Full **text wireframes**, two competing IA concepts |
| Quick minimalist wireframe | `/noor` | Concept A — progressive disclosure, one primary action |
| Dense power-user wireframe | `/anuj` | Concept B — bulk actions, keyboard shortcuts, full density |
| Design + guide implementation like a senior designer | `/design-director` | Wireframe → **DesignSpec** → spec gates → build (when approved) |
| Critique an **existing** design | `/persona-orchestrator` or `/design-critic` | Scored review → SHIP / REVISE / BLOCK |
| Review against PRDs and user stories | `/ux-story-gate` | Task map + routing before critique |
| Index my codebase for personas | `/kavi` | Kavi → knowledge bank |
| Run CLI orchestrator without API keys | `/devi` | Host LLM — voices personas from pending prompts |

---

## CLI orchestrator (no API keys)

```bash
npx analyzthis_design run --task "Review my invoice screen" --full
# CLI pauses → invoke /devi in Cursor to fill persona responses
npx analyzthis_design run --continue --task "Review my invoice screen" --full
```

---

## Important: wireframes vs critique

**Do not use `/persona-orchestrator` for wireframes.** It is optimized for **critique** (scores, gates, verdicts) and uses a lite output mode by default.

For wireframes only → `/ux-ideator`, `/noor`, `/anuj`.

For **full designer handoff** (spec + optional build) → `/design-director`.

---

## Copy-paste first prompts

**Design + spec + build (design director):**
```
/design-director Design a notifications settings page for our B2B app.
Use our shadcn components and tokens from the knowledge bank.
Produce a DesignSpec and implement after spec gates pass.
```

**Wireframe a new screen (Cursor / Claude / Grok):**
```
/ux-ideator Design a settings page for a B2B SaaS dashboard.
Primary user: ops manager, daily use. Stack: Next.js + shadcn.
Produce full text wireframes for both Concept A and Concept B.
```

**Quick minimalist wireframe:**
```
/noor Wireframe a checkout confirmation screen.
One primary action, progressive disclosure, ≤3 nav levels.
Use the full Concept A text wireframe format.
```

**Critique an existing screen:**
```
/persona-orchestrator Critique this login page for UX friction and hierarchy.
Assess only — do not implement changes.
```

**Index the repo first:**
```
/kavi Scan this codebase and sync the knowledge bank for this project.
```

**Windsurf:** replace `/` with `@` (e.g. `@ux-ideator`, `@getting-started`).

**Codex:** reference skill names in `AGENTS.md` or invoke by name from `~/.codex/skills/`.

---

## All entry commands

| Command | Role |
|---|---|
| `/getting-started` | This guide |
| `/kavi` | Kavi — codebase → vault → knowledge bank |
| `/ux-ideator` | Wireframe + ideation (two concepts) |
| `/noor` | Minimalist IA wireframe |
| `/anuj` | Power-user wireframe |
| `/design-director` | Full producer — ideation → DesignSpec → build |
| `/design-spec` | DesignSpec format + validation rules |
| `/persona-orchestrator` | Agentic critique (not wireframes) |
| `/design-critic` | 4-persona critique |
| `/ux-story-gate` | Task-first gate + router |
| `/arjun` | UX + visual design lens |
| `/meera` | Business / retention lens |
| `/priya` | Feasibility lens |
| `/zara` | Delight moment lens |
| `/deliberation-protocol` | Adversarial review — objections, grounding, satisfaction JSON |

---

## Personas debate before they agree (v1.19)

Personas default to **low satisfaction** — they contest each other's claims with evidence from your task map and PRD, not generic handoff paragraphs. Use `/deliberation-protocol` in multi-persona runs, or `npx analyzthis_design run --task "..." --full` in CLI.

---

## Re-print install help anytime

```bash
npx analyzthis_design welcome
npx analyzthis_design welcome --target claude
```

Docs: https://www.npmjs.com/package/analyzthis_design
