# How to Use Analyzthis Design

This guide explains the three simplest ways to use Analyzthis Design:

1. Cursor Agent or Cursor CLI
2. Claude Code CLI
3. Local models through Ollama

Analyzthis Design gives your AI eight specialist design viewpoints:

- Arjun — UX and visual hierarchy
- Meera — business, retention, and growth
- Priya — engineering feasibility
- Zara — delight and memorable moments
- Noor — simple, focused interfaces
- Anuj — dense, efficient power-user interfaces
- Raj — product strategy and disagreement resolution
- Kavi — project knowledge collection

## Before you begin

You need Node.js 16 or newer. Check it with:

```bash
node --version
npm --version
```

Run the commands below from the project you want the personas to understand.

If you are testing an unpublished checkout of this repository, replace
`npx analyzthis_design@latest` with `node /path/to/analyzthis_design/bin/cli.js`.
The new calibration command becomes available through `npx` after its npm release.

## Recommended first-time setup

Install the skills into your AI tools:

```bash
npx analyzthis_design@latest install --target cursor
npx analyzthis_design@latest install --target claude
```

Or install for every supported tool:

```bash
npx analyzthis_design@latest install --target all
```

Then collect the current project's useful design and product context:

```bash
npx analyzthis_design@latest collect
```

This creates a project-specific knowledge bank from relevant files such as product requirements, components, design tokens, and research. It does not mix one project's knowledge into another project.

After updating Analyzthis Design, refresh installed skills with:

```bash
npx analyzthis_design@latest install --target all --force
```

## Option 1: Cursor Agent and Cursor CLI

### Use it in Cursor

Open the project in Cursor and start an Agent chat. Enter one of these prompts:

```text
/ux-ideator Design an invoice approval screen for finance managers.
Use this project's components and produce two different layout concepts.
```

```text
/persona-orchestrator Review the current onboarding screen.
Assess usability, visual hierarchy, business impact, and implementation risk.
Do not edit code yet.
```

```text
/design-director Design and implement a production-ready settings page.
Reuse our existing components and design tokens.
```

Useful commands:

- `/ux-ideator` — create two competing interface concepts
- `/design-director` — design, specify, and optionally implement
- `/persona-orchestrator` — critique an existing design
- `/design-critic` — deeper multi-persona critique
- `/noor` — simple, focused design
- `/anuj` — dense power-user design
- `/arjun`, `/meera`, `/priya`, `/zara` — ask one specialist
- `/kavi` — refresh project knowledge
- `/accept` — keep or reject the latest persona output

If a command is missing, reinstall and start a new Cursor Agent session:

```bash
npx analyzthis_design@latest install --target cursor --force
```

### Use it from Cursor CLI

Cursor's command-line agent uses the `agent` command. Install it if needed:

```bash
curl https://cursor.com/install -fsS | bash
agent update
```

Start an interactive session from your project:

```bash
cd /path/to/your/project
agent
```

Then enter a skill prompt such as:

```text
/design-critic Review the dashboard in this repository. Assess only.
```

For a one-command, non-interactive run:

```bash
agent -p "/persona-orchestrator Review the checkout flow in this repository. Assess only."
```

The slash command is part of the prompt sent to Cursor Agent. It is not a standalone shell command.

## Option 2: Claude Code CLI

Install the skills:

```bash
npx analyzthis_design@latest install --target claude
```

Start Claude Code from your project:

```bash
cd /path/to/your/project
claude
```

Then enter:

```text
/ux-ideator Design a permissions screen for a B2B application.
Create one simple concept and one power-user concept.
```

Or run Claude Code non-interactively:

```bash
claude -p "/design-critic Review the account settings flow in this repository. Assess only."
```

Claude Code reads the installed skills from `~/.claude/skills/`. Analyzthis Design also writes compatible command files to `~/.claude/commands/`.

If Claude cannot find a skill:

```bash
npx analyzthis_design@latest install --target claude --force
```

Then start a new Claude Code session.

## Option 3: Local models with Ollama

Ollama is a local model server. It does not load Analyzthis Design slash commands by itself. Use the Analyzthis Design CLI and tell it to call an Ollama model.

### Install and prepare a model

Install Ollama from [ollama.com](https://ollama.com), then pull a supported model:

```bash
ollama pull qwen2.5
ollama list
```

On macOS, opening the Ollama application normally starts its local server. On other systems, start it with:

```bash
ollama serve
```

The default local address is `http://localhost:11434`.

### Easiest fully local run

Use the unchunked runner when you want one Ollama model to perform the whole review:

```bash
npx analyzthis_design@latest run-unchunked \
  --task "Review the invoice approval screen" \
  --provider ollama \
  --model qwen2.5 \
  --experts arjun,meera,priya
```

For a quicker single-persona review:

```bash
npx analyzthis_design@latest run-unchunked \
  --task "Check visual hierarchy and spacing" \
  --provider ollama \
  --model qwen2.5 \
  --experts arjun
```

### Use Ollama with the chunked runner

The default `run` command first asks a planner to divide the work into smaller tasks. To keep both planning and execution local, create or update:

```text
~/.analyzthis_design/config.json
```

Use this configuration:

```json
{
  "chunk_models": {
    "budget": "free",
    "planner": {
      "provider": "ollama",
      "model": "qwen2.5"
    }
  }
}
```

Then run:

```bash
npx analyzthis_design@latest run \
  --task "Review the complete onboarding flow" \
  --budget free \
  --provider ollama \
  --model qwen2.5
```

Analyzthis Design automatically detects models returned by `ollama list`. Recommended local names include `qwen2.5`, `llama3.1`, `mistral`, `gemma3:4b`, and `phi4`. Larger models usually give better design reasoning but require more memory and run more slowly.

To use Ollama on another machine or port:

```bash
export OLLAMA_BASE_URL="http://your-host:11434"
```

For chunked runs, also merge the discovery address into `config.json`:

```json
{
  "ollama": {
    "base_url": "http://your-host:11434"
  }
}
```

### Common Ollama problems

Check that the server is reachable:

```bash
curl http://localhost:11434/api/tags
```

If a model is missing:

```bash
ollama pull qwen2.5
```

If your computer runs out of memory, use a smaller model such as:

```bash
ollama pull gemma3:4b
```

## Run directly from any terminal

You can use the standalone runner even when Cursor or Claude is not open:

```bash
# Preview the plan without calling a model
npx analyzthis_design@latest run \
  --task "Review the checkout flow" \
  --dry-run

# Use automatically discovered free or local models
npx analyzthis_design@latest run \
  --task "Review the checkout flow" \
  --budget free

# Use a specific cloud model provider
export ANTHROPIC_API_KEY="your-key"
npx analyzthis_design@latest run-unchunked \
  --task "Review the checkout flow" \
  --provider anthropic
```

Never place API keys in source files or commit them to Git.

## Calibrate models for each persona

Calibration compares the models available on your computer against a fixed benchmark. It learns which model performs best for each persona and difficulty level.

Always preview the cost and number of calls first:

```bash
npx analyzthis_design@latest calibrate \
  --dry-run \
  --max-usd 5 \
  --max-calls 500
```

Run the benchmark after reviewing the preview:

```bash
npx analyzthis_design@latest calibrate \
  --max-usd 5 \
  --max-calls 500
```

Apply qualified winners only after judge alignment succeeds:

```bash
npx analyzthis_design@latest calibrate \
  --max-usd 5 \
  --max-calls 500 \
  --judge \
  --apply
```

Calibration:

- never exceeds the limits you provide
- stores progress in a checkpoint so interrupted runs can resume
- keeps private prompts and raw outputs on your computer
- requires independent judge evidence before changing active model choices
- shares nothing unless you explicitly request sharing

Ollama models can participate automatically when Ollama is running. A local-only pool can be benchmarked, but applying a winner may require additional independent model families for reliable judging.

## Tell the system whether advice worked

After a persona run, record whether you accepted its advice:

```bash
npx analyzthis_design@latest accept --keep --persona arjun
```

Or explain why it needs correction:

```bash
npx analyzthis_design@latest accept \
  --fix \
  --persona arjun \
  --because "The recommendation ignored our existing design tokens"
```

Later, record the real outcome:

```bash
npx analyzthis_design@latest outcome \
  --confirm \
  --persona arjun \
  --result shipped
```

Valid results are `shipped`, `revised`, `blocked_correctly`, and `missed`. These signals help the system learn without confusing an API failure with poor design advice.

## Which path should you choose?

- Choose Cursor when you want visual project context and code changes inside the IDE.
- Choose Cursor CLI when you want the same agent workflow from a terminal or script.
- Choose Claude Code when Claude is your main coding agent.
- Choose Ollama when privacy and local execution matter more than speed or maximum model quality.
- Choose the standalone `npx analyzthis_design run` command for automated, model-routed reviews.

For your first run, start with:

```bash
npx analyzthis_design@latest collect
npx analyzthis_design@latest run \
  --task "Review this product's most important user flow" \
  --dry-run
```

Then use `/ux-ideator` for new designs or `/persona-orchestrator` for critiques in Cursor or Claude.

Project: [github.com/joshirishi/analyzthis_design](https://github.com/joshirishi/analyzthis_design)
