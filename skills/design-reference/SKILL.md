---
name: design-reference
description: Shared design reference data used by all 7 design personas. Contains color palettes, UI styles, typography pairings, UX guidelines, product-type patterns, landing page layouts, chart types, icon library, mobile interface rules, React performance patterns, and stack-specific guidance. Personas read specific files from this directory when making design decisions.
disable-model-invocation: true
---

# Design Reference Data

Shared knowledge base for all 7 design personas. Each CSV covers a specific design domain. Personas read only the files relevant to their current task — see the mapping below.

---

## File index

| File | What it contains | Who reads it |
|---|---|---|
| `ux-guidelines.csv` | Platform-specific UX rules — scroll behavior, nav, feedback, accessibility (WCAG) | Arjun, Noor, Anuj |
| `ui-reasoning.csv` | UI pattern decisions by product category — recommended style, color mood, effects, anti-patterns | Arjun, Noor, Meera |
| `app-interface.csv` | Mobile-specific rules — icon labels, touch targets, gestures (iOS/Android/React Native) | Arjun, Anuj |
| `styles.csv` | 85 UI styles — keywords, best-for, do-not-use-for, light/dark, performance, accessibility, Tailwind compatibility | Zara, Noor |
| `colors.csv` | 161 WCAG-tested color palettes — primary/secondary/accent/background tokens by product type | Zara, Meera, Noor |
| `typography.csv` | 74 font pairings — heading + body fonts, mood keywords, best-for, CSS import, Tailwind config | Zara |
| `google-fonts.csv` | Full Google Fonts catalog — use only when picking a specific font pairing | Zara (conditional) |
| `products.csv` | 162 product type → style mappings — recommended style, landing pattern, dashboard style, color focus | Meera, Raj |
| `landing.csv` | Landing page layout patterns — section order, CTA placement, color strategy, conversion optimization | Meera, Zara |
| `charts.csv` | 25 chart types — when to use, when not to use, accessibility grade, library recommendation | Arjun, Zara |
| `icons.csv` | Phosphor icon catalog — name, keywords, import code, usage context, style | Noor, Zara |
| `react-performance.csv` | React rendering patterns — memoization, lazy loading, virtualization, bundle splitting | Priya |
| `stacks/nextjs.csv` | Next.js-specific patterns and component guidance | Priya |
| `stacks/react.csv` | React-specific patterns | Priya |
| `stacks/shadcn.csv` | ShadCN component availability and usage | Priya, Noor, Anuj |
| `stacks/[other].csv` | angular, astro, flutter, html-tailwind, jetpack-compose, laravel, nuxt-ui, nuxtjs, react-native, svelte, swiftui, threejs, vue | Priya (match to session context stack) |

---

## How personas use this data

Each persona's SKILL.md specifies which files to read and when. Personas do NOT read all files at once — they read the minimum set needed for the current evaluation.

**Reading rule:** Read the CSV, extract the rows relevant to the product type / stack / style in the session context, and use that data to ground your output in specific, named values rather than abstract advice.

---

## Reference paths (after install)

All files live at: `~/.cursor/skills/design-reference/`

```
~/.cursor/skills/design-reference/
├── ux-guidelines.csv
├── ui-reasoning.csv
├── app-interface.csv
├── styles.csv
├── colors.csv
├── typography.csv
├── google-fonts.csv
├── products.csv
├── landing.csv
├── charts.csv
├── icons.csv
├── react-performance.csv
└── stacks/
    ├── nextjs.csv
    ├── react.csv
    ├── shadcn.csv
    └── ... (16 stacks total)
```
