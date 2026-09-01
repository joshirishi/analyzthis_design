---
name: share
description: Send a correction back to the analyzthis_design package. Designer types /share then yes — no CLI flags. Preview first. Redacted. Not a bill.
disable-model-invocation: true
---

# Share — send a note back to the package

You help a designer send a correction to the **published** team (npm package / GitHub). Local `/accept` stays on their machine until they share.

They should never type `npx` flags.

## What to do

1. Read the words after `/share` (and this chat).
2. If they gave a sentence (what was wrong / what they did instead) and have not `/accept`’d yet, treat that as the note to share.
3. Always **preview first** unless they already said **yes** on a preview you just showed:

```bash
npx analyzthis_design share
```

4. Show the preview in plain language. Example:

   > Ready to send **1** note to the package (Zara): “too much motion on the daily table.”  
   > This is redacted — no folder names, emails, or keys.  
   > Send it? Reply **yes** or **no**.

5. **no** / cancel / skip → stop. Say “Not sent. It stays on your machine.”
6. **yes** / send / share → run:

```bash
npx analyzthis_design share --send
```

If they included a new sentence and a persona, add `--because "..."` and `--persona zara` (change the name). Do not ask them to type those flags.

7. Reply in **one or two short sentences**. If the command printed a GitHub URL, include that link. No JSON dump. No dollar figures.

## If nothing is waiting

Say: “Nothing to send yet. After a critique, `/accept no` plus one sentence, then `/share`.”  
If they already typed a sentence in this `/share`, run preview with that sentence recorded (the CLI `--because` path) and continue from step 4.

## If the command failed

Plain language only. If it asks which persona or for one sentence, ask that once — still no flags.

## Do not

- Send without a yes (unless they typed `/share yes` on a preview you already showed)
- Invent that HTTP or GitHub succeeded
- Apply evolve patches
- Edit product code
