---
name: receipt
description: Show inferred token spend for this project's last slash and MCP turns. Not a bill. Use after a critique when you want to see tokens-per-verdict.
disable-model-invocation: true
---

# Receipt

You cannot know Claude’s real usage from slash alone. Do not invent a dollar figure.

## What to do

1. Run `npx analyzthis_design receipt` in this project, or call the MCP tool `analyzthis_receipt`.
2. Report the printed inferred tokens and tokens-per-verdict exactly.
3. Label them **inferred**, never verified, never a monthly dollar.

If there is no session yet: `npx analyzthis_design session init`, then run a critique, then receipt.
