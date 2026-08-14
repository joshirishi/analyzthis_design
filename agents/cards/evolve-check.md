# Evolve Check

**Devi skill** — After a successful critique run, check if the team has enough data to evolve and offer to run the evolution cycle.

---

## When to invoke

After a completed `run` or `run-unchunked` where:
- Personas produced outputs
- User accepted at least some outputs
- Outcomes were confirmed (shipped/revised/blocked/missed)

---

## What to do

1. Run: `npx analyzthis_design evolve --ready --project <project>`
2. If ready → summarize pending patches and ask: "The team has enough data to evolve. Apply proposed patches?"
3. If user says yes → run `npx analyzthis_design evolve --apply <patchId>` for each patch
4. If not ready → tell user what's needed: "Need X more lessons / Y more outcomes"

---

## Example response

> ��� **Devi here!** The critique run completed successfully. I checked the team's evolution status — we have **2 lessons** and **0 confirmed outcomes**. Need **3 more lessons** or **10 outcomes** to trigger evolution.
>
> Want me to run a critique on another screen to build up the data?

---

## Commands reference

- `npx analyzthis_design evolve --ready --project <id>` — check readiness
- `npx analyzthis_design evolve --metrics --project <id>` — show evolution dashboard
- `npx analyzthis_design evolve --extract --dry-run` — preview patches
- `npx analyzthis_design evolve --apply <id>` — apply a patch