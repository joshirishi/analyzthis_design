---
name: chunk-planner
description: Explain the chunked execution planner. The planner is a frontier/strong model that breaks a design task into small, sequential chunks and assigns each to the cheapest capable model.
---

# Chunk Planner

In Analyzthis Design v2.0, the default `run` command uses **chunked execution**.

## How it works

1. **Planner** (frontier/strong model) reads the task + knowledge bank once.
2. It produces a chunk graph: persona, goal, prompts, effort, and dependencies per chunk.
3. **Router** picks the cheapest capable model for each chunk from:
   - Local Ollama models (auto-detected)
   - Free cloud APIs (Groq, Google Gemini, OpenRouter)
   - Cheap cloud APIs (OpenAI GPT-4o-mini, DeepSeek, Together)
4. **Executor** runs chunks sequentially by default, with retry + fallback.
5. **Synthesis** merges outputs and produces a final verdict.

## Planner policy

- The planner **never** runs on a lower/cheap model.
- If no frontier API key is available, it falls back to the host/Devi model with a warning.

## Example plan

```json
{
  "chunks": [
    { "id": "ia", "persona": "noor", "effort": "standard", "depends_on": [] },
    { "id": "visual", "persona": "arjun", "effort": "standard", "depends_on": ["ia"] },
    { "id": "feasibility", "persona": "priya", "effort": "trivial", "depends_on": ["ia"] },
    { "id": "synthesis", "persona": "raj", "effort": "hard", "depends_on": ["visual", "feasibility"] }
  ]
}
```

## Inspect a plan without running it

```bash
npx analyzthis_design run --task "..." --dry-run
```

This shows the planner output without calling any chunk models.
