'use strict';

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

var CATEGORIES = [
  'hierarchy', 'contrast', 'spacing', 'accessibility',
  'business', 'feasibility', 'delight', 'ia', 'tokens', 'performance'
];

function hashClaim(claim) {
  return crypto.createHash('sha1').update(claim.toLowerCase().trim()).digest('hex').slice(0, 12);
}

function categorizeClaim(claim) {
  var lower = claim.toLowerCase();
  for (var i = 0; i < CATEGORIES.length; i++) {
    if (lower.indexOf(CATEGORIES[i]) !== -1) return CATEGORIES[i];
  }
  return 'other';
}

function extractCoveredPoints(personaText, personaId) {
  if (!personaText || typeof personaText !== 'string') return [];
  var points = [];

  var fixesMatch = personaText.match(/Top\s*2\s*fixes:[\s\S]*?(?:\n|$)/i);
  if (fixesMatch) {
    var lines = fixesMatch[0].split('\n');
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      var m = line.match(/^\d+\.\s*(.+)$/);
      if (m) {
        var claim = m[1].trim();
        points.push({
          persona: personaId,
          claim: claim,
          category: categorizeClaim(claim),
          key: hashClaim(claim)
        });
      }
    }
  }

  var hierarchyMatch = personaText.match(/Hierarchy\[([A-F])\]/gi);
  if (hierarchyMatch) {
    for (var j = 0; j < hierarchyMatch.length; j++) {
      var claim2 = 'Visual hierarchy grade: ' + hierarchyMatch[j];
      points.push({
        persona: personaId,
        claim: claim2,
        category: 'hierarchy',
        key: hashClaim(claim2)
      });
    }
  }

  var scoreMatch = personaText.match(/(\d+(?:\.\d+)?)\s*\/\s*5/);
  if (scoreMatch) {
    var claim3 = 'Overall score: ' + scoreMatch[0];
    points.push({
      persona: personaId,
      claim: claim3,
      category: 'other',
      key: hashClaim(claim3)
    });
  }

  var objectionMatches = personaText.match(/objections?:[\s\S]*?(?:\n\n|```)/gi);
  if (objectionMatches) {
    for (var k = 0; k < objectionMatches.length; k++) {
      var objLines = objectionMatches[k].split('\n');
      for (var l = 0; l < objLines.length; l++) {
        var objLine = objLines[l].trim();
        var om = objLine.match(/[-*]\s*(.+)/);
        if (om) {
          var claim4 = om[1].trim();
          if (claim4.length > 10) {
            points.push({
              persona: personaId,
              claim: claim4,
              category: categorizeClaim(claim4),
              key: hashClaim(claim4)
            });
          }
        }
      }
    }
  }

  var seen = {};
  var unique = [];
  for (var p = 0; p < points.length; p++) {
    if (!seen[points[p].key]) {
      seen[points[p].key] = true;
      unique.push(points[p]);
    }
  }
  return unique;
}

function tagFindings(findings, priorCoveredPoints) {
  if (!findings || !findings.length) return [];
  var priorKeys = {};
  for (var i = 0; i < priorCoveredPoints.length; i++) {
    priorKeys[priorCoveredPoints[i].key] = priorCoveredPoints[i].persona;
  }
  var result = [];
  for (var j = 0; j < findings.length; j++) {
    var f = findings[j];
    var key = f.key || hashClaim(f.claim);
    var duplicateOf = priorKeys[key] || null;
    result.push({
      persona: f.persona,
      claim: f.claim,
      category: f.category || categorizeClaim(f.claim),
      novel: !duplicateOf,
      duplicate_of: duplicateOf
    });
  }
  return result;
}

function buildCoveredPointsSummaryFromPoints(points) {
  if (!points || !points.length) return '';
  var byPersona = {};
  for (var i = 0; i < points.length; i++) {
    var pt = points[i];
    if (!byPersona[pt.persona]) byPersona[pt.persona] = [];
    byPersona[pt.persona].push(pt.claim);
  }
  var lines = ['Already covered by prior personas (do NOT repeat — only add NEW insights):'];
  var personas = Object.keys(byPersona);
  for (var m = 0; m < personas.length; m++) {
    var pers = personas[m];
    var claims = byPersona[pers].slice(0, 3);
    lines.push('  ' + pers.charAt(0).toUpperCase() + pers.slice(1) + ' — ' + claims.join('; '));
  }
  return lines.join('\n');
}

function buildCoveredPointsSummary(personaOutputs) {
  if (!personaOutputs) return '';
  var allPoints = [];
  var ids = Object.keys(personaOutputs);
  for (var i = 0; i < ids.length; i++) {
    var id = ids[i];
    var entry = personaOutputs[id];
    if (entry && entry.text) {
      var pts = extractCoveredPoints(entry.text, id);
      for (var j = 0; j < pts.length; j++) {
        allPoints.push(pts[j]);
      }
    }
  }
  return buildCoveredPointsSummaryFromPoints(allPoints);
}

module.exports = {
  extractCoveredPoints: extractCoveredPoints,
  tagFindings: tagFindings,
  buildCoveredPointsSummary: buildCoveredPointsSummary,
  buildCoveredPointsSummaryFromPoints: buildCoveredPointsSummaryFromPoints,
  categorizeClaim: categorizeClaim,
  hashClaim: hashClaim
};