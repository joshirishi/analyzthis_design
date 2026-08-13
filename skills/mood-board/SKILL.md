---
name: mood-board
description: Build a visual/textual mood board from web references + design-system patterns, then run the persona team through adversarial deliberation to converge on a design direction. User can add references and rerun.
---

# Mood Board — Team-Based Visual Direction Setting

Use `/mood-board` when you want to explore visual directions for a screen, flow, or product and have the persona team deliberate on which references fit the user, task, and design system.

## What it does

1. **Collects references** from URLs you provide, configured `moodboard.urls`, and optional web search stubs.
2. **Tags each reference** with style, mood, surface, and heuristic keywords.
3. **Pulls design-system guidance** from `skills/design-reference/*.csv` (ui-reasoning, colors, styles, typography, stack files) based on your task and detected tech stack.
4. **Runs the team** (Arjun, Meera, Priya, Zara, Noor) through adversarial deliberation using the UX Honeycomb rigor matrix.
5. **Writes artifacts** to:
   - `~/.analyzthis_design/sessions/{projectId}/moodboard/{boardId}/board.json` (authoritative)
   - `./moodboard/{boardId}.json` (workspace copy for the user to inspect)
6. **Accepts user-contributed references** and reruns deliberation with the new input.

## Entry commands

```bash
npx analyzthis_design moodboard create --task "B2B fintech dashboard, trustworthy, high-contrast" \
  --url https://dribbble.com/shots/example --url https://example.com/article

npx analyzthis_design moodboard create --task "SaaS onboarding landing page" --auto

npx analyzthis_design moodboard critique --board <boardId>

npx analyzthis_design moodboard add --board <boardId> \
  --url https://dribbble.com/shots/new-ref \
  --title "Alternative hero layout" \
  --tags "landing,hero,trust" \
  --note "I like the white space and the trust badge placement"

npx analyzthis_design moodboard list
```

## v2.0 chunked execution

`/mood-board` now runs internally through the v2.0 chunked executor:
- Frontier planner scopes the board (personas, references, DS lookups).
- Cheap/free models tag references, retrieve design-system rows, and run the deliberation loop.
- Result is the same `board.json` artifact, but at lower average token cost.

## How the personas use it

| Persona | Lens |
|---|---|
| **Arjun** | Visual system fit, contrast, hierarchy, accessibility, WCAG |
| **Meera** | Brand/category fit, GTM risk, competitive positioning |
| **Priya** | Technical feasibility of implementing the style/pattern |
| **Zara** | First impression, delight moment, emotional response |
| **Noor** | IA clarity, progressive disclosure, surface structure |

Each persona scores references with the Honeycomb rigor matrix:
- Useful, Usable, Findable, Credible, Accessible, Desirable, Valuable
- Then deliberates with low satisfaction until consensus or Raj escalation.

## Output format

`board.json` contains:

```json
{
  "board_id": "abc123",
  "task": "B2B fintech dashboard, trustworthy, high-contrast",
  "references": [
    {
      "id": "def456",
      "url": "https://dribbble.com/shots/example",
      "title": "...",
      "description": "...",
      "source": "config",
      "type": "visual",
      "tags": ["dashboard", "trust", "dark", "data-dense"]
    }
  ],
  "design_system_pack": [ { "file": "ui-reasoning.csv", "rows": [...] } ],
  "deliberation": { "round_log": [...], "consensus_reached": true },
  "synthesis": { "verdict": "SHIP", "top3": [...] }
}
```

## User as "god"

You can:
- Add any URL or free-text note to the board.
- Override tags.
- Rerun critique after adding references.
- Accept or reject the final direction with `session accept --persona arjun` etc.

## Config

In `~/.analyzthis_design/config.json`:

```json
{
  "moodboard": {
    "urls": ["https://dribbble.com/shots/example"],
    "queries": ["fintech dashboard design"],
    "limit": 12,
    "workspace_dir": "./moodboard"
  }
}
```

## Notes

- Image URLs are stored as references; alt-text/captions are added during tagging.
- Web articles are fetched as plain text; image extraction from HTML is not yet implemented.
- Router rule: `mood_board` signals route to the `mood-board` skill, not the critique chain.
