'use strict';

/**
 * Small on-disk cache under ~/.analyzthis_design/cache/, keyed by a caller-chosen
 * string (e.g. "retrieve:colors.csv:<filterHash>", "figma:<fileKey>:<nodeId>",
 * "kb:<projectId>:<syncHash>"). Used to avoid re-reading/re-filtering the same
 * CSV rows, Figma node, or knowledge-bank slice on every persona call within a run.
 *
 * Not a distributed cache — this is a single-machine, single-user speed-up for
 * the standalone `run` CLI (and can be reused by IDE-side tooling if desired).
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const crypto = require('crypto');

const CACHE_ROOT = path.join(os.homedir(), '.analyzthis_design', 'cache');

function keyToFile(key) {
  const hash = crypto.createHash('sha1').update(key).digest('hex');
  return path.join(CACHE_ROOT, `${hash}.json`);
}

/**
 * Build a stable hash for a filter description (object or string), for use in
 * cache keys like `retrieve:colors.csv:{filterHash}`.
 */
function hashFilter(filter) {
  const normalized = typeof filter === 'string' ? filter : JSON.stringify(filter, Object.keys(filter).sort());
  return crypto.createHash('sha1').update(normalized).digest('hex').slice(0, 12);
}

/**
 * Read a cached value. Returns null on miss, expiry, or corrupt entry.
 * @param {string} key
 * @param {{ ttlMs?: number }} opts - ttlMs of 0/undefined means "no expiry".
 */
function get(key, { ttlMs } = {}) {
  const file = keyToFile(key);
  if (!fs.existsSync(file)) return null;
  try {
    const entry = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (ttlMs && Date.now() - entry.cachedAt > ttlMs) return null;
    return entry.value;
  } catch {
    return null;
  }
}

/**
 * Write a value to the cache under `key`.
 */
function set(key, value) {
  fs.mkdirSync(CACHE_ROOT, { recursive: true });
  const file = keyToFile(key);
  fs.writeFileSync(file, JSON.stringify({ key, cachedAt: Date.now(), value }, null, 2));
  return value;
}

/**
 * Fetch-through helper: return the cached value for `key` if present (and not
 * expired), otherwise call `computeFn`, cache its result, and return it.
 * @returns {{ value: any, hit: boolean }}
 */
function getOrCompute(key, computeFn, { ttlMs } = {}) {
  const cached = get(key, { ttlMs });
  if (cached !== null) return { value: cached, hit: true };
  const value = computeFn();
  set(key, value);
  return { value, hit: false };
}

/**
 * Delete one cache entry.
 */
function invalidate(key) {
  const file = keyToFile(key);
  if (fs.existsSync(file)) fs.rmSync(file);
}

/**
 * Delete every cache entry whose original key starts with `prefix` (e.g.
 * "retrieve:" or "kb:<projectId>:"). Used on `sync` / `session reset`.
 */
function invalidatePrefix(prefix) {
  if (!fs.existsSync(CACHE_ROOT)) return 0;
  let removed = 0;
  for (const f of fs.readdirSync(CACHE_ROOT)) {
    const full = path.join(CACHE_ROOT, f);
    try {
      const entry = JSON.parse(fs.readFileSync(full, 'utf8'));
      if (typeof entry.key === 'string' && entry.key.startsWith(prefix)) {
        fs.rmSync(full);
        removed += 1;
      }
    } catch {
      // corrupt entry — leave it; not worth failing the caller over
    }
  }
  return removed;
}

/**
 * Clear the entire cache directory.
 */
function clearAll() {
  fs.rmSync(CACHE_ROOT, { recursive: true, force: true });
}

module.exports = { CACHE_ROOT, hashFilter, get, set, getOrCompute, invalidate, invalidatePrefix, clearAll };
