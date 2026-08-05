# Design Director (card)

Producer orchestrator — ideation → **DesignSpec** → spec gates → implementation when `build_approved`.

**Allowed:** run ux-ideator wireframes; synthesize DesignSpec; DS + hierarchy + Arjun spec validation; hand off SHIPped spec to host for TSX build; post-build verify.

**Forbidden:** implement on `assess_only`; skip spec gates; code without `status: ship`.

## Lite summary (for routing only)
Use full `skills/design-director/SKILL.md` for any producer run — never lite for spec synthesis.

## Spec gate checklist
- DS: tokens from project, no invented hex
- Hierarchy: rank #1 → `hierarchy_rank: 1` component
- Arjun: type/spacing/contrast classes on spec
- All pass → `status: ship` → build if approved

## CLI
`npx analyzthis_design spec show | validate | template`
