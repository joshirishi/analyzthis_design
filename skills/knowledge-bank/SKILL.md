---
name: knowledge-bank
description: Project knowledge index — retrieve one persona slice. Do not load the full bank.
disable-model-invocation: true
---

# Knowledge Bank

> No knowledge bank connected yet.

**INSTRUCTION:** Load your persona slice via retrieve. Do not load the whole bank.

```bash
npx analyzthis_design collect --target all
npx analyzthis_design sync
```

MCP: `analyzthis_retrieve` with `kind=knowledge` and `persona=zara` (or arjun, meera, priya, noor, anuj, raj, kavi).

Connect a vault if you already have notes:

```bash
npx analyzthis_design connect --vault /path/to/your/obsidian
npx analyzthis_design sync
```

Once synced, this file stays an **index of titles**. Full notes live on disk. Slices are written per persona.

You cannot know host tokens. Do not invent a dollar figure.
