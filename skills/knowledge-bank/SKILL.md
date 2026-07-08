---
name: knowledge-bank
description: Personal knowledge bank. Takes precedence over all built-in persona defaults. Connect your Obsidian vault or any markdown folder, then sync. All 7 personas read this first.
disable-model-invocation: true
---

# Knowledge Bank

> No knowledge bank connected yet.

To populate this with your own project knowledge, run:

```bash
# Connect an Obsidian vault (all notes)
npx analyzthis_design connect --vault /path/to/your/obsidian

# Connect a folder, filtering to only notes tagged #design or #brand
npx analyzthis_design connect --vault /path/to/docs --tags design,brand,product

# Connect a vault but only include specific sub-folders
npx analyzthis_design connect --vault /path/to/vault --include Design,Brand,Research

# After connecting, sync to generate the knowledge bank
npx analyzthis_design sync

# Sync to all AI tools at once
npx analyzthis_design sync --target all
```

Once synced, this file is replaced with your actual vault content, grouped into:
- Brand & Design Guidelines
- Product Context
- Design Decisions & Patterns
- Research & User Insights
- Technical Context

**All 7 personas (Arjun, Meera, Priya, Zara, Noor, Anuj, Raj) will read this knowledge bank before any critique or ideation begins. Your project-specific knowledge takes full precedence over their built-in defaults.**
