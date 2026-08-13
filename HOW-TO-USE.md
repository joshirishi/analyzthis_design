# How to Use Analyzthis Design — Step-by-Step Guide

A practical guide for Cursor, Claude Code, Codex CLI, Grok Build, Windsurf Cascade, and any Agent Skills–compatible IDE.

> **Updated for v2.0.0:** `npx analyzthis_design run` now uses **chunked execution** by default (frontier planner → free/cheap chunk models → synthesis). Each chunk retrieves from 3-5 CSV reference files + vault slices, pooled into a single ranker call. Legacy single-pass is available as `npx analyzthis_design run-unchunked`.

---

## 1. What this package gives you

**8 design personas** as slash commands inside your IDE:

- **Arjun** — UX + Visual Design audit (Honeycomb + hierarchy)
- **Meera** — Business / retention / GTM lens
- **Priya** — Feasibility / engineering effort
- **Zara** — Delight moments
- **Noor** — Minimalist IA / progressive disclosure
- **Anuj** — Dense power-user IA
- **Raj** — Product strategy / stalemate arbitrator
- **Kavi** — Knowledge archivist

Plus composite skills: `/ux-ideator`, `/design-director`, `/persona-orchestrator`, `/design-critic`, `/ux-story-gate`, `/mood-board`.

---

## 2. One-time install (per machine)

Pick your IDE and run **one** command in any terminal:

```bash
# Cursor (default)
npx analyzthis_design --target cursor

# Claude Code
npx analyzthis_design --target claude

# Codex CLI
npx analyzthis_design --target codex

# Grok Build
npx analyzthis_design --target grok

# Windsurf Cascade
npx analyzthis_design --target windsurf

# Install to every supported IDE at once
npx analyzthis_design --target all
```

This copies the skills into the IDE's agent-skills directory:

| IDE | Where skills live | Invoke prefix |
|---|---|---|
| **Cursor** | `~/.cursor/skills/<skill>/SKILL.md` | `/` |
| **Claude Code** | `~/.claude/skills/<skill>/SKILL.md` | `/` |
| **Codex CLI** | `~/.codex/skills/<skill>/SKILL.md` | reference in `AGENTS.md` |
| **Grok Build** | `~/.grok/skills/<skill>/SKILL.md` | `/` |
| **Windsurf Cascade** | `~/.codeium/windsurf/skills/<skill>/SKILL.md` | `@` |
| **Cross-agent** | `~/.agents/skills/<skill>/SKILL.md` | `/` |

To see what is installed:

```bash
npx analyzthis_design list --target cursor
```

To reinstall after updating the package:

```bash
npx analyzthis_design --target all --force
```

---

## 3. Project setup (do this once per repo)

Open your project in the IDE, then in the chat/terminal:

```bash
npx analyzthis_design collect
```

This runs **Kavi**:

1. Scans your repo (PRDs, brand/tokens, pages, components, tech, research).
2. Writes an Obsidian-compatible vault under `~/.analyzthis_design/vaults/{projectId}/`.
3. Optionally enriches notes with an LLM.
4. Syncs a **knowledge bank** into your IDE so every persona reads your context first.

If you already have an Obsidian vault or markdown folder:

```bash
npx analyzthis_design connect --vault ~/Documents/MyVault
npx analyzthis_design sync --target all
```

---

## 4. How to pick the right slash command

| I want to… | Run this | Why |
|---|---|---|
| Wireframe a new screen or flow | `/ux-ideator` or `/noor` | Full text wireframes, two competing IA concepts |
| Quick minimalist wireframe | `/noor` | Concept A — progressive disclosure, one primary action |
| Dense power-user wireframe | `/anuj` | Concept B — bulk actions, keyboard shortcuts, full density |
| Design + spec + optional build | `/design-director` | Senior-designer handoff path |
| Critique an existing design | `/persona-orchestrator` or `/design-critic` | Scored review → SHIP / REVISE / BLOCK |
| Review against PRDs and stories | `/ux-story-gate` | Task map + routing before critique |
| Set visual direction | `/mood-board` | References + design-system patterns + team deliberation |
| Index the repo for personas | `/kavi` | Kavi → knowledge bank |
| Get a single-lens opinion | `/arjun`, `/meera`, `/priya`, `/zara`, `/noor`, `/anuj` | Targeted follow-up |

**Important:** do not use `/persona-orchestrator` or `/design-critic` when you want wireframes. They are for critique.

---

## 5. Common workflows

### 5.1 Wireframe a new screen

**Cursor / Claude / Grok:**

```
/ux-ideator Design a settings page for a B2B SaaS dashboard.
Primary user: ops manager, daily use. Stack: Next.js + shadcn.
Produce full text wireframes for both Concept A and Concept B.
```

**Windsurf:** replace `/` with `@`:

```
@ux-ideator Design a settings page for a B2B SaaS dashboard.
```

**Codex:** reference the skill in `AGENTS.md` or invoke by name from `~/.codex/skills/`.

What happens:

1. `ux-story-gate` builds a task map.
2. MoE router selects the ideation chain.
3. Meera → Noor + Anuj → Arjun → Zara → Priya run in groups.
4. Personas deliberate with low satisfaction.
5. You get two text wireframes plus a synthesis.

---

### 5.2 Critique an existing screen

```
/persona-orchestrator Critique this login page for UX friction and hierarchy.
Assess only — do not implement changes.
```

What happens:

1. `ux-story-gate` discovers PRDs and user stories.
2. MoE router picks a subset of the critique chain (default: Arjun + Meera).
3. For a full 4-persona review:

   ```
   /design-critic Full review of the invoice screen.
   Run all personas in --full mode.
   ```

4. Personas raise objections, ask questions, and converge.
5. Output: composite score, verdict (SHIP / REVISE / BLOCK), Top 3 fixes.

---

### 5.3 Design + spec + build

```
/design-director Design a notifications settings page for our B2B app.
Use our shadcn components and tokens from the knowledge bank.
Produce a DesignSpec and implement after spec gates pass.
```

What happens:

1. Ideation → two concepts.
2. DesignSpec is produced and validated.
3. Spec gates (design system, hierarchy) must pass.
4. If `mode: build_approved`, implementation begins.

---

### 5.4 Set visual direction with a mood board

```bash
npx analyzthis_design moodboard create --task "B2B fintech dashboard, trustworthy, high-contrast" --auto
npx analyzthis_design moodboard critique --board <boardId>
```

Or in chat:

```
/mood-board Build a mood board for a B2B fintech dashboard.
Trustworthy, high-contrast, data-dense. Include 3 web references.
```

What happens:

1. Web references and search stubs are collected.
2. Each reference is tagged (style, mood, surface).
3. Design-system patterns are pulled from `skills/design-reference/*.csv`.
4. Arjun, Meera, Priya, Zara, Noor deliberate using the UX Honeycomb matrix.
5. A `board.json` is written to `./moodboard/` for you to inspect.

You can add your own references and rerun:

```bash
npx analyzthis_design moodboard add --board <boardId> \
  --url https://dribbble.com/shots/example \
  --title "Alt hero" --tags "landing,trust"
```

---

### 5.5 Run the standalone CLI orchestrator

**v2.0 default — chunked execution (no API keys required):**

```bash
# Frontier planner + free/cheap chunk models
npx analyzthis_design run --task "Review my invoice screen"

# Prefer free models only (Ollama, Groq/Gemini/OpenRouter free endpoints)
npx analyzthis_design run --task "Review my invoice screen" --budget free

# Use your paid keys for cheap, capable models
npx analyzthis_design run --task "Review my invoice screen" --budget cheap --provider together

# Sequential is default; explicit parallel
npx analyzthis_design run --task "..." --parallel --max-chunks 6
```

**Legacy single-pass orchestrator (host mode, no API keys):**

```bash
# Start a run — it pauses and waits for the host LLM /devi
npx analyzthis_design run-unchunked --task "Review my invoice screen" --full
npx analyzthis_design devi status
npx analyzthis_design run-unchunked --continue --task "Review my invoice screen" --full

# Quick single-expert run
npx analyzthis_design run-unchunked --task "Just check spacing" --experts arjun
```

In host mode, the CLI writes pending prompts to:

```
~/.analyzthis_design/runs/{projectId}/{runId}/pending/
```

and reads responses from:

```
~/.analyzthis_design/runs/{projectId}/{runId}/responses/
```

---

## 6. IDE-specific notes

### Cursor

- Invoke skills with `/`, e.g. `/ux-ideator`, `/persona-orchestrator`, `/mood-board`.
- Skills live in `~/.cursor/skills/`.
- Use `/devi` when the CLI orchestrator is waiting for a host response.
- If a skill is missing, run `npx analyzthis_design --target cursor --force`.

### Claude Code

- Invoke skills with `/`, e.g. `/ux-ideator`.
- Skills live in `~/.claude/skills/`. Legacy commands also work from `~/.claude/commands/`.
- Use `/devi` for host LLM responses.

### Codex CLI

- Codex does not use `/` prefixes. Reference skill names in your project's `AGENTS.md` or invoke by name.
- Skills live in `~/.codex/skills/`.
- Example `AGENTS.md` line: `Skills: analyzthis_design/ux-ideator, analyzthis_design/persona-orchestrator`.

### Grok Build

- Invoke skills with `/`, e.g. `/ux-ideator`, `/persona-orchestrator`.
- Skills live in `~/.grok/skills/`.

### Windsurf Cascade

- Invoke skills with `@`, e.g. `@ux-ideator`, `@persona-orchestrator`, `@mood-board`.
- Skills live in `~/.codeium/windsurf/skills/`.

---

## 7. Persona-specific follow-ups

After a run, you can ask a single persona to go deeper:

```
/arjun Double-check the hierarchy on the wireframe from the last /ux-ideator run.
/meera Is the onboarding flow likely to improve activation rate?
/priya How much effort is the modal-vs-wizard choice?
/zara Add one delight moment to the empty state.
/noor Simplify the navigation to ≤3 levels.
/anuj Add bulk actions and keyboard shortcuts for daily users.
```

Each persona reads the session state, so you do not need to repeat the task.

---

## 8. After the run — accept, reject, evolve

### Mark an output accepted

```bash
npx analyzthis_design session accept --persona arjun
```

### Reject with correction

```bash
npx analyzthis_design session accept --persona arjun --reject \
  --comment "Invented tokens not in our DS" \
  --correction "Use --color-primary and spacing-4 from tokens.css" \
  --rating 2 --tags invented_tokens,missed_ds
```

### Make the team learn

```bash
npx analyzthis_design evolve --extract --dry-run   # preview
npx analyzthis_design evolve --extract             # write patch proposals
npx analyzthis_design evolve --apply <patchId>      # apply after review
```

### Confirm whether the advice actually shipped

```bash
npx analyzthis_design outcome --confirm --persona arjun --result shipped
# or: revised, blocked_correctly, missed
```

---

## 9. Configuration

Create `~/.analyzthis_design/config.json`:

```json
{
  "orchestrator": {
    "provider": "host",
    "mode": "lite"
  },
  "collect": {
    "web_urls": ["https://your-company.com/brand-guidelines"],
    "web_queries": ["your product design inspiration"],
    "web_limit": 10
  },
  "moodboard": {
    "urls": ["https://dribbble.com/shots/example"],
    "queries": ["fintech dashboard design"],
    "limit": 12,
    "workspace_dir": "./moodboard"
  }
}
```

No API keys are required for host mode. To use cloud providers, set one of:

- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `GEMINI_API_KEY` or `GOOGLE_API_KEY`
- `ZAI_API_KEY` or `ZHIPU_API_KEY`
- `GROQ_API_KEY` (free tier available)
- `TOGETHER_API_KEY`
- `OPENROUTER_API_KEY` (free models available)
- `DEEPSEEK_API_KEY`
- Local **Ollama** auto-detected at `localhost:11434` (no key needed)

---

## 10. Troubleshooting

| Problem | Fix |
|---|---|
| Skill not found in IDE | Reinstall: `npx analyzthis_design --target <ide> --force` |
| Personas re-ask for context | Run `npx analyzthis_design session show` — if a session exists, do not re-derive the task map |
| No web references fetched | Add `collect.web_urls` / `research.urls` to config, or paste URLs directly |
| Run pauses with "Host LLM pending" | Invoke `/devi` in Cursor/Claude, or run `npx analyzthis_design devi respond --run <dir> --step <id> --file response.md` |
| Want a cheaper run | Use `--lite` (default) instead of `--full` |
| Want deeper critique | Use `--full` for the full design-critic chain |
| Personas give generic advice | Add PRDs/brand/research notes and re-run `npx analyzthis_design collect` |
| CSV data seems stale | Run `npx analyzthis_design validate` to check integrity against `schema.json` |

---

## 11. Quick reference

```bash
# Help
npx analyzthis_design welcome

# Knowledge
npx analyzthis_design collect
npx analyzthis_design sync --target all
npx analyzthis_design session init
npx analyzthis_design session show

# Run (v2.0 chunked by default)
npx analyzthis_design run --task "Review this screen" --dry-run
npx analyzthis_design run --task "Review this screen" --budget free
npx analyzthis_design run --continue --task "Review this screen"

# Run (legacy single-pass)
npx analyzthis_design run-unchunked --task "Review this screen" --full

# Validate CSV reference data
npx analyzthis_design validate

# Mood board
npx analyzthis_design moodboard create --task "..." --auto
npx analyzthis_design moodboard critique --board <id>
npx analyzthis_design moodboard add --board <id> --url <url> --tags a,b

# Evolve
npx analyzthis_design evolve --extract --dry-run
npx analyzthis_design evolve --apply <patchId>
npx analyzthis_design outcome --confirm --persona arjun --result shipped
```

---

Docs: https://github.com/joshirishi/analyzthis_design
