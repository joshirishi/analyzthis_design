'use strict';

/**
 * Mood board view (v3).
 *
 * renderBoardHtml — turns a UI element board into one self-contained HTML
 *   page: tiles grouped by section, real colour swatches, persona votes as
 *   advice, and the user's keep / maybe / reject on every tile.
 * serveBoard — serves that page on 127.0.0.1 so the user's clicks are saved
 *   straight into board.json. Only same-host requests carrying the per-run
 *   token can write.
 */

var fs = require('fs');
var path = require('path');
var http = require('http');
var crypto = require('crypto');

var SECTION_LABELS = {
  first_screen: 'First screen',
  typography: 'Typography',
  color: 'Colour and contrast',
  components: 'Components and density',
  imagery: 'Imagery and icons',
  motion: 'Motion and interaction',
};
var SECTION_TARGETS = {
  first_screen: '3–5', typography: '3–4', color: '3–4', components: '6–8', imagery: '2–4', motion: '1–3',
};
var PERSONA_NAMES = { arjun: 'Arjun', meera: 'Meera', priya: 'Priya', noor: 'Noor', zara: 'Zara' };
var ASSET_RE = /^[a-f0-9]{6,32}(-[1-4])?\.(png|jpe?g|webp|gif|webm|mp4)$/i;
var MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', webm: 'video/webm', mp4: 'video/mp4' };

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function safeHref(url) {
  return /^https?:\/\//i.test(String(url || '')) ? esc(url) : '#';
}

function imageSrc(tile) {
  if (tile.image && ASSET_RE.test(path.basename(tile.image))) return 'assets/' + esc(path.basename(tile.image));
  if (tile.image_url && /^https?:\/\//i.test(tile.image_url)) return esc(tile.image_url);
  return '';
}

function assetSrc(rel) {
  return rel && ASSET_RE.test(path.basename(rel)) ? 'assets/' + esc(path.basename(rel)) : '';
}

// Film tiles: looping muted video with the poster still, then the waypoint strip.
function renderShot(tile, src) {
  var alt = esc(tile.element + ' on ' + tile.site);
  var video = assetSrc(tile.video);
  if (!video) {
    return src ? '    <img src="' + src + '" alt="' + alt + '" loading="lazy" referrerpolicy="no-referrer">' : '    <div class="noimg">No image</div>';
  }
  var stills = (tile.stills || []).map(assetSrc).filter(Boolean);
  return '    <video class="film" src="' + video + '"' + (src ? ' poster="' + src + '"' : '') +
    ' muted loop autoplay playsinline preload="metadata" aria-label="' + alt + ' (scroll film)"></video>' +
    (stills.length ? '\n    <div class="stills">' + stills.map(function(s, i) {
      return '<img src="' + s + '" alt="Depth ' + (i + 1) + '" loading="lazy">';
    }).join('') + '</div>' : '');
}

function statusOf(tile) {
  if (tile.user && tile.user.decision) return { status: tile.user.decision, by: 'user' };
  var keep = 0, skip = 0;
  Object.keys(tile.votes || {}).forEach(function(p) {
    if (tile.votes[p].vote === 'keep') keep++; else if (tile.votes[p].vote === 'skip') skip++;
  });
  if (!keep && !skip) return { status: 'undecided', by: 'none' };
  return { status: keep >= skip ? 'suggested_keep' : 'suggested_skip', by: 'personas' };
}

function renderTokens(tokens) {
  tokens = tokens || {};
  var parts = [];
  if (tokens.colors && tokens.colors.length) {
    parts.push('<div class="swatches">' + tokens.colors.map(function(c) {
      return '<span class="sw" style="background:' + esc(c) + '" title="' + esc(c) + '"></span>';
    }).join('') + '</div>');
  }
  var facts = [];
  if (tokens.fonts && tokens.fonts.length) facts.push(esc(tokens.fonts.join(', ')));
  if (tokens.font_size) facts.push(esc(tokens.font_size));
  if (tokens.radius && tokens.radius !== '0px') facts.push('r ' + esc(tokens.radius));
  if (tokens.spacing && tokens.spacing !== '0px') facts.push('pad ' + esc(tokens.spacing));
  if (facts.length) parts.push('<div class="facts">' + facts.join(' · ') + '</div>');
  return parts.length ? '<div class="tokens">' + parts.join('') + '</div>' : '';
}

function renderVotes(tile) {
  var keys = Object.keys(tile.votes || {});
  if (!keys.length) return '';
  return '<div class="votes"><span class="votes-label">Team advice</span>' + keys.map(function(p) {
    var v = tile.votes[p];
    return '<span class="vote vote-' + esc(v.vote) + '" title="' + esc(v.because) + '">' +
      esc(PERSONA_NAMES[p] || p) + ' ' + (v.vote === 'keep' ? 'keep' : 'skip') + '</span>';
  }).join('') + '</div>';
}

function renderTile(tile, interactive) {
  var st = statusOf(tile);
  var src = imageSrc(tile);
  var decision = tile.user ? tile.user.decision : '';
  var buttons = ['keep', 'maybe', 'reject'].map(function(d) {
    return '<button type="button" class="pick pick-' + d + (decision === d ? ' on' : '') + '" data-tile="' + esc(tile.id) +
      '" data-decision="' + d + '"' + (interactive ? '' : ' disabled') + '>' + d.charAt(0).toUpperCase() + d.slice(1) + '</button>';
  }).join('');
  return [
    '<article class="tile st-' + esc(st.status) + '" id="t-' + esc(tile.id) + '">',
    '  <figure class="shot">',
    renderShot(tile, src),
    '    <span class="num">' + esc(tile.n) + '</span>',
    tile.video ? '    <span class="concept film-tag">Film</span>' : '',
    tile.concept ? '    <span class="concept">Concept</span>' : '',
    '  </figure>',
    '  <div class="body">',
    '    <h3>' + esc(tile.element) + '</h3>',
    '    <a class="src" href="' + safeHref(tile.page_url) + '" target="_blank" rel="noopener noreferrer">' + esc(tile.site || 'source') + ' ↗</a>',
    '    <dl class="notes">',
    tile.steal ? '      <div><dt>Steal</dt><dd>' + esc(tile.steal) + '</dd></div>' : '',
    tile.refuse ? '      <div><dt>Refuse</dt><dd>' + esc(tile.refuse) + '</dd></div>' : '',
    tile.peak ? '      <div><dt>Peak</dt><dd>' + esc(tile.peak) + '</dd></div>' : '',
    '    </dl>',
    renderTokens(tile.tokens),
    renderVotes(tile),
    '    <div class="choose">',
    '      <div class="picks" role="group" aria-label="Your choice for tile ' + esc(tile.n) + '">' + buttons + '</div>',
    '      <input class="note" data-tile="' + esc(tile.id) + '" placeholder="Why? (optional)" maxlength="500" value="' + esc(tile.user ? tile.user.note : '') + '"' + (interactive ? '' : ' disabled') + '>',
    '    </div>',
    '  </div>',
    '</article>',
  ].join('\n');
}

function renderDirection(board) {
  var kept = board.tiles.filter(function(t) { return t.user && t.user.decision === 'keep'; });
  if (!kept.length) return '';
  var palette = [];
  var fonts = [];
  kept.forEach(function(t) {
    ((t.tokens && t.tokens.colors) || []).forEach(function(c) { if (palette.indexOf(c.toLowerCase()) === -1) palette.push(c.toLowerCase()); });
    ((t.tokens && t.tokens.fonts) || []).forEach(function(f) { if (fonts.indexOf(f) === -1) fonts.push(f); });
  });
  var overruled = kept.filter(function(t) {
    return Object.keys(t.votes || {}).some(function(p) { return t.votes[p].vote === 'skip'; });
  }).length;
  return [
    '<section class="direction" aria-label="Your direction so far">',
    '  <h2>Your direction so far</h2>',
    '  <p>' + kept.length + ' kept: ' + kept.map(function(t) { return '#' + esc(t.n) + ' ' + esc(t.element); }).join(', ') + '</p>',
    palette.length ? '  <div class="palette">' + palette.slice(0, 10).map(function(c) {
      return '<span class="chip"><span class="sw lg" style="background:' + esc(c) + '"></span>' + esc(c) + '</span>';
    }).join('') + '</div>' : '',
    fonts.length ? '  <p class="fonts">' + fonts.slice(0, 4).map(function(f) { return '<span style="font-family:' + esc(JSON.stringify(f)) + ', inherit">' + esc(f) + '</span>'; }).join(' / ') + '</p>' : '',
    overruled ? '  <p class="overruled">You kept ' + overruled + ' tile' + (overruled === 1 ? '' : 's') + ' the team advised skipping. Your call stands.</p>' : '',
    '</section>',
  ].join('\n');
}

function renderBoardHtml(board, opts) {
  opts = opts || {};
  var interactive = !!opts.interactive;
  var brief = board.brief || { job: board.task, adjectives: [], not_this: '', sections: Object.keys(SECTION_LABELS) };
  var tiles = board.tiles || [];
  var counts = { keep: 0, maybe: 0, reject: 0, undecided: 0 };
  tiles.forEach(function(t) {
    var d = t.user && t.user.decision;
    if (d && counts[d] != null) counts[d]++; else counts.undecided++;
  });
  var sites = {};
  tiles.forEach(function(t) { if (t.site) sites[t.site] = true; });
  var scout = board.scout || {};
  var sectionIds = brief.sections && brief.sections.length ? brief.sections.slice() : Object.keys(SECTION_LABELS);
  tiles.forEach(function(t) { if (sectionIds.indexOf(t.section) === -1) sectionIds.push(t.section); });

  var sectionsHtml = sectionIds.map(function(sid) {
    var list = tiles.filter(function(t) { return t.section === sid; });
    return [
      '<section class="sec" id="sec-' + esc(sid) + '">',
      '  <header><h2>' + esc(SECTION_LABELS[sid] || sid) + '</h2><span class="target">' + list.length + ' of ' + esc(SECTION_TARGETS[sid] || '—') + '</span></header>',
      list.length ? '  <div class="grid">' + list.map(function(t) { return renderTile(t, interactive); }).join('\n') + '</div>'
        : '  <p class="thin">Zara has not found anything for this section yet.</p>',
      '</section>',
    ].join('\n');
  }).join('\n');

  var juryLine = scout.jury_verdict
    ? '<p class="jury">Team advice: <strong>' + esc(scout.jury_verdict) + '</strong>' + (scout.last_veto ? ' — ' + esc(scout.last_veto) : '') + '</p>'
    : '';

  return [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    interactive ? '<meta name="board-token" content="' + esc(opts.token || '') + '">' : '',
    '<title>Mood board — ' + esc(brief.job || board.task) + '</title>',
    '<style>' + CSS + '</style>',
    '</head><body class="' + (interactive ? 'live' : 'static') + '">',
    '<header class="top">',
    '  <div class="brief">',
    '    <p class="eyebrow">Mood board · round ' + esc(scout.round || 1) + ' · ' + tiles.length + ' tiles from ' + Object.keys(sites).length + ' sites</p>',
    '    <h1>' + esc(brief.job || board.task) + '</h1>',
    brief.adjectives && brief.adjectives.length ? '    <p class="adj">' + brief.adjectives.map(esc).join(' <span>·</span> ') + (brief.not_this ? ' <em>Not this: ' + esc(brief.not_this) + '</em>' : '') + '</p>' : '',
    juryLine,
    '  </div>',
    '  <div class="tally" aria-live="polite">',
    '    <span class="t-keep">' + counts.keep + ' kept</span><span class="t-maybe">' + counts.maybe + ' maybe</span><span class="t-reject">' + counts.reject + ' rejected</span><span>' + counts.undecided + ' open</span>',
    '  </div>',
    '</header>',
    '<p class="rule">Your choice overrides every persona. Team votes are advice. Images are third-party references for direction only and are not licensed for reuse.</p>',
    interactive ? '' : '<p class="banner">Read-only snapshot. To choose, run <code>npx analyzthis_design moodboard show --board ' + esc(board.board_id) + '</code></p>',
    scout.status === 'done' ? '<p class="banner done">Direction locked. Every persona reads it before designing.</p>' : '',
    renderDirection(board),
    '<main>' + sectionsHtml + '</main>',
    '<footer class="actions">',
    '  <textarea id="roundNote" maxlength="500" placeholder="Tell Zara what to look for next, or why you are locking this" ' + (interactive ? '' : 'disabled') + '></textarea>',
    '  <div class="btns">',
    '    <button type="button" id="rescout" ' + (interactive ? '' : 'disabled') + '>Send Zara back for more</button>',
    '    <button type="button" id="lock" class="primary" ' + (interactive && counts.keep ? '' : 'disabled') + '>Lock this direction</button>',
    '  </div>',
    '  <p class="msg" id="msg" role="status"></p>',
    '</footer>',
    '<script>' + MOTION_JS + '</script>',
    interactive ? '<script>' + CLIENT_JS + '</script>' : '',
    '</body></html>',
  ].join('\n');
}

var CSS = [
  ':root{--paper:#f3efe6;--card:#fffdf8;--ink:#1d1c1a;--muted:#6b665c;--line:#ddd5c4;--keep:#2e6a4e;--maybe:#a87b1f;--reject:#a2412d;--serif:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;--sans:ui-sans-serif,-apple-system,"Segoe UI",system-ui,sans-serif;--mono:ui-monospace,"SF Mono",Menlo,monospace}',
  '*{box-sizing:border-box}html{scroll-padding-bottom:140px}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.5 var(--sans);padding:0 clamp(16px,4vw,56px) 160px}',
  '.top{display:flex;gap:32px;justify-content:space-between;align-items:flex-end;padding:48px 0 20px;border-bottom:1px solid var(--ink)}',
  '.eyebrow{margin:0 0 8px;font:600 11px/1 var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}',
  'h1{margin:0;font:400 clamp(30px,4.4vw,56px)/1.05 var(--serif);letter-spacing:-.01em;max-width:22ch}',
  '.adj{margin:14px 0 0;font:italic 18px/1.4 var(--serif)}.adj span{color:var(--muted);font-style:normal}.adj em{display:block;font-style:normal;font-size:14px;color:var(--reject);font-family:var(--sans);margin-top:4px}',
  '.jury{margin:10px 0 0;font-size:13px;color:var(--muted);max-width:70ch}',
  '.tally{display:flex;gap:16px;font:600 12px/1 var(--mono);text-transform:uppercase;letter-spacing:.06em;white-space:nowrap}.t-keep{color:var(--keep)}.t-maybe{color:var(--maybe)}.t-reject{color:var(--reject)}',
  '.rule{margin:12px 0 0;font-size:12px;color:var(--muted)}',
  '.banner{margin:16px 0 0;padding:10px 14px;border:1px solid var(--line);background:var(--card);font-size:13px}.banner.done{border-color:var(--keep);color:var(--keep)}code{font-family:var(--mono);font-size:12px}',
  '.direction{margin:28px 0 0;padding:20px 24px;background:var(--ink);color:var(--paper)}.direction h2{margin:0 0 6px;font:400 22px/1.2 var(--serif)}.direction p{margin:6px 0 0;font-size:13px}',
  '.palette{display:flex;flex-wrap:wrap;gap:10px;margin-top:12px}.chip{display:inline-flex;align-items:center;gap:6px;font:12px var(--mono)}.fonts span{font-size:18px}.overruled{color:#e9c98a}',
  '.sec{margin-top:48px}.sec>header{display:flex;align-items:baseline;justify-content:space-between;border-bottom:1px solid var(--line);padding-bottom:8px;margin-bottom:18px}',
  '.sec h2{margin:0;font:400 26px/1.1 var(--serif)}.target{font:12px var(--mono);color:var(--muted)}.thin{color:var(--muted);font-style:italic}',
  '.grid{columns:300px;column-gap:18px}',
  '.tile{break-inside:avoid;margin:0 0 18px;background:var(--card);border:1px solid var(--line);transition:opacity .2s ease-out,border-color .2s ease-out}',
  '.tile.st-keep{border:2px solid var(--keep)}.tile.st-maybe{border:2px dashed var(--maybe)}.tile.st-reject{opacity:.42}.tile.st-reject img{filter:grayscale(1)}',
  '.shot{position:relative;margin:0;background:repeating-linear-gradient(45deg,#ece6da 0 6px,#f3eee4 6px 12px);border-bottom:1px solid var(--line)}',
  '.shot img,.shot video{display:block;width:100%;height:auto}.stills{display:grid;grid-template-columns:repeat(4,1fr);gap:2px;padding:2px;background:var(--ink)}.concept.film-tag{right:auto;left:44px}.noimg{padding:48px;text-align:center;color:var(--muted)}',
  '.num{position:absolute;top:8px;left:8px;background:var(--ink);color:var(--paper);font:600 11px/1 var(--mono);padding:5px 7px}',
  '.concept{position:absolute;top:8px;right:8px;background:var(--card);border:1px solid var(--line);font:600 10px/1 var(--mono);padding:4px 6px;text-transform:uppercase}',
  '.body{padding:14px 14px 12px}.body h3{margin:0;font:600 15px/1.3 var(--sans)}.src{display:inline-block;margin-top:2px;font:12px var(--mono);color:var(--muted);text-decoration:none}.src:hover{color:var(--ink);text-decoration:underline}',
  '.notes{margin:10px 0 0}.notes div{display:grid;grid-template-columns:52px 1fr;gap:6px;margin-top:4px}.notes dt{font:600 10px/1.9 var(--mono);text-transform:uppercase;color:var(--muted)}.notes dd{margin:0;font-size:13px}',
  '.tokens{margin-top:10px;padding-top:10px;border-top:1px dotted var(--line)}.swatches{display:flex;gap:4px}.sw{display:inline-block;width:18px;height:18px;border:1px solid rgba(0,0,0,.15)}.sw.lg{width:22px;height:22px}',
  '.facts{margin-top:6px;font:11px var(--mono);color:var(--muted)}',
  '.votes{display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin-top:10px}.votes-label{font:600 10px var(--mono);text-transform:uppercase;color:var(--muted);margin-right:2px}',
  '.vote{font-size:11px;padding:2px 6px;border:1px solid var(--line);cursor:help}.vote-keep{color:var(--keep)}.vote-skip{color:var(--reject)}',
  '.choose{margin-top:12px}.picks{display:grid;grid-template-columns:repeat(3,1fr);border:1px solid var(--ink)}',
  '.pick{appearance:none;border:0;border-right:1px solid var(--ink);background:transparent;padding:8px 0;font:600 12px var(--sans);cursor:pointer;color:var(--ink);transition:background .15s ease-out,color .15s ease-out}.pick:last-child{border-right:0}',
  '.pick:hover:not(:disabled){background:#efe8d9}.pick:focus-visible,.note:focus-visible,button:focus-visible,textarea:focus-visible{outline:2px solid var(--ink);outline-offset:2px}',
  '.pick-keep.on{background:var(--keep);color:#fff}.pick-maybe.on{background:var(--maybe);color:#fff}.pick-reject.on{background:var(--reject);color:#fff}.pick:disabled{cursor:not-allowed;opacity:.6}',
  '.note{width:100%;margin-top:6px;border:0;border-bottom:1px solid var(--line);background:transparent;padding:6px 0;font:13px var(--sans);color:var(--ink)}',
  '.actions{position:fixed;left:0;right:0;bottom:0;display:grid;grid-template-columns:1fr auto;gap:12px;align-items:center;padding:14px clamp(16px,4vw,56px);background:var(--card);border-top:1px solid var(--ink)}',
  '.actions textarea{height:44px;resize:none;border:1px solid var(--line);background:var(--paper);padding:10px;font:13px var(--sans)}.btns{display:flex;gap:8px}',
  '.btns button{border:1px solid var(--ink);background:transparent;padding:12px 16px;font:600 13px var(--sans);cursor:pointer}.btns .primary{background:var(--ink);color:var(--paper)}.btns button:disabled{opacity:.45;cursor:not-allowed}',
  '.msg{grid-column:1/-1;margin:0;font-size:12px;color:var(--muted);min-height:1em}',
  '@media (max-width:720px){.top{flex-direction:column;align-items:flex-start}.actions{grid-template-columns:1fr}}',
  '@media (prefers-reduced-motion:reduce){*{transition:none!important}}',
].join('\n');

// Reduced-motion users get still posters; click a film to play or pause it.
var MOTION_JS = [
  '(function(){var still=window.matchMedia&&matchMedia("(prefers-reduced-motion: reduce)").matches;',
  'document.querySelectorAll("video.film").forEach(function(v){if(still){v.removeAttribute("autoplay");v.pause();}',
  'v.addEventListener("click",function(){v.paused?v.play():v.pause();});});})();',
].join('');

// Posts each click to the local server, then reloads in place so the page
// always shows what board.json now says.
var CLIENT_JS = [
  '(function(){',
  'var token=document.querySelector("meta[name=board-token]").content;',
  'var msg=document.getElementById("msg");',
  'var y=sessionStorage.getItem("mb-scroll");if(y){window.scrollTo(0,+y);sessionStorage.removeItem("mb-scroll");}',
  'function post(url,body){msg.textContent="Saving…";return fetch(url,{method:"POST",headers:{"Content-Type":"application/json","X-Board-Token":token},body:JSON.stringify(body)})',
  '.then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||"Save failed");return j;});})',
  '.then(function(j){sessionStorage.setItem("mb-scroll",String(window.scrollY));location.reload();return j;})',
  '.catch(function(e){msg.textContent=e.message;});}',
  'function noteFor(id){var el=document.querySelector(".note[data-tile=\\""+id+"\\"]");return el?el.value:"";}',
  'document.addEventListener("click",function(e){var b=e.target.closest(".pick");if(!b)return;',
  'var on=b.classList.contains("on");post("/api/decision",{tile:b.dataset.tile,decision:on?"clear":b.dataset.decision,note:noteFor(b.dataset.tile)});});',
  'document.querySelectorAll(".note").forEach(function(n){n.addEventListener("keydown",function(e){if(e.key!=="Enter")return;',
  'var on=document.querySelector("#t-"+n.dataset.tile+" .pick.on");if(!on){msg.textContent="Pick keep, maybe or reject first.";return;}',
  'post("/api/decision",{tile:n.dataset.tile,decision:on.dataset.decision,note:n.value});});});',
  'var note=document.getElementById("roundNote");',
  'document.getElementById("rescout").addEventListener("click",function(){post("/api/rescout",{note:note.value});});',
  'document.getElementById("lock").addEventListener("click",function(){post("/api/lock",{note:note.value});});',
  '})();',
].join('');

// ─── Local server ───────────────────────────────────────────────────────────

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function readBody(req, limit) {
  return new Promise(function(resolve, reject) {
    var size = 0;
    var chunks = [];
    req.on('data', function(c) {
      size += c.length;
      if (size > limit) { reject(new Error('Request too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', function() {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch (e) { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function serveBoard(opts) {
  opts = opts || {};
  var mb = require('./moodboard');
  var board = mb.loadUiBoard({ project: opts.project, boardId: opts.boardId });
  var projectId = board.project_id;
  var boardId = board.board_id;
  var bDir = mb.boardDir(projectId, boardId);
  var token = crypto.randomBytes(16).toString('hex');
  var host = '127.0.0.1';
  var ref = { project: projectId, boardId: boardId, workspaceDir: opts.workspaceDir };

  var server = http.createServer(function(req, res) {
    var port = server.address().port;
    // Blocks DNS-rebinding: only our own host names may talk to this server.
    var allowed = [host + ':' + port, 'localhost:' + port];
    if (allowed.indexOf(String(req.headers.host || '')) === -1) return sendJson(res, 403, { error: 'Forbidden host' });
    var url = new URL(req.url, 'http://' + host + ':' + port);

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      var html;
      try { html = renderBoardHtml(mb.loadUiBoard(ref), { interactive: true, token: token }); }
      catch (e) { return sendJson(res, 500, { error: e.message }); }
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'none'; img-src 'self' https: http: data:; media-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; font-src 'self'",
        'Referrer-Policy': 'no-referrer',
      });
      return res.end(html);
    }

    if (req.method === 'GET' && url.pathname.indexOf('/assets/') === 0) {
      var name = url.pathname.slice('/assets/'.length);
      if (!ASSET_RE.test(name)) return sendJson(res, 404, { error: 'Not found' });
      var file = path.join(bDir, 'assets', name);
      if (!fs.existsSync(file)) return sendJson(res, 404, { error: 'Not found' });
      var type = MIME[path.extname(name).toLowerCase().slice(1)];
      var total = fs.statSync(file).size;
      // Byte ranges let browsers (Safari especially) stream and loop films.
      var range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
      if (range && (range[1] || range[2])) {
        var start = range[1] ? Number(range[1]) : Math.max(0, total - Number(range[2]));
        var end = range[1] && range[2] ? Math.min(Number(range[2]), total - 1) : total - 1;
        if (start > end || start >= total) {
          res.writeHead(416, { 'Content-Range': 'bytes */' + total });
          return res.end();
        }
        res.writeHead(206, { 'Content-Type': type, 'Content-Range': 'bytes ' + start + '-' + end + '/' + total, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
        return fs.createReadStream(file, { start: start, end: end }).pipe(res);
      }
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': total, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
      return fs.createReadStream(file).pipe(res);
    }

    if (req.method === 'POST' && url.pathname.indexOf('/api/') === 0) {
      if (req.headers['x-board-token'] !== token) return sendJson(res, 403, { error: 'Missing or wrong board token' });
      readBody(req, 16 * 1024).then(function(body) {
        var out;
        if (url.pathname === '/api/decision') {
          out = mb.recordUserDecision({ project: projectId, boardId: boardId, workspaceDir: opts.workspaceDir, tile: String(body.tile || ''), decision: body.decision, note: body.note });
        } else if (url.pathname === '/api/rescout') {
          out = mb.requestRescout({ project: projectId, boardId: boardId, workspaceDir: opts.workspaceDir, note: body.note });
        } else if (url.pathname === '/api/lock') {
          out = mb.lockDirection({ project: projectId, boardId: boardId, workspaceDir: opts.workspaceDir, note: body.note });
        } else {
          return sendJson(res, 404, { error: 'Not found' });
        }
        if (opts.onChange) opts.onChange(url.pathname.slice(5), out.board);
        sendJson(res, 200, { ok: true, status: out.board.scout && out.board.scout.status });
      }).catch(function(e) {
        sendJson(res, 400, { error: e.message });
      });
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  });

  return new Promise(function(resolve, reject) {
    function listen(port) {
      server.once('error', function(err) {
        if (err.code === 'EADDRINUSE' && port !== 0) return listen(0);
        reject(err);
      });
      server.listen(port, host, function() {
        resolve({ server: server, token: token, url: 'http://' + host + ':' + server.address().port + '/' });
      });
    }
    listen(opts.port != null ? Number(opts.port) : 4317);
  });
}

module.exports = {
  renderBoardHtml: renderBoardHtml,
  serveBoard: serveBoard,
  esc: esc,
};
