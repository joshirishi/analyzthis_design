---
name: design-personas
description: Load the session context template for design persona workflows. Use this to set up context before running design-critic or ux-ideator. All 7 personas (Arjun, Meera, Priya, Zara, Noor, Anuj, Raj) read this context at runtime to ground their critiques in project-specific data.
disable-model-invocation: true
---

# Design Personas — Session Context

This skill provides the session context template used by all 7 design personas. Fill this in before starting a `design-critic` or `ux-ideator` session. Fields left blank are treated as "unknown — do not assume."

---

## How to use

1. Copy the template below into your chat
2. Fill in what you know — leave blank what you don't
3. Run `/design-critic` or `/ux-ideator`

---

## Session Context Template

```
## Product
Product name:
Industry / vertical:
Product type: [B2B SaaS / marketplace / consumer app / internal tool / other]
Stage: [early / growth / mature]

## Primary user
Who they are:
Session frequency: [daily / weekly / monthly / occasional]
Entity volume: [e.g. "50 campaigns", "200 orders", "10 clients"]
Key pain points:

## Business context (Meera reads this)
Primary north-star metric: [e.g. retention, ARR, DAU, conversion rate]
Customer segments: [e.g. enterprise / mid-market / SMB]
Competitive context: [key competitors, parity gaps, differentiation opportunities]
Pricing model: [subscription / usage-based / freemium / other]

## User research (Arjun reads this)
Available research: [session recordings / interviews / surveys / support tickets / analytics]
Key engagement data: [e.g. "feature X has <5% click rate", "users drop off at step 3"]
Known friction points:
Empty / error states that exist:

## Expert-user profile (Anuj reads this)
Who the expert user is:
High-frequency actions (>10×/session):
Actions that currently require multiple clicks but shouldn't:
Bulk operations needed:

## Tech stack (Priya reads this)
Frontend: [e.g. React, Vue, Next.js]
Backend: [e.g. REST API, GraphQL]
Known infrastructure constraints:
Third-party dependencies relevant to this feature:
Design system / component library:
Components already available for this feature:

## Design system (Noor + Anuj + Priya read this)
Component library:
Known gaps (components not in library):
Token system: [CSS vars / design tokens / Tailwind / other]

## PRD context (Raj reads this)
Primary persona priority: [who does the PRD explicitly prioritize?]
Stated success criteria:
Known constraints ("must not" statements):
Prior design decisions already made:

## Surface classification (Zara reads this)
Is this a high-frequency working surface? [yes / no / mixed]
First-time-user surfaces in scope:
Once-ever moments in scope (onboarding, first success, etc.):
Available animation/motion capabilities:

## Recent product decisions (all personas read this)
1.
2.
3.

## What is NOT in scope
-
```

---

## Persona reference map

| Persona | Role | Active in |
|---------|------|-----------|
| Arjun | UX Agent — UX Honeycomb | `design-critic` Ph5, `ux-ideator` Ph2 |
| Meera | Business Agent — retention, ARR, GTM | `design-critic` Ph5, `ux-ideator` Ph1 |
| Priya | Feasibility Agent — engineering effort | `design-critic` Ph5, `ux-ideator` Ph6 |
| Zara | Delight Agent — Peak-End, one moment | `design-critic` Ph5, `ux-ideator` Ph5.5 |
| Noor | IA Architect — Concept A, minimalist | `ux-ideator` Ph2, Ph3, Ph4 |
| Anuj | Power-User Advocate — Concept B, dense | `ux-ideator` Ph2, Ph3, Ph4 |
| Raj | Arbitrator — stalemate only | `ux-ideator` Ph4, Ph5 fallback |
