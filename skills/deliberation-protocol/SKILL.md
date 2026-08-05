---
name: deliberation-protocol
description: Adversarial deliberation protocol for all design personas. Personas ground objections in real task/PRD/UI context, run parallel critique rounds with low default satisfaction until consensus or Raj escalation. Use when personas hand off, deliberate, object, or review prior output.
---

# Deliberation Protocol (v1.19)

Personas are **hard to satisfy by design**. They do not pass generic handoff documents — they **read, object, and ask contextual questions** about the real task, PRD, UI, and design system until evidence resolves objections or Raj arbitrates.

Schema: `agents/deliberation-schema.json`

---

## Two modes

| Mode | When | Output |
|------|------|--------|
| **Review** | Rounds 0..N-1, or when prior `persona_outputs` exist | Objections, questions, grounding — **not** a full rewrite |
| **Produce** | Final round after consensus or Raj ruling | Full persona output schema + deliberation JSON |

Default: `accepts_prior: false`, `satisfaction_with_prior` below threshold (0.4) until specific claims are addressed with evidence.

---

## Mandatory grounding

Every **objection** must include `grounded_in` citing one of:

- `task_map[N]` — primary user task from session
- PRD excerpt from knowledge bank / vault
- UI region (e.g. header, primary CTA, nav)
- DS token or component path from repo

**Forbidden:** generic handoff paragraphs ("Arjun scored X, therefore…") without contesting a **specific claim**.

---

## Deliberation JSON block (required)

End every review-round response with:

```json deliberation
{
  "grounding": [{"type": "task_map", "ref": "task_map[0]", "note": "Primary task is checkout, CTA buried"}],
  "satisfaction_with_prior": 0.25,
  "accepts_prior": false,
  "objections": [{
    "target_persona": "arjun",
    "claim": "Friction is low because labels are clear",
    "evidence_required": "Show task completion path in 3 steps from PRD",
    "blocking": true,
    "grounded_in": "task_map[0]: complete purchase in under 60s"
  }],
  "questions": ["Why is secondary nav above primary CTA given task_map[0]?"],
  "revisions": ["Move primary CTA above fold, align with hierarchy rank #1"],
  "verdict": "CONTEST"
}
```

Verdict values: `CONTEST` | `ACCEPT` | `SHIP` | `REVISE` | `BLOCK`

---

## Parallel adversarial pairs

From `agents/chain.json` → `deliberation_groups`:

- **Critique:** Arjun → Meera∥Priya → Zara
- **Ideation:** Meera → Noor∥Anuj → Arjun → Zara∥Priya
- **Lite MoE:** Arjun → Meera

Parallel personas critique **each other's output** on the same round — not independent essays.

---

## Raj escalation

Activate Raj when:

- 2+ unresolved **blocking** objections
- Same claim repeats without new evidence (stalemate)
- Round >= `escalate_to_raj_after_round` (default 2) with open objections

**Order (v1.20):** Raj runs **after all deliberation groups complete** — e.g. Zara always runs before Raj in the critique chain.

Raj reads all `persona_outputs` + `deliberation.round_log` and issues mandatory Stalemate Resolution.

---

## CLI / config

```bash
npx analyzthis_design run --task "..." --full --dry-run   # shows deliberation groups
npx analyzthis_design run --task "..." --satisfaction 0.3  # harder to please
npx analyzthis_design run --task "..." --max-rounds 2
npx analyzthis_design run --task "..." --no-deliberate   # legacy sequential
```

Config (`~/.analyzthis_design/config.json`):

```json
{
  "deliberation": {
    "satisfaction_threshold": 0.4,
    "max_rounds": 3,
    "parallel_pairs": [["noor", "anuj"], ["meera", "priya"]],
    "objection_token_cap": 600,
    "prior_output_chars_first": 800,
    "prior_output_chars_rebuttal": 400,
    "prior_output_chars_produce": 1200,
    "context_pack_chars_objection": 1500,
    "context_pack_chars_produce": 3000,
    "escalate_to_raj_after_round": 2
  }
}
```

**Low satisfaction ≠ unlimited tokens.** Objection rounds use **lite persona cards** (not full SKILL.md), **600-token output cap** (enforced on API + Devi/host), and **400-char prior-output snippets** on rebuttal rounds (parsed deliberation JSON summary preferred). Only synthesis and Raj produce rounds use full schemas.

---

## Session state

After deliberation runs, `session-state.json` includes:

- `deliberation.round_log` — per-persona parsed blocks per round
- `deliberation.open_objections` — unresolved blocking items
- `deliberation.consensus_reached` — boolean
- `metrics.deliberation_rounds`, `objections_raised`, `objections_resolved`, `raj_escalations`

Inspect: `npx analyzthis_design session show` | `npx analyzthis_design metrics`
