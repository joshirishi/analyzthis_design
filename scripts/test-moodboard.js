#!/usr/bin/env node
'use strict';

// Checks the visual mood board: tiles need a source, the user's choice beats
// every persona vote, rejected tiles stay out, and the local board server only
// accepts writes from its own page.
var assert = require('assert');
var fs = require('fs');
var os = require('os');
var path = require('path');
var http = require('http');
var mb = require('../lib/moodboard');
var view = require('../lib/moodboard-view');
var session = require('../lib/session');
var mcp = require('../lib/mcp-server');

var project = 'moodboard-test-' + Date.now();
var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-'));
var png = path.join(tmp, 'crop.png');
// Smallest valid PNG (1x1), enough to prove the crop is copied.
fs.writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64'));
session.init({ project: project });

function request(port, opts, body) {
  return new Promise(function(resolve, reject) {
    var req = http.request({ host: '127.0.0.1', port: port, path: opts.path, method: opts.method || 'GET', headers: opts.headers || {} }, function(res) {
      var chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() { resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }); });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

(async function main() {
  // 1. Visual board is the default kind and carries a brief.
  var created = await mb.buildMoodBoard({
    project: project, task: 'Invoice approval table', workspaceDir: tmp,
    brief: { adjectives: ['calm', 'precise', 'trusted'], not_this: 'AI purple hero', sections: ['components', 'typography', 'nope'] },
  });
  var id = created.board.board_id;
  assert.strictEqual(created.board.kind, 'ui');
  assert.deepStrictEqual(created.board.brief.sections, ['components', 'typography'], 'unknown sections are dropped');
  assert.ok(created.board.scout.brief.indexOf('AI purple hero') !== -1);
  var ref = { project: project, boardId: id, workspaceDir: tmp };

  // 2. Tiles without a real source or image are refused.
  var added = mb.addTiles(Object.assign({ tiles: [
    { element: 'No source', image_path: png },
    { page_url: 'https://linear.app/pricing', element: 'No image' },
    { page_url: 'javascript:alert(1)', element: 'Bad url', image_path: png },
    { page_url: 'https://linear.app/pricing', element: 'Pricing card', section: 'components', image_path: png,
      tokens: { colors: ['#111111', 'red;background:url(x)'], fonts: ['Inter'] }, steal: 'one quiet CTA' },
    { page_url: 'https://stripe.com/invoicing', element: '<script>alert(1)</script> table', section: 'components', image_url: 'https://example.com/a.png' },
  ] }, ref));
  assert.strictEqual(added.added.length, 2);
  assert.strictEqual(added.skipped.length, 3);
  var card = added.added[0];
  assert.ok(fs.existsSync(path.join(mb.boardDir(project, id), card.image)), 'local crop copied into assets');
  assert.deepStrictEqual(card.tokens.colors, ['#111111'], 'unsafe colour strings are dropped');
  assert.strictEqual(card.site, 'linear.app');

  // 3. Persona votes are advice. Zara cannot vote; the board waits for the user.
  var voted = mb.recordPersonaVotes(Object.assign({ verdict: 'REVISE', summary: 'too airy', votes: [
    { tile: 1, persona: 'arjun', vote: 'skip', because: 'too airy for a daily table' },
    { tile: 1, persona: 'noor', vote: 'skip', because: 'no hierarchy' },
    { tile: 1, persona: 'zara', vote: 'keep', because: 'mine' },
  ] }, ref));
  assert.strictEqual(voted.ignored.length, 1, 'zara vote ignored');
  assert.strictEqual(voted.board.scout.status, 'awaiting_user', 'jury never closes or re-scouts on its own');
  assert.strictEqual(mb.tileStatus(voted.board.tiles[0]).status, 'suggested_skip');

  // 4. The user keeps the tile the team wanted to skip. The user wins.
  var kept = mb.recordUserDecision(Object.assign({ tile: '1', decision: 'keep', note: 'this density is right' }, ref));
  assert.deepStrictEqual(mb.tileStatus(kept.board.tiles[0]), { status: 'keep', by: 'user' });
  assert.deepStrictEqual(mb.computeDirection(kept.board).overruled_personas_on, [1]);

  // 5. Later persona votes cannot undo a user decision.
  var revoted = mb.recordPersonaVotes(Object.assign({ votes: [{ tile: 1, persona: 'priya', vote: 'skip', because: 'hard to build' }] }, ref));
  assert.strictEqual(mb.tileStatus(revoted.board.tiles[0]).status, 'keep');

  // 6. A rejected element can never be re-added, even with a different url query.
  mb.recordUserDecision(Object.assign({ tile: 2, decision: 'reject', note: 'too dark' }, ref));
  var again = mb.addTiles(Object.assign({ tile: { page_url: 'https://stripe.com/invoicing?ref=x', element: '<script>alert(1)</script> table', image_path: png } }, ref));
  assert.strictEqual(again.added.length, 0);
  assert.strictEqual(again.skipped[0].reason, 'user rejected this before');
  assert.throws(function() { mb.recordUserDecision(Object.assign({ tile: 1, decision: 'ship-it' }, ref)); });

  // 7. Re-scout carries the user's words and rejections to Zara first.
  var rescout = mb.requestRescout(Object.assign({ note: 'more dense tables like #1' }, ref));
  assert.strictEqual(rescout.board.scout.round, 2);
  assert.ok(rescout.board.scout.brief.indexOf('USER DECISIONS') !== -1);
  assert.ok(rescout.board.scout.brief.indexOf('more dense tables like #1') !== -1);
  assert.ok(rescout.board.scout.brief.indexOf('too dark') !== -1);

  // 8. The HTML escapes scraped text and never runs it.
  var html = view.renderBoardHtml(mb.loadUiBoard(ref), { interactive: false });
  assert.ok(html.indexOf('<script>alert(1)</script>') === -1, 'element names are escaped');
  assert.ok(html.indexOf('Your choice overrides every persona') !== -1);
  assert.ok(fs.existsSync(path.join(mb.boardDir(project, id), 'index.html')), 'static snapshot written');

  // 9. Local server: needs the right host and token to write.
  var live = await view.serveBoard({ project: project, boardId: id, port: 0, workspaceDir: tmp });
  var port = live.server.address().port;
  var page = await request(port, { path: '/' , headers: { host: '127.0.0.1:' + port } });
  assert.strictEqual(page.status, 200);
  assert.ok(page.body.indexOf(live.token) !== -1);
  var asset = await request(port, { path: '/' + card.image, headers: { host: '127.0.0.1:' + port } });
  assert.strictEqual(asset.status, 200);
  var traversal = await request(port, { path: '/assets/..%2Fboard.json', headers: { host: '127.0.0.1:' + port } });
  assert.strictEqual(traversal.status, 404);
  var rebind = await request(port, { path: '/', headers: { host: 'evil.example:' + port } });
  assert.strictEqual(rebind.status, 403);
  var body = JSON.stringify({ tile: card.id, decision: 'maybe' });
  var noToken = await request(port, { path: '/api/decision', method: 'POST', headers: { host: '127.0.0.1:' + port, 'content-type': 'application/json' } }, body);
  assert.strictEqual(noToken.status, 403);
  var ok = await request(port, { path: '/api/decision', method: 'POST', headers: { host: '127.0.0.1:' + port, 'content-type': 'application/json', 'x-board-token': live.token } }, body);
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(mb.loadUiBoard(ref).tiles[0].user.decision, 'maybe');
  await request(port, { path: '/api/decision', method: 'POST', headers: { host: '127.0.0.1:' + port, 'x-board-token': live.token } }, JSON.stringify({ tile: card.id, decision: 'keep' }));
  live.server.close();

  // 10. Locking saves the user's direction for every persona.
  var locked = mb.lockDirection(Object.assign({ note: 'go dense' }, ref));
  assert.strictEqual(locked.board.scout.status, 'done');
  var dd = session.show({ project: project }).design_direction;
  assert.strictEqual(dd.locked_by, 'user');
  assert.strictEqual(dd.kept[0].element, 'Pricing card');
  assert.strictEqual(dd.rejected.length, 1);
  assert.ok(dd.palette.indexOf('#111111') !== -1);

  // 11. Cannot lock with nothing kept.
  var empty = await mb.buildMoodBoard({ project: project, task: 'Empty', workspaceDir: tmp });
  assert.throws(function() { mb.lockDirection({ project: project, boardId: empty.board.board_id, workspaceDir: tmp }); }, /Keep at least one/);

  // 12. Old boards with `frames` become tiles.
  var oldDir = mb.boardDir(project, 'oldboard01');
  fs.mkdirSync(oldDir, { recursive: true });
  fs.writeFileSync(path.join(oldDir, 'board.json'), JSON.stringify({
    board_id: 'oldboard01', project_id: project, kind: 'ui', task: 'Old', references: [],
    frames: [{ id: 'f1', url: 'https://dribbble.com/shots/1', title: 'Dense table', steal: 's', refuse: 'r', peak: 'p' }],
    scout: { round: 1, status: 'awaiting_jury' },
  }));
  var migrated = mb.loadUiBoard({ project: project, boardId: 'oldboard01' });
  assert.strictEqual(migrated.tiles.length, 1);
  assert.strictEqual(migrated.tiles[0].element, 'Dense table');
  assert.strictEqual(migrated.frames, undefined);

  // 13. The MCP create call now waits for the board (it used to return before it existed).
  var cwd = process.cwd();
  process.chdir(tmp);
  try {
    var mcpResult = await mcp.handleToolCall('analyzthis_mood_board', { task: 'Settings page' });
    assert.ok(mcpResult.board_id, 'MCP create returns a real board id');
    assert.ok(mcpResult.prompt.indexOf('Zara') !== -1);
  } finally {
    process.chdir(cwd);
  }

  // 14. Scroll films: real WebM is kept with its stills; a renamed text file is refused;
  //     the board plays it and the server streams byte ranges.
  var filmBoard = await mb.buildMoodBoard({ project: project, task: 'Studio site', workspaceDir: tmp });
  var fref = { project: project, boardId: filmBoard.board.board_id, workspaceDir: tmp };
  var webm = path.join(tmp, 'film.webm');
  fs.writeFileSync(webm, Buffer.concat([Buffer.from('1a45dfa3', 'hex'), Buffer.alloc(2000, 7)]));
  var fake = path.join(tmp, 'fake.webm');
  fs.writeFileSync(fake, 'not a video');
  var filmed = mb.addTiles(Object.assign({ tiles: [
    { page_url: 'https://osmo.supply', element: 'Scroll film', section: 'motion', video_path: webm, stills: [png, png] },
    { page_url: 'https://obys.agency', element: 'Fake film', section: 'motion', video_path: fake, stills: [png] },
  ] }, fref));
  assert.strictEqual(filmed.added.length, 1, 'only the real WebM is accepted');
  assert.ok(/WebM or MP4/.test(filmed.skipped[0].reason));
  var film = filmed.added[0];
  assert.ok(/\.webm$/.test(film.video) && film.stills.length === 2 && film.image, 'film keeps video, stills and a poster');
  var filmHtml = view.renderBoardHtml(mb.loadUiBoard(fref), { interactive: false });
  assert.ok(filmHtml.indexOf('<video class="film" src="assets/' + film.id + '.webm"') !== -1);
  var flive = await view.serveBoard({ project: project, boardId: fref.boardId, port: 0, workspaceDir: tmp });
  var fport = flive.server.address().port;
  var part = await request(fport, { path: '/' + film.video, headers: { host: '127.0.0.1:' + fport, range: 'bytes=0-99' } });
  assert.strictEqual(part.status, 206);
  var bad = await request(fport, { path: '/' + film.video, headers: { host: '127.0.0.1:' + fport, range: 'bytes=999999-' } });
  assert.strictEqual(bad.status, 416);
  flive.server.close();

  // 15. Headless crop refuses bad input before starting Chrome.
  var capture = require('../lib/moodboard-film');
  await assert.rejects(capture.cropTiles({ boardId: fref.boardId, crops: [{ page_url: 'javascript:alert(1)', selector: 'h1' }] }), /required/);
  await assert.rejects(capture.cropTiles({ boardId: fref.boardId, crops: [{ page_url: 'https://linear.app' }] }), /required/);

  // 16. MCP setup never wipes a config it cannot read, and keeps other servers.
  var badCfg = path.join(tmp, 'bad-mcp.json');
  fs.writeFileSync(badCfg, '{ "projects": {}, // jsonc comment');
  assert.throws(function() { mcp.mergeMcpServer(badCfg); }, /left unchanged/);
  assert.strictEqual(fs.readFileSync(badCfg, 'utf8'), '{ "projects": {}, // jsonc comment');
  var goodCfg = path.join(tmp, 'good-mcp.json');
  fs.writeFileSync(goodCfg, JSON.stringify({ projects: { a: 1 }, mcpServers: { Neon: { url: 'x' } } }));
  mcp.mergeMcpServer(goodCfg);
  var merged = JSON.parse(fs.readFileSync(goodCfg, 'utf8'));
  assert.ok(merged.projects.a === 1 && merged.mcpServers.Neon && merged.mcpServers.analyzthis_design);

  console.log('ok  moodboard tiles / user supersedes / server / lock / films / crop / safe mcp config');
})().catch(function(e) {
  console.error(e);
  process.exit(1);
});
