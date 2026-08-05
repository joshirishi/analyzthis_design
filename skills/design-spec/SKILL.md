---
name: design-spec
description: Machine-readable DesignSpec contract — layout, design tokens, component mapping, states, do/don't. Produced after ideation; validated by Arjun; required before build. Use when converting wireframes to implementable design direction.
---

# Design Spec — Machine-readable design contract

A **DesignSpec** tells the LLM **what** to design and **how** — like a senior designer's handoff doc, not a vague wireframe.

Schema: `agents/design-spec-schema.json` in the package (or `npx analyzthis_design spec template`).

---

## When to use

- After `/ux-ideator` or `/noor`/`/anuj` wireframes — convert the winning concept into a spec
- Before any **build/implement** step — the spec is the contract
- When `/design-director` runs Phase 3 (Spec synthesis)

---

## Rules (non-negotiable)

1. **Information hierarchy first** — copy ranked order from Noor's wireframe into `information_hierarchy` and assign `hierarchy_rank: 1` on the matching component.
2. **Tokens from the project** — read knowledge bank + `tailwind.config` / CSS vars. Set `tokens.source`. No raw `#hex` unless cited from brand docs.
3. **Real components only** — every `components[]` entry must map to an existing library component (`stacks/shadcn.csv`, repo `components/ui/`). Use `retrieve` for names:
   ```bash
   npx analyzthis_design retrieve --file stacks/shadcn.csv --column Component --keywords button,table
   ```
4. **All four states** — `empty`, `loading`, `error`, `success` are required.
5. **Citations** — palette/style choices use `[filename, row N: "exact value"]`.

---

## Output format

Emit a single fenced block the host can parse and persist:

```design-spec
{
  "version": "1.0",
  "screen_name": "Settings — Notifications",
  "status": "spec_review",
  ...
}
```

After emitting, persist to session (host runs):

```bash
npx analyzthis_design spec save --file ./design-spec.json
```

Or validate without saving:

```bash
npx analyzthis_design spec validate --file ./design-spec.json
```

---

## Status lifecycle

| Status | Meaning |
|---|---|
| `draft` | First pass from ideation — incomplete OK |
| `spec_review` | Ready for Arjun DS + hierarchy validation |
| `ship` | Spec approved — safe to implement if `mode: build_approved` |
| `revise` | Failed a gate — fix listed fields only |

---

## Validation gates (before `ship`)

**DS gate:** no invented hex; tokens from `tokens.source`; components from design system.

**Hierarchy gate:** rank #1 in `information_hierarchy` matches the visually dominant region/component (`hierarchy_rank: 1`).

**Arjun visual pass:** typography scale, spacing rhythm, and contrast classes are consistent with Visual Design Audit rubric — run scoped review on the spec only (no full page code required).

Set `spec_verdict` when done:

```json
"spec_verdict": {
  "arjun_visual": "pass",
  "ds_gate": "pass",
  "hierarchy_gate": "pass",
  "notes": ""
}
```

Then set `"status": "ship"`.

---

## Template

Run `npx analyzthis_design spec template` for an empty copy-paste block.

---

## Forbidden

- Vague components ("a nice table") — name the exact component
- Skipping states because "we'll add later"
- Setting `ship` without passing all three spec gates
