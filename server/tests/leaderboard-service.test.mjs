import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createLeaderboardService } from '../lib/leaderboard-service.ts';
import { makeBoard, MAX_SCORE } from '../lib/leaderboard-rules.js';

const ORIGIN = 'https://sdjasj.github.io';
const CLASSIC = makeBoard({ game: 'whack' });
const ENDLESS = makeBoard({ game: 'whack', mode: 'endless' });
const MERGE = makeBoard({ game: 'merge' });
const migrations = new URL('../drizzle/', import.meta.url);

function fixture(options = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  for (const name of readdirSync(migrations).filter(name => name.endsWith('.sql')).sort()) sqlite.exec(readFileSync(new URL(name, migrations), 'utf8'));
  const db = {
    prepare(sql) {
      let params = [];
      return {
        sql,
        get params() { return params; },
        bind(...values) { params = values; return this; },
        async first(column) { const row = sqlite.prepare(sql).get(...params); return row ? (column ? row[column] : row) : null; },
        async all() { return { results: sqlite.prepare(sql).all(...params) }; },
        async run() { return sqlite.prepare(sql).run(...params); },
      };
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const output = statements.map(statement => ({ results: sqlite.prepare(statement.sql).all(...statement.params) }));
        sqlite.exec('COMMIT');
        return output;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  let now = 1_800_000_000_000;
  const service = createLeaderboardService(db, { ...options, now: () => now });
  async function request(path, { method = 'GET', body, token, headers = {}, raw } = {}) {
    const response = await service.handle(new Request(`https://naiwa-arcade-scores.newcat6.chatgpt.site${path}`, {
      method,
      headers: { origin: ORIGIN, 'cf-connecting-ip': '192.0.2.10', ...(body !== undefined || raw !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      ...(body !== undefined || raw !== undefined ? { body: raw !== undefined ? raw : JSON.stringify(body) } : {}),
    }));
    const text = await response.text();
    return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : null };
  }
  async function player(name = '奶蛙玩家') {
    const response = await request('/api/players', { method: 'POST', body: name === null ? {} : { nickname: name } });
    assert.equal(response.status, 201);
    return { ...response.body.player, token: response.body.token };
  }
  async function run(player, board = CLASSIC, runId = randomUUID()) {
    const response = await request('/api/runs', { method: 'POST', token: player.token, body: { board, runId } });
    assert.ok(response.status === 200 || response.status === 201, JSON.stringify(response.body));
    return response.body;
  }
  function score(player, run, score) { return request('/api/scores', { method: 'POST', token: player.token, body: { runId: run.runId, score } }); }
  function board(board = CLASSIC, player) { return request(`/api/boards?board=${encodeURIComponent(board)}${player ? `&player=${player.id}` : ''}`); }
  return { sqlite, db, service, request, player, run, score, board, tick(ms) { now += ms; }, close() { sqlite.close(); } };
}

function scenario(name, fn) {
  test(name, async t => { const f = fixture(); t.after(() => f.close()); await fn(f); });
}

scenario('anonymous visitors can register a timed run; only a named player may publish, and only token hashes persist', async f => {
  const player = await f.player(null);
  assert.equal(player.nickname, '');
  assert.match(player.token, /^[a-f0-9]{64}$/);
  const stored = f.sqlite.prepare('SELECT token_hash FROM players WHERE id = ?').get(player.id);
  assert.ok(stored.token_hash !== player.token);
  assert.ok(stored.token_hash === createHash('sha256').update(player.token).digest('hex'));
  const run = await f.run(player);
  assert.equal((await f.score(player, run, 0)).body.error.code, 'NICKNAME_REQUIRED');
  assert.equal((await f.board()).body.entries.length, 0);
  const named = await f.request('/api/player', { method: 'PATCH', token: player.token, body: { nickname: '  蛙蛙🐸  ' } });
  assert.equal(named.body.player.nickname, '蛙蛙🐸');
  const submitted = await f.score(player, run, 0);
  assert.equal(submitted.status, 200);
  assert.equal(submitted.body.best.score, 0);
  assert.equal(submitted.body.best.rank, 1);
  assert.equal(JSON.stringify((await f.board()).body).includes('token'), false);
});

scenario('run registration is idempotent with frozen start, board and owner; foreign tokens cannot submit', async f => {
  const one = await f.player('一号'), two = await f.player('二号');
  const run = await f.run(one);
  f.tick(5000);
  const repeated = await f.run(one, CLASSIC, run.runId);
  assert.equal(repeated.startedAt, run.startedAt);
  const changed = await f.request('/api/runs', { method: 'POST', token: one.token, body: { runId: run.runId, board: ENDLESS } });
  assert.equal(changed.status, 409);
  assert.equal((await f.request('/api/runs', { method: 'POST', token: two.token, body: { runId: run.runId, board: CLASSIC } })).status, 409);
  assert.equal((await f.score(two, run, 100)).status, 404);
  assert.equal((await f.request('/api/scores', { method: 'POST', token: '0'.repeat(64), body: { runId: run.runId, score: 0 } })).status, 401);
});

scenario('classic submissions are immutable and idempotent; each player has one best per board', async f => {
  const player = await f.player();
  const first = await f.run(player);
  f.tick(2000);
  const result = await f.score(player, first, 1000);
  assert.equal(result.body.improved, true);
  const duplicate = await f.score(player, first, 1000);
  assert.equal(duplicate.body.duplicate, true);
  assert.equal(duplicate.body.improved, false);
  assert.equal((await f.score(player, first, 999)).status, 409);
  const second = await f.run(player);
  f.tick(2000);
  assert.equal((await f.score(player, second, 900)).body.improved, false);
  const next = await f.run(player);
  f.tick(3000);
  assert.equal((await f.score(player, next, 1500)).body.improved, true);
  assert.equal((await f.board(CLASSIC, player)).body.entries.length, 1);
  assert.equal((await f.board(CLASSIC, player)).body.myBest.score, 1500);
  assert.equal((await f.board(ENDLESS, player)).body.myBest, null);
});

scenario('rank uses score descending then first achievement, with consistent public and personal ranks', async f => {
  const one = await f.player('一'), two = await f.player('二'), three = await f.player('三');
  const runs = await Promise.all([f.run(one), f.run(two), f.run(three)]);
  f.tick(1000);
  await f.score(one, runs[0], 100);
  f.tick(1);
  await f.score(two, runs[1], 100);
  await f.score(three, runs[2], 90);
  const leaderboard = await f.board(CLASSIC, two);
  assert.deepEqual(leaderboard.body.entries.map(entry => [entry.playerId, entry.rank]), [[one.id, 1], [two.id, 2], [three.id, 3]]);
  assert.equal(leaderboard.body.myBest.rank, 2);
  assert.equal(leaderboard.body.totalPlayers, 3);
  const limited = await f.request(`/api/boards?board=${CLASSIC}&limit=1&player=${three.id}`);
  assert.equal(limited.body.entries.length, 1);
  assert.equal(limited.body.myBest.rank, 3);
});

scenario('2048 checkpoints increase the same run without 32-bit truncation; stale retries cannot lower it', async f => {
  const player = await f.player();
  const run = await f.run(player, MERGE);
  assert.equal((await f.score(player, run, 4096)).body.improved, true);
  assert.equal((await f.score(player, run, 2 ** 35)).body.best.score, 2 ** 35);
  assert.equal((await f.score(player, run, 1024)).body.improved, false);
  assert.equal((await f.score(player, run, MAX_SCORE)).body.best.score, MAX_SCORE);
  assert.equal((await f.score(player, run, MAX_SCORE + 1)).status, 400);
  assert.equal((await f.board(MERGE, player)).body.entries.length, 1);
});

scenario('concurrent conflicting classic reports consume one result atomically', async f => {
  const player = await f.player();
  const run = await f.run(player);
  f.tick(1000);
  const results = await Promise.all([f.score(player, run, 100), f.score(player, run, 200)]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  const winner = results.find(result => result.status === 200).body.best.score;
  assert.equal((await f.board(CLASSIC, player)).body.myBest.score, winner);
  assert.equal(f.sqlite.prepare('SELECT submissions FROM runs WHERE id = ?').get(run.runId).submissions, 1);
});

scenario('concurrent run creation and merge score upserts cannot duplicate or overwrite a larger score', async f => {
  const player = await f.player();
  const runId = randomUUID();
  const created = await Promise.all([f.run(player, MERGE, runId), f.run(player, MERGE, runId)]);
  assert.equal(created[0].startedAt, created[1].startedAt);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS total FROM runs').get().total, 1);
  const results = await Promise.all([f.score(player, created[0], 100), f.score(player, created[0], 400), f.score(player, created[0], 200)]);
  assert.ok(results.every(result => result.status === 200));
  assert.equal((await f.board(MERGE, player)).body.myBest.score, 400);
});

scenario('server start time drives validation and the client cannot inject elapsed time or a different board', async f => {
  const player = await f.player();
  const run = await f.run(player, makeBoard({ game: 'flappy' }));
  assert.equal((await f.score(player, run, 100)).body.error.code, 'score_too_fast');
  assert.equal((await f.request('/api/scores', { method: 'POST', token: player.token, body: { runId: run.runId, score: 100, elapsedMs: 10 ** 9 } })).body.error.code, 'UNKNOWN_FIELD');
  f.tick(25_000);
  assert.equal((await f.score(player, run, 100)).status, 200);
  for (const score of [-1, 0.5, '100', null]) assert.equal((await f.score(player, run, score)).status, 400);
  assert.equal((await f.request('/api/runs', { method: 'POST', token: player.token, body: { runId: randomUUID(), board: 'v1:fighter:training:belly' } })).status, 400);
});

scenario('Unicode nicknames normalize visibly and reject invisible controls, too-long and nonstring input', async f => {
  const player = await f.player();
  for (const value of ['', '   ', '\n奶蛙', '奶\u202e蛙', '\u200b', '\ud800', '🐸'.repeat(17), 12]) {
    assert.equal((await f.request('/api/player', { method: 'PATCH', token: player.token, body: { nickname: value } })).status, 400);
  }
  const result = await f.request('/api/player', { method: 'PATCH', token: player.token, body: { nickname: 'e\u0301🐸' } });
  assert.equal(result.body.player.nickname, 'é🐸');
  assert.equal((await f.request('/api/player', { method: 'PATCH', token: player.token, body: { nickname: '🐸'.repeat(16) } })).status, 200);
});

scenario('body byte limits apply to streamed UTF-8 content, malformed JSON and unknown fields', async f => {
  const over = await f.request('/api/players', { method: 'POST', raw: JSON.stringify({ nickname: '蛙'.repeat(800) }) });
  assert.equal(over.status, 413);
  assert.equal((await f.request('/api/players', { method: 'POST', raw: '{}' , headers: { 'content-length': '9999' } })).status, 413);
  assert.equal((await f.request('/api/players', { method: 'POST', raw: '{broken' })).status, 400);
  assert.equal((await f.request('/api/players', { method: 'POST', body: [] })).status, 400);
  assert.equal((await f.request('/api/players', { method: 'POST', body: { nickname: '蛙', admin: true } })).status, 400);
  assert.equal((await f.request('/api/players', { method: 'POST', raw: '{}', headers: { 'content-type': 'text/plain' } })).status, 415);
});

scenario('CORS headers cover successful preflight and every service error while unrelated origins cannot write', async f => {
  const preflight = await f.request('/api/scores', { method: 'OPTIONS' });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), ORIGIN);
  assert.match(preflight.headers.get('access-control-allow-headers'), /Authorization/);
  for (const [path, config, status] of [
    ['/api/boards?board=invalid', {}, 400],
    ['/api/player', { method: 'PATCH', body: { nickname: '蛙' } }, 401],
    ['/api/scores', {}, 405],
  ]) {
    const response = await f.request(path, config);
    assert.equal(response.status, status);
    assert.equal(response.headers.get('access-control-allow-origin'), ORIGIN);
  }
  const rejected = await f.request('/api/players', { method: 'POST', body: {}, headers: { origin: 'https://evil.example' } });
  assert.equal(rejected.status, 403);
  assert.equal(rejected.headers.get('access-control-allow-origin'), null);
  assert.equal((await f.request('/api/players', { method: 'POST', body: {}, headers: { origin: 'http://localhost:8080' } })).status, 403);
});

test('local browser origins are allowed only in development; database failures retain CORS without exposing internals', async t => {
  const f = fixture({ development: true }); t.after(() => f.close());
  assert.equal((await f.request('/api/players', { method: 'POST', body: {}, headers: { origin: 'http://localhost:8080' } })).status, 201);
  assert.equal((await f.request('/api/players', { method: 'POST', body: {}, headers: { origin: 'http://localhost.evil:8080' } })).status, 403);
  const broken = createLeaderboardService({ prepare() { throw new Error('private database location and credentials'); } });
  const response = await broken.handle(new Request('https://example.com/api/health', { headers: { origin: ORIGIN } }));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('access-control-allow-origin'), ORIGIN);
  assert.equal(JSON.stringify(await response.json()).includes('credentials'), false);
});

scenario('rate buckets increment atomically, return Retry-After and expire; raw IP is absent from storage', async f => {
  const player = await f.player();
  const result = await Promise.all(Array.from({ length: 12 }, (_, i) => f.request('/api/player', { method: 'PATCH', token: player.token, body: { nickname: `蛙${i}` } })));
  assert.equal(result.filter(response => response.status === 200).length, 10);
  assert.equal(result.filter(response => response.status === 429).length, 2);
  const limited = result.find(response => response.status === 429);
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
  assert.equal(limited.headers.get('access-control-allow-origin'), ORIGIN);
  assert.equal(JSON.stringify(f.sqlite.prepare('SELECT * FROM rate_limits').all()).includes('192.0.2.10'), false);
  f.tick(60_000);
  assert.equal((await f.request('/api/player', { method: 'PATCH', token: player.token, body: { nickname: '重新出发' } })).status, 200);
});

scenario('DELETE only removes the authenticated player, all their public records and runs; token then stops working', async f => {
  const one = await f.player('一'), two = await f.player('二');
  const a = await f.run(one), b = await f.run(two);
  await f.score(one, a, 0); await f.score(two, b, 0);
  assert.equal((await f.request('/api/player', { method: 'DELETE', token: one.token })).body.deleted, true);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS total FROM runs WHERE player_id = ?').get(one.id).total, 0);
  const board = await f.board(CLASSIC, one);
  assert.equal(board.body.myBest, null);
  assert.deepEqual(board.body.entries.map(entry => entry.playerId), [two.id]);
  assert.equal((await f.request('/api/player', { method: 'PATCH', token: one.token, body: { nickname: '回来' } })).status, 401);
});

scenario('run retention and per-player capacity are bounded; expired runs disappear without deleting their best', async f => {
  const player = await f.player();
  const run = await f.run(player);
  await f.score(player, run, 0);
  const merge = await f.run(player, MERGE);
  const base = f.sqlite.prepare('SELECT * FROM runs WHERE id = ?').get(run.runId);
  const insert = f.sqlite.prepare('INSERT INTO runs (id, player_id, board, started_at, expires_at) VALUES (?, ?, ?, ?, ?)');
  for (let i = 0; i < 498; i++) insert.run(randomUUID(), player.id, CLASSIC, base.started_at, base.expires_at);
  assert.equal((await f.request('/api/runs', { method: 'POST', token: player.token, body: { board: CLASSIC, runId: randomUUID() } })).body.error.code, 'RUN_CAPACITY');
  f.tick(8 * 86_400_000);
  assert.equal((await f.score(player, run, 0)).status, 404);
  assert.equal((await f.score(player, merge, 100)).status, 200);
  assert.equal((await f.board(CLASSIC, player)).body.myBest.score, 0);
  assert.ok(f.sqlite.prepare('SELECT COUNT(*) AS total FROM runs').get().total < 500);
});

scenario('board request limits and identity parameters validate before querying a bounded ranking', async f => {
  for (const suffix of ['&limit=0', '&limit=101', '&limit=abc', '&player=invalid']) assert.equal((await f.request(`/api/boards?board=${CLASSIC}${suffix}`)).status, 400);
  assert.equal((await f.request('/api/boards?board=v1:whack:classic:normal%27%20OR%201=1')).status, 400);
  const player = await f.player();
  assert.equal((await f.request('/api/runs', { method: 'POST', token: player.token, body: { board: CLASSIC, runId: `${randomUUID()}\n` } })).status, 400);
  const health = await f.request('/api/health');
  assert.deepEqual(health.body, { ok: true, service: 'naiwa-leaderboard', version: 1 });
});
