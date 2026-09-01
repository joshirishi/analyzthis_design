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
6. Run the CLI yourself. Do not ask them to copy commands.

**Keep:**

```bash
npx analyzthis_design accept --keep --persona zara
```

**Skip:**

```bash
npx analyzthis_design accept --fix --persona zara --because "one sentence from the designer"
```

Change `zara` to the persona they used. If they already named it in `/accept yes zara`, pass that.

7. Reply in **one or two short sentences**. Example: “Saved. Zara’s note is marked keep.” or “Saved. We logged your fix so the team can learn.” After a skip, you may mention they can type `/share` to send it to the package. No JSON. No dollar figures. No flag tutorial unless the command failed.

## If the command failed

Say what happened in plain language. If it asks which persona or for one sentence, ask the designer that — still no flags.

## Do not

- Invent a monthly cost or a verified token bill
- Apply evolve patches (`evolve --apply`) from this command
- Edit product code
