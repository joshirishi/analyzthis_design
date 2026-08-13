#!/usr/bin/env node
'use strict';

/**
 * CSV validation script.
 *
 * Checks every CSV file in skills/design-reference/ against schema.json:
 *   1. Row cell count matches header column count
 *   2. No column has a No column missing
 *   3. Cross-file joins resolve (e.g. products.csv Mapped Pattern → landing.csv Pattern Name)
 *   4. Filter columns are populated (not empty for majority of rows)
 *
 * Usage: node scripts/validate-csvs.js
 * Exit code: 0 = all pass, 1 = errors found
 */

var fs = require('fs');
var path = require('path');
var retrieve = require('../lib/retrieve');

var REF_DIR = path.join(__dirname, '..', 'skills', 'design-reference');
var SCHEMA_PATH = path.join(REF_DIR, 'schema.json');

function parseCsvLine(line) {
  var cells = [];
  var cur = '';
  var inQuotes = false;
  for (var i = 0; i < line.length; i++) {
    var ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { cur += ch; }
    } else if (ch === '"') { inQuotes = true; }
    else if (ch === ',') { cells.push(cur); cur = ''; }
    else { cur += ch; }
  }
  cells.push(cur);
  return cells;
}

function splitCsvRows(text) {
  var rows = [];
  var cur = '';
  var inQuotes = false;
  for (var i = 0; i < text.length; i++) {
    var ch = text[i];
    if (ch === '"') inQuotes = !inQuotes;
    if (ch === '\n' && !inQuotes) { rows.push(cur); cur = ''; }
    else if (ch !== '\r') cur += ch;
  }
  if (cur.trim().length) rows.push(cur);
  return rows;
}

var schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
var errors = [];
var warnings = [];

for (var fileKey in schema.files) {
  var spec = schema.files[fileKey];
  var filePath = path.join(REF_DIR, fileKey);
  if (!fs.existsSync(filePath)) {
    errors.push(fileKey + ': FILE MISSING');
    continue;
  }

  var content = fs.readFileSync(filePath, 'utf8');
  var rows = splitCsvRows(content);
  var header = parseCsvLine(rows[0]);
  var expectedHeader = spec.header;

  // Check header matches schema
  if (header.length !== expectedHeader.length) {
    errors.push(fileKey + ': header has ' + header.length + ' columns, schema expects ' + expectedHeader.length);
  } else {
    for (var h = 0; h < header.length; h++) {
      if (header[h].trim() !== expectedHeader[h].trim()) {
        errors.push(fileKey + ': header column ' + h + ' is "' + header[h].trim() + '", schema expects "' + expectedHeader[h].trim() + '"');
      }
    }
  }

  // Check each data row has the right cell count
  var badRows = 0;
  for (var r = 1; r < rows.length; r++) {
    if (!rows[r].trim()) continue;
    var cells = parseCsvLine(rows[r]);
    if (cells.length !== header.length) {
      badRows++;
      if (badRows <= 3) {
        errors.push(fileKey + ' row ' + (r + 1) + ': ' + cells.length + ' cells (expected ' + header.length + ')');
      }
    }
  }
  if (badRows > 3) {
    errors.push(fileKey + ': ... and ' + (badRows - 3) + ' more row-length mismatches');
  }

  // Check No column exists
  if (spec.no_column && header.indexOf(spec.no_column) === -1) {
    errors.push(fileKey + ': missing No column "' + spec.no_column + '"');
  }

  // Check filter column is populated
  if (spec.filter_column) {
    var filterIdx = header.indexOf(spec.filter_column);
    if (filterIdx === -1) {
      errors.push(fileKey + ': filter column "' + spec.filter_column + '" not found in header');
    } else {
      var emptyCount = 0;
      var totalRows = 0;
      for (var r2 = 1; r2 < rows.length; r2++) {
        if (!rows[r2].trim()) continue;
        totalRows++;
        var cells2 = parseCsvLine(rows[r2]);
        if (!cells2[filterIdx] || !cells2[filterIdx].trim()) emptyCount++;
      }
      if (totalRows > 0 && emptyCount / totalRows > 0.3) {
        warnings.push(fileKey + ': filter column "' + spec.filter_column + '" is empty in ' + emptyCount + '/' + totalRows + ' rows (' + Math.round(emptyCount / totalRows * 100) + '%)');
      }
    }
  }

  // Check cross-file joins
  if (spec.joins) {
    for (var joinCol in spec.joins) {
      var joinSpec = spec.joins[joinCol];
      var joinIdx = header.indexOf(joinCol);
      if (joinIdx === -1) continue;

      var targetPath = path.join(REF_DIR, joinSpec.target_file);
      if (!fs.existsSync(targetPath)) continue;
      var targetContent = fs.readFileSync(targetPath, 'utf8');
      var targetRows = splitCsvRows(targetContent);
      var targetHeader = parseCsvLine(targetRows[0]);
      var targetColIdx = targetHeader.indexOf(joinSpec.target_column);
      if (targetColIdx === -1) continue;

      var targetValues = {};
      for (var tr = 1; tr < targetRows.length; tr++) {
        if (!targetRows[tr].trim()) continue;
        var targetCells = parseCsvLine(targetRows[tr]);
        var val = targetCells[targetColIdx];
        if (val) targetValues[val] = true;
      }

      var joinMisses = 0;
      var joinTotal = 0;
      for (var jr = 1; jr < rows.length; jr++) {
        if (!rows[jr].trim()) continue;
        var joinCells = parseCsvLine(rows[jr]);
        var joinVal = joinCells[joinIdx];
        if (!joinVal || !joinVal.trim()) continue;
        joinTotal++;
        if (!targetValues[joinVal]) joinMisses++;
      }
      if (joinTotal > 0 && joinMisses / joinTotal > 0.2) {
        warnings.push(fileKey + ': join "' + joinCol + '" → ' + joinSpec.target_file + '.' + joinSpec.target_column + ': ' + joinMisses + '/' + joinTotal + ' misses (' + Math.round(joinMisses / joinTotal * 100) + '%)');
      }
    }
  }

  // Check Docs URL sparseness in stack files
  if (fileKey.indexOf('stacks/') === 0) {
    var docsIdx = header.indexOf('Docs URL');
    if (docsIdx !== -1) {
      var emptyDocs = 0;
      var totalStack = 0;
      for (var dr = 1; dr < rows.length; dr++) {
        if (!rows[dr].trim()) continue;
        totalStack++;
        var docsCells = parseCsvLine(rows[dr]);
        if (!docsCells[docsIdx] || !docsCells[docsIdx].trim()) emptyDocs++;
      }
      if (totalStack > 0 && emptyDocs / totalStack > 0.5) {
        warnings.push(fileKey + ': Docs URL empty in ' + emptyDocs + '/' + totalStack + ' rows');
      }
    }
  }
}

// Report
if (warnings.length) {
  console.log('\n── Warnings ──');
  warnings.forEach(function(w) { console.log('  ⚠ ' + w); });
}

if (errors.length) {
  console.log('\n── Errors ──');
  errors.forEach(function(e) { console.log('  ✗ ' + e); });
  console.log('\n❌ ' + errors.length + ' error(s), ' + warnings.length + ' warning(s)\n');
  process.exit(1);
} else {
  console.log('\n✅ All ' + Object.keys(schema.files).length + ' CSV files pass validation (' + warnings.length + ' warning(s))\n');
  process.exit(0);
}