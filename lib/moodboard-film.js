'use strict';

/**
 * Mood board scroll films.
 *
 * filmSite  — opens a real page in headless Chrome, records it scrolling
 *   through four depths with its animations running, and saves a still at
 *   each depth. Wheel events drive the scroll so sites with their own scroll
 *   engine (Lenis, Locomotive, WebGL) move too.
 * filmTiles — films each URL and puts the result on a UI board as a
 *   motion tile (film + poster + waypoint stills), then cleans up.
 *
 * Needs `playwright-core` (optional dependency) and Google Chrome installed.
 */

var fs = require('fs');
var os = require('os');
var path = require('path');

var DEFAULTS = { width: 1280, height: 860, stops: 4, settleMs: 3000, holdMs: 1200 };

function loadPlaywright() {
  var tries = [function() { return require('playwright-core'); },
    function() { return require(require.resolve('playwright-core', { paths: [process.cwd()] })); }];
  for (var i = 0; i < tries.length; i++) {
    try { return tries[i](); } catch (e) { /* try next location */ }
  }
  throw new Error('Scroll films need playwright-core. Run: npm install playwright-core (Google Chrome must be installed).');
}

function launchChrome(chromium) {
  return chromium.launch({ channel: 'chrome', headless: true }).catch(function() {
    return chromium.launch({ headless: true });
  }).catch(function() {
    throw new Error('Could not start Chrome. Install Google Chrome, or run: npx playwright-core install chromium');
  });
}

function wait(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

// Wheel-scrolls `distance` px in small steps so the film shows real motion.
function wheelBy(page, distance) {
  var steps = Math.max(1, Math.round(distance / 60));
  var chain = Promise.resolve();
  for (var i = 0; i < steps; i++) {
    chain = chain.then(function() { return page.mouse.wheel(0, 60); }).then(function() { return wait(40); });
  }
  return chain;
}

async function filmSite(opts) {
  var given = opts || {};
  opts = Object.assign({}, DEFAULTS);
  Object.keys(given).forEach(function(k) { if (given[k] != null) opts[k] = given[k]; });
  if (!/^https?:\/\//i.test(String(opts.url || ''))) throw new Error('Film needs an http(s) url');
  var outDir = opts.outDir || fs.mkdtempSync(path.join(os.tmpdir(), 'analyzthis-film-'));
  var size = { width: opts.width, height: opts.height };
  var browser = await launchChrome(loadPlaywright().chromium);
  var context;
  try {
    context = await browser.newContext({ viewport: size, recordVideo: { dir: outDir, size: size } });
    var page = await context.newPage();
    await page.goto(opts.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await wait(opts.settleMs);
    await page.mouse.move(size.width / 2, size.height / 2);
    var docH = await page.evaluate(function() { return document.documentElement.scrollHeight; });
    // Virtual-scroll sites report no page height; still travel three screens.
    var travel = Math.max(docH - size.height, size.height * 3);
    var stills = [];
    for (var i = 0; i < opts.stops; i++) {
      if (i > 0) await wheelBy(page, Math.round(travel / opts.stops));
      await wait(opts.holdMs);
      var still = path.join(outDir, 'still-' + (i + 1) + '.png');
      await page.screenshot({ path: still });
      stills.push(still);
    }
    var video = page.video();
    await context.close();
    context = null;
    return { url: opts.url, video: await video.path(), stills: stills, dir: outDir };
  } finally {
    if (context) await context.close().catch(function() {});
    await browser.close().catch(function() {});
  }
}

async function filmTiles(opts) {
  opts = opts || {};
  var urls = (opts.urls || []).filter(Boolean);
  if (!opts.boardId || !urls.length) throw new Error('--board and at least one --url are required');
  var mb = require('./moodboard');
  var films = [];
  var failed = [];
  for (var i = 0; i < urls.length; i++) {
    try { films.push(await filmSite({ url: urls[i], stops: opts.stops })); }
    catch (e) { failed.push({ url: urls[i], reason: e.message }); }
  }
  var saved = null;
  try {
    if (films.length) {
      saved = mb.addTiles({
        project: opts.project, boardId: opts.boardId, workspaceDir: opts.workspaceDir,
        tiles: films.map(function(f) {
          return {
            page_url: f.url, section: opts.section || 'motion',
            element: opts.element || 'Scroll film — ' + mb.siteOf(f.url),
            video_path: f.video, stills: f.stills,
            steal: opts.steal, refuse: opts.refuse, peak: opts.peak,
          };
        }),
      });
    }
  } finally {
    films.forEach(function(f) { fs.rmSync(f.dir, { recursive: true, force: true }); });
  }
  return { saved: saved, failed: failed };
}

module.exports = { filmSite: filmSite, filmTiles: filmTiles, loadPlaywright: loadPlaywright };
