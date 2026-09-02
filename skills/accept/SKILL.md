---
name: accept
description: Keep or skip the last persona note for evolution. Designer types /accept then yes or no — no CLI flags to remember.
disable-model-invocation: true
---

# Accept — keep or skip

You help a designer mark the last persona note (Zara, Arjun, …) so the team can evolve. They should never type `npx` flags.

## What to do

1. Read the words after `/accept` (and this chat).
2. Decide keep vs skip:
   - **Keep:** yes, keep, ship, good, like, 👍
   - **Skip:** no, skip, fix, wrong, reject, 👎
3. If they did not say keep or skip, ask **once** in plain language:

   > Keep this note? Reply **yes** (we’re taking it) or **no** plus one sentence.

4. Infer the persona from this chat (`/zara`, `/arjun`, …). If unclear, ask **once**:

   > Was this Zara, Arjun, Meera, Priya, Noor, Anuj, or Raj?

5. On **skip**, you need one sentence (what was wrong, or what they did instead). If missing, ask **once**. Then stop asking.
6. Record it using **whichever path this host gives you** — never ask the designer
   to run anything:

   - **Have Bash** (Claude Code, Cursor, a terminal)?

     ```bash
     npx analyzthis_design accept --keep --persona zara
     npx analyzthis_design accept --fix --persona zara --because "one sentence from the designer"
     ```

   - **MCP only** (Claude Desktop — there is no terminal, so the commands above
     cannot run)? Call the **`analyzthis_accept`** tool:

     ```
     analyzthis_accept  { keep: true,  persona: "zara" }
     analyzthis_accept  { keep: false, persona: "zara", because: "one sentence" }
     ```

     `persona` is optional — the last persona that spoke is inferred.

   Both paths write identical state. Change `zara` to the persona they used.

7. Reply in **one or two short sentences**. Example: "Saved. Zara's note is marked keep."
   or "Saved. We logged your fix so the team can learn." After a skip, you may mention
   they can type `/share` to send it to the package. No JSON. No dollar figures. No flag
   tutorial unless the command failed.

## If it failed

Say what happened in plain language. If it asks which persona or for one sentence, ask the designer that — still no flags.

If Bash is unavailable and `analyzthis_accept` is not in your tool list, say the note
could not be recorded on this host — do not pretend it was saved.

## Do not

- Invent a monthly cost or a verified token bill
- Apply evolve patches (`evolve --apply`) from this command
- Edit product code
