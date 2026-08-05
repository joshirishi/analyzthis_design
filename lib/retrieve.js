'use strict';

/**
 * Retrieve-on-demand reference rows from skills/design-reference/*.csv.
 *
 * Personas do not need the full CSV — just the rows relevant to the active
 * product type / stack / dimension. This module filters rows by keyword match
 * on named columns and returns a compact, citation-ready pack, caching the
 * result via lib/cache.js so repeat calls in the same run (or across runs,
 * until the source file changes) don't re-parse and re-filter the CSV.
 */

const fs   = require('fs');
const path = require('path');
const cache = require('./cache');

const { resolvePackageRoot } = require('./platforms');
const PACKAGE_ROOT = resolvePackageRoot(__dirname);

const REFERENCE_DIR = path.join(PACKAGE_ROOT, 'skills', 'design-reference');

// ─── CSV parsing (handles quoted fields containing commas) ──────────────────

function parseCsvLine(line) {
  const cells = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { cur += ch; }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      cells.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}

/**
 * Split raw CSV text into logical rows, respecting quoted newlines.
 */
function splitCsvRows(text) {
  const rows = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') inQuotes = !inQuotes;
    if (ch === '\n' && !inQuotes) {
      rows.push(cur);
      cur = '';
    } else if (ch !== '\r') {
      cur += ch;
    }
  }
  if (cur.trim().length) rows.push(cur);
  return rows;
}

function loadCsv(relPath) {
  const filePath = path.join(REFERENCE_DIR, relPath);
  if (!fs.existsSync(filePath)) throw new Error(`Reference file not found: ${relPath}`);
  const text = fs.readFileSync(filePath, 'utf8');
  const mtimeMs = fs.statSync(filePath).mtimeMs;
  const lines = splitCsvRows(text);
  const header = parseCsvLine(lines[0]);
  const rows = lines.slice(1).map((line, i) => {
    const cells = parseCsvLine(line);
    const obj = {};
    header.forEach((h, idx) => { obj[h.trim()] = (cells[idx] || '').trim(); });
    // Prefer the file's own "No" column as the citation row number (matches
    // the convention already used across all persona SKILL.md examples);
    // fall back to physical position if the column is absent.
    obj.__no = obj.No || String(i + 1);
    obj.__line = i + 2; // +1 for header, +1 for 1-indexing
    return obj;
  });
  return { header, rows, mtimeMs };
}

// ─── Filtering ───────────────────────────────────────────────────────────────

/**
 * @param {Array<object>} rows
 * @param {Array<{ column: string, anyOf: string[] }>} filters - AND across
 *   filters, OR (substring, case-insensitive) within each filter's anyOf list.
 */
function filterRows(rows, filters = []) {
  if (!filters.length) return rows;
  return rows.filter((row) =>
    filters.every((f) => {
      const cell = (row[f.column] || '').toLowerCase();
      return (f.anyOf || []).some((needle) => cell.includes(String(needle).toLowerCase()));
    }));
}

/**
 * Retrieve the top-N rows from a design-reference CSV matching `filters`,
 * using the on-disk cache keyed by file + filters + the file's own mtime (so
 * edits to the CSV invalidate stale cache entries automatically).
 *
 * @param {{ file: string, filters?: Array<{column:string, anyOf:string[]}>, limit?: number }} opts
 * @returns {{ file: string, rows: object[], matched: number, cacheHit: boolean }}
 */
function retrieve({ file, filters = [], limit = 3 }) {
  const { rows, mtimeMs } = loadCsv(file);
  const cacheKey = `retrieve:${file}:${cache.hashFilter({ filters, limit, mtimeMs })}`;
  const { value, hit } = cache.getOrCompute(cacheKey, () => {
    const matched = filterRows(rows, filters);
    return { file, rows: matched.slice(0, limit), matched: matched.length };
  });
  return { ...value, cacheHit: hit };
}

/**
 * Format a citation line for one retrieved row, in the mandatory format used
 * by every persona: `[filename, row N: "exact quoted value"]`.
 */
function cite(file, row, column) {
  return `[${file}, row ${row.__no}: "${row[column]}"]`;
}

module.exports = { REFERENCE_DIR, loadCsv, filterRows, retrieve, cite };
