---
name: mood-board
description: Build a visual mood board — Zara crops 20-24 real UI elements (cards, tables, type, colour, navigation) from 6+ live sites into a sectioned collage with each site's real colours and fonts. The persona team votes as advice; the user keeps, maybes, or rejects each tile in the browser, and the user's choice overrides every persona. The locked direction is saved for all personas.
---

# Mood Board — Zara presents, the user decides

Use `/mood-board` when you want to see a visual direction before designing a screen, flow, or product.

A mood board here is an **element collage**: one cropped piece of a real website per tile (a pricing card, a table header, a filter bar, a type pairing), grouped by the design question it answers, with the source page and that site's real colours and fonts on every tile.

**The user is the final word.** Persona votes show up on each tile as advice. A user keep, maybe, or reject is never overruled, and a rejected tile can never be added back.

## What a board is made of

| Section | Tiles | Settles |
|---|---|---|
| Direction note | text | Job, 3 adjectives, one "not this" |
| `first_screen` | 3–5 | How the product introduces itself |
| `typography` | 3–4 | Typeface character, size, hierarchy |
| `color` | 3–4 | Palette, accent use, light or dark |
| `components` | 6–8 | Buttons, inputs, cards, tables, navigation, radius, density |
| `imagery` | 2–4 | Photography, illustration, icons, or none |
| `motion` | 1–3 | Hover, transitions, loading |

Target **20–24 tiles from at least 6 sites**. Only use the sections the brief needs — a daily table screen usually drops `first_screen`.

Every tile carries: `page_url` (required), the cropped image, `section`, `element`, `tokens` (colours, fonts, radius, spacing, font size), `steal`, `refuse`, `peak`, and `concept: true` for Dribbble-style shots that are not shipped product.

## Flow

1. **Brief.** `create` with the task, then show the user the brief (job, 3 adjectives, one "not this", sections). Save their corrections with `brief … confirmed_by_user=true`.
2. **Zara scouts.** She opens real pages and crops elements (steps below). No invented URLs, no AI-generated pictures.
3. **Team advice.** `jury` returns the prompt. Arjun, Noor, Priya, and Meera vote keep / skip per tile with one because-line; save with `votes`. Zara does not vote on her own tiles. The board then waits for the user — the jury never closes it or sends Zara back by itself.
4. **User decides.** `show` serves the board on `127.0.0.1` and returns a URL. Open it with `browser_navigate`. The user clicks keep / maybe / reject and can add a "why" note on any tile. Their clicks save straight into `board.json`.
5. **Another round** — the user clicks "Send Zara back for more" (or you call `rescout` with their words). Zara's new brief starts with **USER DECISIONS**: their note, the kept tiles to build around, the rejected tiles never to bring back, and the sections still thin. No round cap when the user asks.
6. **Lock.** The user clicks "Lock this direction" (or `lock`). Their kept tiles, palette, fonts, rejections, and note are saved to the session as `design_direction`. Every persona reads it and must build inside it.

Only record a user decision through `decide` when the user said it in chat. Never decide for them.

## Capturing a tile in Cursor's browser

Tested on live sites. Follow it exactly:

1. `browser_navigate` with `newTab: true` — never reuse the user's canvas tab.
2. Get the capture script: `analyzthis_mood_board action=capture_script selector=<css> text=<visible text>`. Use `text` to pin the element — a bare `h1` often hits the logo. With `text`, the smallest matching element wins.
3. Run it with `browser_cdp` → `Runtime.evaluate` (`returnByValue: true`). It scrolls the element into view and returns `colors`, `fonts`, `radius`, `spacing`, `font_size`, and a `clip` rectangle.
4. `browser_cdp` → `Page.captureScreenshot` with `{ format: "png", clip }`. Do not set `captureBeyondViewport` — off-screen capture repeats content.
5. Large results are saved to a JSON file: pass that path as `image_path`. Small results come back inline: pass `data` as `image_base64`.
6. Save with `action=tiles`, including `page_url`, `section`, `element`, `tokens`, `steal`, `refuse`, `peak`.

`browser_take_screenshot` with an element `ref` is unreliable for this (it fails or crops the wrong area). Use the clip method above.

## Scroll films (motion and first-screen feel)

A still can't show easing, scroll choreography or a reel. For those, film the page instead of cropping it:

```bash
npx analyzthis_design moodboard film --board <id> --url https://osmo.supply --url https://exoape.com \
  --steal "easing taste" --refuse "scroll-hijack on daily UI"
```

or MCP `analyzthis_mood_board action=film board=<id> urls=[…]`.

- Headless Chrome records about 15 seconds per site: the page settles, then a wheel scroll moves through four depths and a still is taken at each one. Wheel events also move sites with their own scroll engines (Lenis, Locomotive, WebGL).
- Each film becomes a `motion` tile: a looping muted video with a poster, plus a strip of the four stills. Use `--section first_screen` for an arrival film.
- The user judges films the same way they judge crops: keep, maybe or reject. A kept film tells everyone the motion feel they want, not a licence to copy the motion onto daily product screens.
- Use 1–3 films per board. Film whole pages; keep cropping elements for components, typography and colour.
- Needs `playwright-core` (`npm install playwright-core`) and Google Chrome. Without them, record the page yourself and add it with `moodboard tile --video film.webm --stills a.png,b.png`.

## Commands

```bash
npx analyzthis_design moodboard create --task "Invoice approval table" \
  --adjectives calm,precise,trusted --not "AI purple SaaS hero" --sections components,typography,color
npx analyzthis_design moodboard brief --board <id> --adjectives calm,dense,trusted --yes
npx analyzthis_design moodboard capture-script --selector section --text "Pay this invoice"
npx analyzthis_design moodboard tile --board <id> --page https://stripe.com/invoicing \
  --image <crop.png | screenshot.json | https://…> --element "Hosted invoice card" --section components \
  --colors "#0a2540,#00c05b" --fonts sohne-var --steal "Amount first" --refuse "Phone-frame chrome" --peak "Ready to pay"
npx analyzthis_design moodboard critique --board <id>           # team votes (advice)
npx analyzthis_design moodboard votes --board <id> --votes votes.json
npx analyzthis_design moodboard show --board <id>               # clickable board, Ctrl+C to stop
npx analyzthis_design moodboard decide --board <id> --tile 3 --decision keep --note "this density"
npx analyzthis_design moodboard rescout --board <id> --note "more approval states"
npx analyzthis_design moodboard lock --board <id> --note "light, amount-first, hairline tables"
npx analyzthis_design moodboard list
```

MCP tool `analyzthis_mood_board` actions: `create` (default), `brief`, `capture_script`, `tiles`, `film`, `jury`, `votes`, `show`, `decide`, `rescout`, `lock`, `status`. `frames` and `verdict` still work as older names for `tiles` and `votes`.

## Files

- `~/.analyzthis_design/sessions/{projectId}/moodboard/{boardId}/board.json` — the board (authoritative)
- `…/{boardId}/assets/` — cropped images, so the board survives if a site changes
- `…/{boardId}/index.html` — read-only snapshot; `show` serves the clickable version
- `./moodboard/{boardId}.json` — workspace copy
- `session-state.json → design_direction` — the user's locked direction

## Persona lenses (advice)

| Persona | Votes on |
|---|---|
| **Arjun** | Contrast, hierarchy, accessibility, design-system fit |
| **Noor** | Information structure, progressive disclosure |
| **Priya** | How hard the pattern is to build |
| **Meera** | Brand and category fit, competitive positioning |
| **Zara** | Scouts and presents. Peak-End lens: same job, first 2 seconds, one steal, one refuse. Does not vote on her own tiles. |

## Rules

- No source page, no tile. Tiles without a real image are refused.
- A rejected element (same page and element name) can never be re-added.
- Board header always says: images are third-party references for direction only and not licensed for reuse.
- Motion stays 150–250ms ease-out. Cinematic scroll-hijack landings are refused for daily product UI.
- Router: `mood_board` signals route here, not to the critique chain.

## Older link-and-tag board

`--kind mood` keeps the previous board: tagged URLs, design-system rows from `skills/design-reference/*.csv`, and a five-persona deliberation. Add references with `moodboard add`.
