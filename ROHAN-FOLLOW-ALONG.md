# Rohan — Analyzthis Design 2.4.1 follow-along

You already have the team. This page is the **order of steps**, not extra theory.

Package: **analyzthis_design 2.4.1** (has `/accept`)  
Repo: https://github.com/joshirishi/analyzthis_design

Do **not** add this package to `shared-ui` `package.json`. Do **not** run `npm install analyzthis_design` inside that repo. Use the `npx` lines below from any folder.

---

## Part A — Reinstall 2.4.1 (once)

### 1. Open Terminal

Any folder is fine, including `shared-ui-Main-branch_RohanUX`.

### 2. Run **one** line (match the tool you use)

**Cursor:**

```bash
npx analyzthis_design@2.4.1 --target cursor --force
```

**Claude Code:**

```bash
npx analyzthis_design@2.4.1 --target claude --force
```

`--force` replaces the old 2.3.x files. That is what you want.

### 3. Restart Cursor or Claude Code

Close the app, open it again, open your project.

### 4. First check

In chat, type and send:

```
/zara
```

Then type and send:

```
/receipt
```

If Claude’s `/` menu only shows **Getting Started**, type `/zara` anyway.

`/receipt` prints an **inferred** token number. It is not a bill. It is not a monthly dollar. It is the “they are here” moment.

---

## Part B — Teach them *your* product (once per project)

Personas start generic. They get useful after they read **your** screens.

In the **shared-ui** project folder:

```bash
npx analyzthis_design collect
```

Wait until it finishes. Then run critiques in that same project.

---

## Part C — How they evolve (after each real critique)

They do **not** get smarter from reinstall alone. They evolve when you mark what was right, what was wrong, and what shipped.

After `/zara`, `/arjun`, or a full review, type in chat (no terminal flags):

```
/accept
```

Then reply:

- **yes** — we are taking this note
- **no** plus one sentence — what was wrong, or what you did instead

Examples:

```
/accept yes
```

```
/accept no — too much motion on the daily table
```

If it asks which persona, say `zara` (or arjun, meera, …). You do not need to remember `npx` commands.

### After a handful of those

Ask the team if they have enough to propose changes (nothing applies until you say yes):

```bash
npx analyzthis_design evolve --ready
npx analyzthis_design evolve --extract --dry-run
```

`--dry-run` = preview only. Do not apply a patch unless Rishi (or you, after a preview) agrees.

---

## Part D — Send a note back to the package (optional)

`/accept` stays on your machine. To help **everyone** who installs the npm package later, in chat:

```
/share
```

You will see a short preview (redacted — no folder names, emails, or keys). Then:

```
/share yes
```

That opens a GitHub issue (or sends to the package inbox if Rishi has one set up). You do **not** need to remember `npx` flags.

You can also type the sentence in one go:

```
/share no motion on the daily table — keep speed
```

Then yes if the preview looks right.

You do **not** need to edit skill files.

---

## Checklist

- [ ] Ran `@2.4.1 --target cursor` **or** `--target claude` with `--force`
- [ ] Restarted the IDE
- [ ] `/zara` then `/receipt` worked
- [ ] `npx analyzthis_design collect` in shared-ui
- [ ] After a real screen: `/accept` then **yes** or **no** plus one sentence
- [ ] Optional: `/share` then **yes** to send a correction to the package
- [ ] Later: `evolve --ready` (dry-run only until someone reviews)

---

## If something fails

| What you see | What to do |
|---|---|
| `EUNSUPPORTEDPROTOCOL` / `workspace:*` | You ran `npm install` inside the workspace repo. Stop. Use the `npx … --target … --force` line instead. |
| Claude menu has no `/zara` | Type `/zara` anyway. Menu and commands are different. |
| Receipt says 0 | Run `/zara` first in this project, then `/receipt` again. |
| Collect looks empty | Confirm Terminal is in the **shared-ui** project root, then rerun `collect`. |

Questions: ping Rishi. Package version must say **2.4.1** (`npx analyzthis_design@2.4.1 --help` or the welcome line after install). `/accept` and `/share` are in 2.4.1, not 2.4.0.
