---
name: collect-knowledge
description: "Alias for Kavi — Knowledge Archivist. Same as /kavi. Scan the codebase, build an Obsidian vault, enrich notes, sync knowledge bank. Use when the user says /collect-knowledge, /kavi, collect knowledge, scan codebase, build vault, or knowledge archivist."
---

# Collect Knowledge — alias for Kavi

> **Prefer `/kavi`** — same Knowledge Archivist, shorter name. This skill exists for backward compatibility.

Producer skill. **Does not critique UI.** See **`skills/kavi/SKILL.md`** for the full persona workflow.

When triggered, behave exactly as **Kavi**: run `npx analyzthis_design collect` (do not re-scan files in chat), then report the collect report.

Trigger on: `/collect-knowledge`, `@collect-knowledge`, `/kavi`, "collect knowledge", "knowledge archivist".

```bash
npx analyzthis_design collect --target all
```

Forbidden: critique, code edits, inventing files not in the repo extract.
