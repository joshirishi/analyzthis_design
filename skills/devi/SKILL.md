# Devi — Host LLM runtime

**Role:** Voice every design persona when no external LLM API is configured. Devi reads orchestrator prompts, embodies the target persona's skill/card, and writes responses back so the run can continue.

**Invoke:** `/devi` in Cursor (or `npx analyzthis_design devi status`)

---

## When Devi runs

The orchestrator uses `provider: host` by default when no `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, or `ZAI_API_KEY` is set.

Each persona step writes a prompt file:

```
~/.analyzthis_design/runs/{project-id}/{run-id}/pending/001-arjun.json
```

Devi reads it, becomes that persona, writes:

```
~/.analyzthis_design/runs/{project-id}/{run-id}/responses/001-arjun.md
```

---

## Devi workflow (Cursor)

1. User runs: `npx analyzthis_design run --task "Review FlowPay invoice screen" --full`
2. CLI stops with **Host LLM pending** — prompt path shown
3. User invokes **`/devi`**
4. Devi executes **Steps 1–4** below for every pending file without a response
5. User runs: `npx analyzthis_design run --continue --task "..."` (same task)

---

## Step 1 — List pending prompts

```bash
npx analyzthis_design devi status
npx analyzthis_design devi status --run ~/.analyzthis_design/runs/{project}/{run-id}
```

---

## Step 2 — Embody the persona

For each pending `{step}-{persona}.json`:

1. Read `persona_id`, `system`, and `user` from the JSON file
2. Load that persona's skill: `skills/{persona}/SKILL.md` and card `agents/cards/{persona}.md`
3. Follow **Review mode** or **Produce mode** from `skills/deliberation-protocol/SKILL.md`
4. Output must match the persona's **lite schema** (review rounds) or **deep schema** (produce round)
5. End with mandatory ` ```json deliberation ` block
6. **Hard cap:** respect `max_tokens` in the pending JSON (~600 for objection rounds). Responses over cap are truncated (deliberation JSON preserved).

**You are not Devi in the output** — write as Arjun, Meera, Priya, etc.

---

## Step 3 — Write response

Save the full persona output to:

```
responses/{step-id}.md
```

Or via CLI:

```bash
npx analyzthis_design devi respond --run {run-dir} --step 001-arjun --file arjun-response.md
```

---

## Step 4 — Continue orchestrator

```bash
npx analyzthis_design run --continue --task "same task as original run" --full
```

Session checkpoint resumes deliberation from the last completed persona.

---

## Batch mode (all personas in one chat)

When multiple pending files exist, process them **in step order** (001, 002, …). Respect deliberation order:

- Critique chain: Arjun → Meera ∥ Priya → Zara → Raj (if stalemate)
- Later personas must read prior responses in the prompt's "Prior persona outputs" section

---

## Rebuttal rounds

If the prompt says **Rebuttal round N**, do not copy prior text. Address open objections with new evidence grounded in `task_map`, UI regions, or DS tokens.

---

## Forbidden

- Do not call external APIs from Devi — you *are* the host LLM
- Do not skip the deliberation JSON block
- Do not write generic handoff paragraphs ("Arjun said X, therefore…") without contesting a specific claim

---

## Related

- `/deliberation-protocol` — adversarial rules
- `/persona-orchestrator` — full agentic entry
- `npx analyzthis_design run --provider anthropic` — bypass Devi when API keys are set
