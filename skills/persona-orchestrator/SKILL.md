---
name: persona-orchestrator
description: Agentic critique entry point for existing designs — MoE router, session state, ux-story-gate intake, persona chain, DS/hierarchy/verify gates, SHIP/REVISE/BLOCK verdict. Not for wireframes; use ux-ideator, noor, or anuj for new screen layout and text wireframes.
---

# Persona Orchestrator

The graph, not the room. This skill doesn't have a design opinion of its own — it loads the manifests in `agents/`, runs `ux-story-gate` for intake, picks the right personas via the MoE router, drives them through the chain with shared session state, and enforces the hard gates before handing back a verdict.

Use this as the **default entry point for critique** — reviewing, scoring, and gating existing designs. For wireframes and new screen layout, use `/ux-ideator`, `/noor`, or `/anuj` instead (see below).

---

## Not for wireframes — redirect to ideation skills

**Do not run this orchestrator when the user asks for wireframes, mockups, screen layout, IA concepts, or designing a new screen from scratch.**

When you detect these signals — `wireframe`, `mockup`, `new screen`, `design from scratch`, `layout`, `IA concept`, `ux ideator` — **stop and tell the user to invoke `/ux-ideator`** (full two-concept flow) or `/noor` / `/anuj` (single text wireframe). Do not run the critique chain or lite persona cards for wireframe asks.

`/noor`, `/arjun`, `/zara`, and the other persona skills still work standalone for targeted follow-ups after a wireframe or critique session.

---

## Lite output (default)

Verdict or one moment. Top three fixes (or one delight). One evidence line.
Expand the full schema only if the user says expand.
Call retrieve for the rest of this skill (kind=skill). You cannot know host tokens. Do not invent a dollar figure.

Retrieve the full lens: `analyzthis_retrieve` kind=skill file=persona-orchestrator (or `npx analyzthis_design retrieve` after MCP).
