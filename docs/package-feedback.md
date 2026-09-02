# How local feedback becomes a package change

Three tiers. Signal only moves up a tier when it survives the gate below it.

```
  Tier 1  LOCAL          your machine, always on
          /accept yes|no  ->  feedback + outcome + lessons  ->  persona score
                                                                  |
                                                                  | opt-in, consented, redacted
                                                                  v
  Tier 2  AGGREGATE      Neon, behind a Vercel function, anonymous
          persona_feedback (+ outcome)      persona_scores (counts only)
                                \                 /
                                 v               v
                          persona_failure_signal  (>= 3 distinct installs)
                                                                  |
                                                                  | maintainer review
                                                                  v
  Tier 3  PACKAGE        a real edit to the shipped cards/skills, released
```

## Tier 1 — local (this is already automatic)

`/accept yes|no` writes through `lib/accept.js` to feedback, outcome, and lessons,
which produce the score in `lib/evolution-metrics.js`. Never leaves the machine.

## Tier 2 — aggregate (opt-in)

Both flows POST to a Vercel function (`website/api/feedback.js`) which holds the
Neon connection string in its own env — the package ships no database
credential. Both are consent-gated and redacted (`lib/feedback-submit.js` strips
paths, emails, and API keys). Setup: [neon-setup.md](neon-setup.md).

| Flow | Carries | Command |
|---|---|---|
| Corrections | persona, rating, **outcome**, task type, tags, redacted snippets | `feedback --submit` |
| Scores | counts and bands only — **no note text** | `scores --submit` |

`outcome` is the column that matters and the one 001 lacked. Without it a maintainer
sees only *"a user was unhappy"*. With it they can separate:

- **`revised` / `missed`** — the persona was actually wrong. Actionable.
- low rating but **`shipped`** — the designer disliked the delivery, not the judgment.
  A tone problem, not a rule problem.

## Tier 3 — package (the gate that matters)

`persona_failure_signal` only surfaces a row once **3+ distinct installs** report the
same persona failing the same task type. That threshold is the whole safeguard: it
stops one loud user from reshaping the personas for everyone.

Reviewing a surfaced row:

```sql
select * from persona_failure_signal
where persona = 'zara' order by missed desc;
```

If a cluster is real, `lib/evolve.js` already generates the patch shape locally
(`proposePromptPatch` writes `card_addition` / `skill_addition` against
`agents/cards/<persona>.md` and `skills/<persona>/SKILL.md`). The maintainer applies
that as an ordinary PR and ships it in the next version — at which point every
install gets the corrected persona, and `package_version` on subsequent rows shows
whether the fix actually moved the numbers.

**Local patches never auto-promote.** `evolve --apply` edits *your* copy only.
Crossing into the package is always a human PR.

## Privacy invariants

- Nothing leaves without consent (`~/.analyzthis_design/feedback/submit-consent.json`).
- `install_id` is a random 16-byte value, not derived from anything identifying.
- The scores table carries counts and bands — never note text.
- The HTTP endpoint exposes insert paths only — no read path exists, so a leaked
  URL permits noise, never disclosure.
- The database credential lives solely in Vercel env vars.
