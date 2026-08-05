#!/usr/bin/env node
'use strict';

/**
 * DesignSpec — parse, validate, and persist machine-readable design contracts.
 */

const fs = require('fs');
const path = require('path');
const session = require('./session');

const SCHEMA_PATH = path.join(__dirname, '..', 'agents', 'design-spec-schema.json');

function loadSchema() {
  try {
    return JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  } catch {
    return null;
  }
}

/** Extract ```design-spec ... ``` block from markdown/text. */
function parseFromText(text) {
  if (!text) return null;
  const m = String(text).match(/```design-spec\s*\n([\s\S]*?)```/i);
  if (!m) return null;
  try {
    return JSON.parse(m[1].trim());
  } catch {
    return null;
  }
}

function validateDesignSpec(spec) {
  const errors = [];
  if (!spec || typeof spec !== 'object') {
    return { valid: false, errors: ['Spec must be a JSON object'] };
  }

  const required = [
    'version', 'screen_name', 'status', 'intent', 'information_hierarchy',
    'layout', 'tokens', 'components', 'states',
  ];
  for (const key of required) {
    if (spec[key] === undefined || spec[key] === null) errors.push(`Missing required field: ${key}`);
  }

  if (spec.version && spec.version !== '1.0') {
    errors.push(`Unsupported version "${spec.version}" — use "1.0"`);
  }

  if (spec.status && !['draft', 'spec_review', 'ship', 'revise'].includes(spec.status)) {
    errors.push(`Invalid status "${spec.status}"`);
  }

  if (Array.isArray(spec.information_hierarchy) && spec.information_hierarchy.length === 0) {
    errors.push('information_hierarchy must have at least one ranked item');
  }

  if (spec.intent && !spec.intent.primary_action) {
    errors.push('intent.primary_action is required');
  }

  if (spec.layout && (!Array.isArray(spec.layout.regions) || spec.layout.regions.length === 0)) {
    errors.push('layout.regions must be a non-empty array');
  }

  if (spec.tokens) {
    for (const group of ['colors', 'typography', 'spacing']) {
      if (!spec.tokens[group] || typeof spec.tokens[group] !== 'object') {
        errors.push(`tokens.${group} is required`);
      }
    }
    // Flag invented hex when DS gate expects tokens
    if (spec.tokens.colors) {
      for (const [k, v] of Object.entries(spec.tokens.colors)) {
        if (/^#[0-9a-f]{3,8}$/i.test(String(v)) && !spec.tokens.source) {
          errors.push(`tokens.colors.${k} uses raw hex "${v}" — prefer CSS vars or Tailwind tokens from knowledge bank / tailwind.config`);
        }
      }
    }
  }

  if (!Array.isArray(spec.components) || spec.components.length === 0) {
    errors.push('components must be a non-empty array');
  } else {
    for (const [i, c] of spec.components.entries()) {
      if (!c.component) errors.push(`components[${i}].component is required`);
      if (!c.region) errors.push(`components[${i}].region is required`);
    }
  }

  if (spec.states) {
    for (const s of ['empty', 'loading', 'error', 'success']) {
      if (!spec.states[s] || !String(spec.states[s]).trim()) {
        errors.push(`states.${s} is required`);
      }
    }
  }

  // Rank #1 component should exist with hierarchy_rank 1
  if (Array.isArray(spec.components) && Array.isArray(spec.information_hierarchy) && spec.information_hierarchy.length) {
    const hasRank1 = spec.components.some((c) => c.hierarchy_rank === 1);
    if (!hasRank1) {
      errors.push('At least one component must set hierarchy_rank: 1 matching information_hierarchy rank #1');
    }
  }

  return { valid: errors.length === 0, errors };
}

function saveToSession(spec, { project, merge = true } = {}) {
  const projectId = project || session.getProjectId();
  const validation = validateDesignSpec(spec);
  const state = session.show({ project: projectId }) || session.init({ project: projectId });
  const patch = {
    design_spec: merge && state.design_spec
      ? { ...state.design_spec, ...spec, updated_at: new Date().toISOString() }
      : { ...spec, updated_at: new Date().toISOString() },
    digest: {
      ...(state.digest || {}),
      design_spec_status: spec.status || 'draft',
      hierarchy_top3: (spec.information_hierarchy || []).slice(0, 3),
    },
  };
  session.update({ project: projectId, patch });
  return { projectId, validation, design_spec: patch.design_spec };
}

function showFromSession({ project } = {}) {
  const projectId = project || session.getProjectId();
  const state = session.show({ project: projectId });
  if (!state || !state.design_spec) return null;
  return { projectId, design_spec: state.design_spec };
}

function validateFile(filePath) {
  const raw = fs.readFileSync(path.resolve(filePath), 'utf8');
  let spec = null;
  if (filePath.endsWith('.json')) {
    spec = JSON.parse(raw);
  } else {
    spec = parseFromText(raw) || JSON.parse(raw);
  }
  return { spec, ...validateDesignSpec(spec) };
}

/** Markdown template for host LLM to fill. */
function templateMarkdown() {
  return `\`\`\`design-spec
{
  "version": "1.0",
  "screen_name": "",
  "status": "draft",
  "intent": {
    "primary_user_task": "",
    "north_star_metric": "",
    "primary_action": "",
    "business_framing": ""
  },
  "information_hierarchy": [
    "1. [most important — primary action or data]",
    "2. [supporting context]",
    "3. [secondary]"
  ],
  "layout": {
    "grid": "12-col",
    "max_width": "max-w-7xl",
    "breakpoints": ["mobile", "desktop"],
    "nav_level": "L2",
    "regions": [
      { "name": "header", "span": "full", "content": "Page title + primary CTA" },
      { "name": "main", "span": "8/12", "content": "Primary content" },
      { "name": "aside", "span": "4/12", "content": "Secondary panel" }
    ]
  },
  "tokens": {
    "source": "tailwind.config | css-vars | knowledge-bank",
    "colors": {
      "primary": "bg-primary text-primary-foreground",
      "background": "bg-background",
      "muted": "text-muted-foreground"
    },
    "typography": {
      "page_title": "text-2xl font-semibold tracking-tight",
      "body": "text-sm leading-relaxed",
      "label": "text-xs font-medium uppercase tracking-wide"
    },
    "spacing": {
      "page_padding": "p-6 md:p-8",
      "section_gap": "gap-6",
      "stack_gap": "space-y-4"
    }
  },
  "components": [
    {
      "region": "header",
      "component": "Button",
      "import_path": "@/components/ui/button",
      "variant": "default",
      "hierarchy_rank": 1,
      "props": { "children": "Primary action label" }
    }
  ],
  "states": {
    "empty": "EmptyState with one CTA",
    "loading": "Skeleton rows matching final layout",
    "error": "Inline alert + retry",
    "success": "Toast + updated primary data"
  },
  "motion": { "enabled": false, "notes": "" },
  "do": ["Single primary CTA above the fold", "Use existing shadcn components only"],
  "dont": ["Invent hex colors", "Add second primary button"],
  "wireframe_ref": "synthesized",
  "delight_moment": "",
  "effort_estimate": "M",
  "citations": [],
  "spec_verdict": {
    "arjun_visual": "pending",
    "ds_gate": "pending",
    "hierarchy_gate": "pending",
    "notes": ""
  }
}
\`\`\``;
}

module.exports = {
  loadSchema,
  parseFromText,
  validateDesignSpec,
  saveToSession,
  showFromSession,
  validateFile,
  templateMarkdown,
  SCHEMA_PATH,
};
