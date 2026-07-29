#!/usr/bin/env node
'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const https = require('https');
const http  = require('http');
const { getProjectId, sessionDir } = require('./session');

const CONFIG_FILE = path.join(os.homedir(), '.analyzthis_design', 'config.json');

function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
  catch { return {}; }
}

// Strip HTML tags to a readable text snippet (no heavy deps)
function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function fetchUrl(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { headers: { 'User-Agent': 'analyzthis_design/1.8' }, timeout: 15000 }, (res) => {
      // Follow redirects
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && redirectsLeft > 0) {
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        res.resume();
        return resolve(fetchUrl(next, redirectsLeft - 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout fetching ${url}`)); });
  });
}

function webContextPath(projectId) {
  return path.join(sessionDir(projectId), 'web-context.md');
}

/**
 * Append a research snippet to the session's web-context.md.
 * Returns the absolute path written.
 */
function appendWebContext(projectId, { title, source, body }) {
  const dir = sessionDir(projectId);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = webContextPath(projectId);
  const date = new Date().toISOString();
  const block = `\n## ${title}\n\n> Source: ${source}\n> Fetched: ${date}\n\n${body}\n\n---\n`;
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, `# Web Research Context\n\n> Project: ${projectId}\n\n---\n`);
  }
  fs.appendFileSync(filePath, block);
  return filePath;
}

/**
 * Fetch a URL and write a cleaned text snippet into web-context.md.
 */
async function researchUrl({ url, project, maxChars = 4000 } = {}) {
  if (!url) throw new Error('--url is required');
  const projectId = project || getProjectId();
  const raw = await fetchUrl(url);
  const text = htmlToText(raw).slice(0, maxChars);
  const filePath = appendWebContext(projectId, {
    title: `Fetched: ${url}`,
    source: url,
    body: text || '_No readable text extracted._',
  });
  return { projectId, filePath, chars: text.length };
}

/**
 * Research by query. Uses research.provider from config when set;
 * otherwise writes a stub prompting the host IDE to use WebSearch.
 */
async function researchQuery({ query, project, maxChars = 4000 } = {}) {
  if (!query) throw new Error('--query is required');
  const projectId = project || getProjectId();
  const config = loadConfig();
  const provider = (config.research && config.research.provider) || null;

  // Optional: provider URL template, e.g. a custom search endpoint that returns HTML/JSON text
  if (provider && typeof provider === 'string' && provider.startsWith('http')) {
    const searchUrl = provider.replace('{query}', encodeURIComponent(query));
    const raw = await fetchUrl(searchUrl);
    const text = htmlToText(raw).slice(0, maxChars);
    const filePath = appendWebContext(projectId, {
      title: `Search: ${query}`,
      source: searchUrl,
      body: text || '_No readable text extracted._',
    });
    return { projectId, filePath, chars: text.length, mode: 'provider' };
  }

  // No provider configured — write a stub the orchestrator / host IDE fills via WebSearch/WebFetch
  const stub = [
    `_No research.provider configured in ~/.analyzthis_design/config.json._`,
    ``,
    `Host IDE: use WebSearch / WebFetch for query "${query}" and append the result here,`,
    `or set config.research.provider to a search URL template containing {query}.`,
  ].join('\n');
  const filePath = appendWebContext(projectId, {
    title: `Search stub: ${query}`,
    source: `query:${query}`,
    body: stub,
  });
  return { projectId, filePath, chars: stub.length, mode: 'stub' };
}

/**
 * Read the current web-context.md for a project (or null if none).
 */
function readWebContext({ project } = {}) {
  const projectId = project || getProjectId();
  const filePath = webContextPath(projectId);
  if (!fs.existsSync(filePath)) return null;
  return { projectId, filePath, content: fs.readFileSync(filePath, 'utf8') };
}

module.exports = { researchUrl, researchQuery, readWebContext, webContextPath, appendWebContext };
