---
name: run-unchunked
description: Run the legacy non-chunked orchestrator. Useful when the chunked planner overhead is not justified for a quick single-expert task.
---

# Run Unchunked — Legacy Orchestrator Mode

Use `/run-unchunked` when you want the original single-pass deliberation orchestrator instead of the default v2.0 chunked execution.

## When to use

- Quick single-expert tasks
- You already know exactly which personas to run
- You want one model to execute the whole chain without planner overhead
- Debugging or comparing against chunked output

## How to run

**Cursor / Claude / Grok:**

```
/run-unchunked --task "Fix contrast on the invoice table" --experts arjun
```

**Windsurf:**

```
@run-unchunked --task "Fix contrast on the invoice table" --experts arjun
```

**CLI:**

```bash
npx analyzthis_design run-unchunked --task "Fix contrast on the invoice table" --experts arjun
```

## Flags

- `--task` — required
- `--figma` — optional Figma URL
- `--experts` — explicit persona list
- `--full` / `--lite` — chain size
- `--no-deliberate` — legacy sequential handoff
- `--provider` — model provider
- `--max-rounds`, `--satisfaction` — deliberation tuning

## Note

This is the v1.x behavior preserved for compatibility. The default `npx analyzthis_design run` now uses chunked execution (frontier planner + cheap chunk models) in v2.0.
