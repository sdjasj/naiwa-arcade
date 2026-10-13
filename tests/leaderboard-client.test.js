import test from 'node:test';
import assert from 'node:assert/strict';
import { createLeaderboardClient } from '../js/leaderboard-client.js';

const PREFIX = 'naiwa:leaderboard:v1:';
const PLAYER_ID = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'a'.repeat(48);
const identity = nickname => ({ id: PLAYER_ID, nickname, token: TOKEN });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const errorResponse = (status, code, message) => json({ error: { code, message } }, status);

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) };
}

function harness({ nickname = '', storage = memoryStorage(), timeoutMs = 1000 } = {}) {
  let serial = 0, time = 1_800_000_000_000, playerName = nickname;
  const calls = [], runs = new Map(), best = new Map(), hooks = new Map();
  const uuid = () => `22222222-2222-4222-8222-${String(++serial).padStart(12, '0')}`;
  const fetch = async (url, options = {}) => {
    const parsed = new URL(url), method = options.method || 'GET';
    const call = { method, path: parsed.pathname, query: parsed.searchParams, body: options.body ? JSON.parse(options.body) : undefined, options };
    calls.push(call);
    const intercepted = await hooks.get(`${method} ${parsed.pathname}`)?.(call);
    if (intercepted !== undefined) return intercepted;
    if (method === 'POST' && call.path === '/api/players') return json({ player: { id: PLAYER_ID, nickname: playerName }, token: TOKEN }, 201);
    if (method === 'PATCH' && call.path === '/api/player') { playerName = call.body.nickname; return json({ player: { id: PLAYER_ID, nickname: playerName } }); }
    if (method === 'POST' && call.path === '/api/runs') {
      assert.equal(options.headers.Authorization, `Bearer ${TOKEN}`);
      const run = { runId: call.body.runId, board: call.body.board, startedAt: time };
      runs.set(run.runId, run); return json(run, 201);
    }
    if (method === 'POST' && call.path === '/api/scores') {
      assert.equal(options.headers.Authorization, `Bearer ${TOKEN}`);
      if (!playerName) return errorResponse(409, 'nickname_required', '请先填写昵称。');
      const run = runs.get(call.body.runId);
      if (!run) return errorResponse(404, 'run_not_found', '这场对局已过期，请重新开局。');
      best.set(run.runId, Math.max(best.get(run.runId) ?? -1, call.body.score));
      return json({ accepted: true, best: { score: best.get(run.runId), board: run.board } });
    }
    if (method === 'GET' && call.path === '/api/boards') return json({ board: call.query.get('board'), entries: [] });
    throw new Error(`Unexpected request ${method} ${call.path}`);
  };
  const makeClient = overrides => createLeaderboardClient({ baseUrl: 'https://leaderboard.example', fetch, storage, now: () => time, uuid, timeoutMs, ...overrides });
  const client = makeClient();
  const requests = path => calls.filter(call => call.path === path);
  return { client, makeClient, calls, runs, best, hooks, storage, requests, advance: ms => { time += ms; } };
}

test('leaderboard client registers anonymously, waits for an explicit nickname, then submits the original run', async () => {
  const h = harness();
  const run = h.client.beginRun({ game: 'flappy' });
  assert.equal(await run.ready, true);
  assert.equal(h.client.getProfile().nickname, '');
  const result = await h.client.recordResult(run, 8);
  assert.equal(result.queued, true);
  assert.equal(h.requests('/api/players').length, 1);
  assert.equal(h.requests('/api/runs').length, 1);
  assert.equal(h.requests('/api/scores').length, 0, 'anonymous registration does not publish a score');
  await h.client.setNickname('  奶蛙玩家  ');
  assert.equal(h.client.getProfile().nickname, '奶蛙玩家');
  assert.equal(h.requests('/api/scores').length, 0, 'naming is distinct from explicitly submitting queued results');
  assert.equal((await h.client.submitPending(run.board)).submitted, 1);
  assert.deepEqual(h.requests('/api/scores')[0].body, { runId: run.runId, score: 8 });
  assert.deepEqual(h.client.getPending(), []);
});

test('leaderboard client reuses a stored named identity and uploads a normal finished run automatically', async () => {
  const storage = memoryStorage({ [PREFIX + 'identity']: JSON.stringify(identity('老玩家')) });
  const h = harness({ storage, nickname: '老玩家' });
  const run = h.client.beginRun({ game: 'catch', mode: 'endless' });
  const result = await h.client.recordResult(run, 1250);
  assert.equal(result.submitted, true);
  assert.equal(result.queued, false);
  assert.equal(h.requests('/api/players').length, 0);
  assert.equal(h.requests('/api/scores').length, 1);
  assert.equal(h.requests('/api/runs')[0].body.board, 'v1:catch:endless');
});

test('leaderboard client freezes game, mode and angry starting level when a run begins', async () => {
  const h = harness();
  const selected = { game: 'angry', mode: 'classic', startLevel: 1 };
  const first = h.client.beginRun(selected);
  selected.startLevel = 6;
  const retry = h.client.beginRun(selected);
  selected.game = 'fighter'; selected.mode = 'training';
  await Promise.all([first.ready, retry.ready]);
  await h.client.recordResult(first, 4900);
  await h.client.recordResult(retry, 1200);
  assert.equal(first.board, 'v1:angry:classic:1');
  assert.equal(retry.board, 'v1:angry:classic:6');
  assert.deepEqual(h.client.getPending().map(item => [item.board, item.score]), [['v1:angry:classic:1', 4900], ['v1:angry:classic:6', 1200]]);
  assert.notEqual(first.runId, retry.runId);
});

test('leaderboard client creates no identity, run or score for practice and either local duel', async () => {
  const h = harness();
  for (const context of [{ game: 'fighter', mode: 'training' }, { game: 'fighter', mode: 'duel' }, { game: 'bomber', mode: 'duel' }]) {
    assert.equal(h.client.beginRun(context), null);
    assert.equal((await h.client.recordResult(null, 500)).queued, false);
  }
  assert.equal(h.calls.length, 0);
  assert.equal(h.client.getProfile(), null);
  assert.equal(h.storage.values.size, 0);
});

test('leaderboard client persists a transient failed submission and reload retries the same run ID', async () => {
  const h = harness({ nickname: '断网蛙' });
  const run = h.client.beginRun({ game: 'jump' }); await run.ready;
  h.hooks.set('POST /api/scores', () => { throw new TypeError('Network unavailable'); });
  const result = await h.client.recordResult(run, 600);
  assert.equal(result.queued, true);
  assert.equal(result.submitted, false);
  assert.equal(h.client.getPending()[0].runId, run.runId);
  h.hooks.delete('POST /api/scores');
  const reloaded = h.makeClient();
  assert.equal(reloaded.getPending().length, 1);
  assert.equal((await reloaded.submitPending()).submitted, 1);
  assert.deepEqual(h.requests('/api/scores').map(call => call.body), [{ runId: run.runId, score: 600 }, { runId: run.runId, score: 600 }]);
  assert.equal(h.requests('/api/runs').length, 1, 'retry must not manufacture a replacement run');
  assert.deepEqual(reloaded.getPending(), []);
});

test('leaderboard client never invents an offline score registration after start fails', async () => {
  const h = harness({ nickname: '离线蛙' });
  h.hooks.set('POST /api/runs', () => { throw new TypeError('Offline'); });
  const run = h.client.beginRun({ game: 'whack', difficulty: 'hard' });
  assert.equal(await run.ready, false);
  assert.equal(run.status, 'offline');
  h.hooks.delete('POST /api/runs');
  const result = await h.client.recordResult(run, 1500);
  assert.equal(result.queued, false);
  assert.notEqual(result.submitted, true);
  assert.equal(h.requests('/api/runs').length, 1);
  assert.equal(h.requests('/api/scores').length, 0);
  assert.deepEqual(h.client.getPending(), []);
});

test('leaderboard client treats 2048 milestones, undo and continue as monotonic checkpoints on one registered run', async () => {
  const h = harness({ nickname: '合成蛙' });
  const run = h.client.beginRun({ game: 'merge', gridSize: 4 }); await run.ready;
  await h.client.recordResult(run, 20_000); // 2048 milestone
  await h.client.recordResult(run, 18_000); // undo of the winning move
  await h.client.recordResult(run, 20_000); // repeated milestone
  await h.client.recordResult(run, 31_000); // continued board reaches game-over
  assert.deepEqual(h.requests('/api/scores').map(call => call.body.score), [20_000, 31_000]);
  assert.ok(h.requests('/api/scores').every(call => call.body.runId === run.runId));
  const reloaded = h.makeClient();
  const resumed = reloaded.beginRun({ game: 'merge', gridSize: 4 }, { resume: true, runId: run.runId });
  assert.equal(resumed.status, 'ready');
  assert.equal(resumed.submittedScore, 31_000);
  await reloaded.recordResult(resumed, 30_000); // restored board may predate the previous peak
  await reloaded.recordResult(resumed, 40_000);
  assert.deepEqual(h.requests('/api/scores').map(call => call.body.score), [20_000, 31_000, 40_000]);
  assert.equal(h.requests('/api/runs').length, 1);
  const wrongSize = reloaded.beginRun({ game: 'merge', gridSize: 6 }, { resume: true, runId: run.runId });
  assert.equal(wrongSize.status, 'legacy');
  assert.equal((await reloaded.recordResult(wrongSize, 999_999)).queued, false);
});

test('leaderboard client coalesces anonymous 2048 checkpoints and preserves the best across reload', async () => {
  const h = harness();
  const run = h.client.beginRun({ game: 'merge', gridSize: 6 }); await run.ready;
  for (const score of [25_000, 20_000, 30_000, 30_000]) await h.client.recordResult(run, score);
  assert.equal(h.client.getPending().length, 1);
  assert.equal(h.client.getPending()[0].score, 30_000);
  const client = h.makeClient();
  await client.setNickname('大棋盘蛙');
  await client.submitPending();
  const resumed = client.beginRun({ game: 'merge', gridSize: 6 }, { resume: true, runId: run.runId });
  assert.equal(resumed.submittedScore, 30_000);
  assert.equal((await client.recordResult(resumed, 25_000)).submitted, true);
  assert.equal(h.requests('/api/scores').length, 1);
});

test('leaderboard client refuses an unregistered legacy puzzle save without creating a fresh run for its old score', async () => {
  const h = harness();
  const run = h.client.beginRun({ game: 'merge', gridSize: 4 }, { resume: true, runId: '33333333-3333-4333-8333-333333333333' });
  assert.equal(run.status, 'legacy');
  assert.equal((await h.client.recordResult(run, 500_000)).queued, false);
  assert.equal(h.calls.length, 0);
});

test('leaderboard client keeps rapid finish, restart and naming separate while sharing one identity request', async () => {
  const h = harness(), playerGate = deferred(), firstRunGate = deferred();
  h.hooks.set('POST /api/players', async () => { await playerGate.promise; });
  let firstId;
  h.hooks.set('POST /api/runs', async call => { if (call.body.runId === firstId) await firstRunGate.promise; });
  const first = h.client.beginRun({ game: 'angry', startLevel: 1 }); firstId = first.runId;
  const firstResult = h.client.recordResult(first, 1000);
  const second = h.client.beginRun({ game: 'flappy', mode: 'endless', difficulty: 'hard' });
  const rename = h.client.setNickname('快速重开的蛙');
  const secondResult = h.client.recordResult(second, 10);
  playerGate.resolve();
  await rename; await secondResult;
  assert.equal(first.status, 'starting');
  firstRunGate.resolve(); await firstResult;
  assert.equal(h.requests('/api/players').length, 1);
  assert.equal(h.requests('/api/runs').length, 2);
  assert.equal(h.requests('/api/scores').length, 2);
  const byRun = new Map(h.requests('/api/scores').map(call => [call.body.runId, call.body.score]));
  assert.equal(byRun.get(first.runId), 1000);
  assert.equal(byRun.get(second.runId), 10);
  assert.equal(h.runs.get(first.runId).board, 'v1:angry:classic:1');
  assert.equal(h.runs.get(second.runId).board, 'v1:flappy:endless:hard');
});

test('leaderboard client does not double-post identical concurrent results and retains a higher in-flight puzzle checkpoint', async () => {
  const h = harness({ nickname: '并发蛙' });
  const run = h.client.beginRun({ game: 'merge' }); await run.ready;
  const gate = deferred(), entered = deferred();
  h.hooks.set('POST /api/scores', async call => { if (call.body.score === 100) { entered.resolve(); await gate.promise; } });
  const low = h.client.recordResult(run, 100); await entered.promise;
  const duplicate = h.client.recordResult(run, 100);
  const high = h.client.recordResult(run, 200);
  const explicitRetry = h.client.submitPending(run.board);
  gate.resolve();
  await Promise.all([low, duplicate, high, explicitRetry]);
  assert.deepEqual(h.requests('/api/scores').map(call => call.body.score), [100, 200]);
  assert.deepEqual(h.client.getPending(), []);
  const resumed = h.makeClient().beginRun({ game: 'merge' }, { resume: true, runId: run.runId });
  assert.equal(resumed.submittedScore, 200, 'late lower completions cannot overwrite registry peak');
  await h.client.recordResult(run, 180);
  assert.equal(h.requests('/api/scores').length, 2);
});

test('leaderboard client tolerates corrupt JSON, wrong-player pending items and malformed storage data', async () => {
  const storage = memoryStorage({ [PREFIX + 'identity']: '{bad', [PREFIX + 'pending']: JSON.stringify({ score: 123 }), [PREFIX + 'merge-runs']: 'false' });
  const h = harness({ storage });
  assert.equal(h.client.getProfile(), null);
  assert.deepEqual(h.client.getPending(), []);
  const run = h.client.beginRun({ game: 'survivor' }); assert.equal(await run.ready, true);
  storage.setItem(PREFIX + 'pending', JSON.stringify([
    { runId: run.runId, playerId: 'another-player', board: run.board, score: 300 },
    { runId: 'broken', playerId: PLAYER_ID, board: run.board, score: 300 },
    { runId: run.runId, playerId: PLAYER_ID, board: run.board, score: -1 },
    { runId: run.runId, playerId: PLAYER_ID, board: 'v1:fighter:training:belly', score: 300 },
  ]));
  assert.deepEqual(h.makeClient().getPending(), []);
});

test('leaderboard client works with blocked storage and ignores exceptions in view subscribers', async () => {
  const storage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('quota'); } };
  const h = harness({ storage, nickname: '无存储蛙' });
  h.client.subscribe(() => { throw new Error('view failed'); });
  const run = h.client.beginRun({ game: 'bomber' });
  assert.equal((await h.client.recordResult(run, 500)).submitted, true);
  assert.deepEqual(h.client.getPending(), []);
});

test('leaderboard client timeout retains the original score for a later retry', async () => {
  const h = harness({ nickname: '超时蛙', timeoutMs: 15 });
  const run = h.client.beginRun({ game: 'flappy' }); await run.ready;
  h.hooks.set('POST /api/scores', call => new Promise((resolve, reject) => {
    call.options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  }));
  assert.equal((await h.client.recordResult(run, 5)).queued, true);
  assert.equal(h.client.getPending()[0].runId, run.runId);
  h.hooks.delete('POST /api/scores');
  assert.equal((await h.client.submitPending()).submitted, 1);
});

test('leaderboard client fetches only server board data and does not fabricate rows from pending local scores', async () => {
  const h = harness();
  const run = h.client.beginRun({ game: 'flappy' }); await h.client.recordResult(run, 5);
  const board = await h.client.getBoard(run.board);
  assert.deepEqual(board.entries, []);
  const request = h.requests('/api/boards')[0];
  assert.equal(request.query.get('board'), run.board);
  assert.equal(request.query.get('player'), PLAYER_ID);
  assert.equal(request.query.get('limit'), '50');
  await assert.rejects(h.client.getBoard('v1:flappy:duel:normal'));
  assert.equal(h.requests('/api/boards').length, 1);
});

test('leaderboard client rejects invalid names and scores before sending them', async () => {
  const h = harness();
  for (const nickname of ['', '   ', 'a'.repeat(17), '蛙\n蛙', '蛙\u200b']) await assert.rejects(h.client.setNickname(nickname));
  assert.equal(h.calls.length, 0);
  const run = h.client.beginRun({ game: 'catch' }); await run.ready;
  for (const score of [-1, 0.5, '100', Infinity, NaN, 2 ** 40]) assert.equal((await h.client.recordResult(run, score)).queued, false);
  assert.equal(h.requests('/api/scores').length, 0);
  assert.deepEqual(h.client.getPending(), []);
});

test('leaderboard client drops an expired first run without blocking the next valid score in the same board', async () => {
  const h = harness();
  const oldRun = h.client.beginRun({ game: 'flappy' }), currentRun = h.client.beginRun({ game: 'flappy' });
  await Promise.all([oldRun.ready, currentRun.ready]);
  await h.client.recordResult(oldRun, 20); await h.client.recordResult(currentRun, 30);
  h.runs.delete(oldRun.runId);
  await h.client.setNickname('新局继续上榜');
  const result = await h.client.submitPending(oldRun.board);
  assert.equal(result.failed, 1);
  assert.equal(result.submitted, 1);
  assert.equal(result.failures[0].runId, oldRun.runId);
  assert.equal(result.failures[0].terminal, true);
  assert.deepEqual(h.client.getPending(), []);
  assert.equal(h.best.get(currentRun.runId), 30);
});

test('leaderboard client never labels a permanently rejected result as successfully uploaded', async () => {
  const h = harness({ nickname: '过期蛙' });
  const run = h.client.beginRun({ game: 'catch' }); await run.ready;
  h.runs.delete(run.runId);
  const result = await h.client.recordResult(run, 500);
  assert.notEqual(result.submitted, true);
  assert.equal(result.queued, false);
  assert.ok(!result.message.includes('已提交全球排行榜'));
  assert.deepEqual(h.client.getPending(), []);
});

test('leaderboard client retains authorization, rate-limit and server failures for retry', async () => {
  for (const status of [401, 429, 503]) {
    const h = harness({ nickname: '等待恢复的蛙' });
    const run = h.client.beginRun({ game: 'flappy' }); await run.ready;
    h.hooks.set('POST /api/scores', () => errorResponse(status, 'temporary', '请稍后重试。'));
    const result = await h.client.recordResult(run, 4);
    assert.equal(result.queued, true, String(status));
    assert.equal(result.submitted, false);
    assert.equal(h.client.getPending()[0].runId, run.runId);
  }
});

test('concurrent waiters preserve permanent rejection and never persist a false puzzle upload', async () => {
  for (const status of [400, 404, 409, 410]) {
    const h = harness({ nickname: '并发被拒的蛙' });
    const run = h.client.beginRun({ game: 'merge' }); await run.ready;
    const gate = deferred(), entered = deferred();
    h.hooks.set('POST /api/scores', async () => { entered.resolve(); await gate.promise; return errorResponse(status, 'rejected', '本局不能提交。'); });
    const first = h.client.recordResult(run, 100); await entered.promise;
    const second = h.client.recordResult(run, 100);
    gate.resolve();
    for (const result of await Promise.all([first, second])) {
      assert.equal(result.submitted, false, String(status));
      assert.equal(result.queued, false);
      assert.match(result.message, /未上榜/);
    }
    assert.equal(run.submittedScore, -1);
    assert.equal(h.requests('/api/scores').length, 1);
    const resumed = h.makeClient().beginRun({ game: 'merge' }, { resume: true, runId: run.runId });
    assert.equal(resumed.submittedScore, -1, 'a removed pending item is not evidence of a successful upload');
  }
});

test('a rejected higher in-flight checkpoint does not invalidate an acknowledged lower score or invent a higher saved peak', async () => {
  const h = harness({ nickname: '分段并发蛙' });
  const run = h.client.beginRun({ game: 'merge' }); await run.ready;
  const gate = deferred(), entered = deferred();
  h.hooks.set('POST /api/scores', async call => {
    if (call.body.score === 100) { entered.resolve(); await gate.promise; }
    else return errorResponse(400, 'rejected', '更高成绩无效。');
  });
  const low = h.client.recordResult(run, 100); await entered.promise;
  const high = h.client.recordResult(run, 200);
  gate.resolve();
  const [lowerResult, higherResult] = await Promise.all([low, high]);
  assert.equal(lowerResult.submitted, true);
  assert.equal(higherResult.submitted, false);
  assert.equal(higherResult.queued, false);
  assert.equal(run.submittedScore, 100);
  const resumed = h.makeClient().beginRun({ game: 'merge' }, { resume: true, runId: run.runId });
  assert.equal(resumed.submittedScore, 100);
  assert.deepEqual(h.client.getPending(), []);
});

test('a waiter that successfully retries a transient failure reports the later acknowledgement accurately', async () => {
  const h = harness({ nickname: '恢复联网蛙' });
  const run = h.client.beginRun({ game: 'merge' }); await run.ready;
  const gate = deferred(), entered = deferred();
  let attempts = 0;
  h.hooks.set('POST /api/scores', async () => {
    if (++attempts === 1) { entered.resolve(); await gate.promise; throw new TypeError('offline'); }
  });
  const first = h.client.recordResult(run, 100); await entered.promise;
  const second = h.client.recordResult(run, 100);
  gate.resolve();
  const [, recovered] = await Promise.all([first, second]);
  assert.equal(recovered.submitted, true);
  assert.equal(recovered.queued, false);
  assert.match(recovered.message, /已提交/);
  assert.equal(h.makeClient().beginRun({ game: 'merge' }, { resume: true, runId: run.runId }).submittedScore, 100);
});

test('concurrent network failures keep the same pending score on disk and never claim upload success', async () => {
  const h = harness({ nickname: '持续断网蛙' });
  const run = h.client.beginRun({ game: 'catch' }); await run.ready;
  const gate = deferred(), entered = deferred();
  h.hooks.set('POST /api/scores', async () => { entered.resolve(); await gate.promise; throw new TypeError('offline'); });
  const first = h.client.recordResult(run, 100); await entered.promise;
  const second = h.client.recordResult(run, 100);
  gate.resolve();
  for (const result of await Promise.all([first, second])) {
    assert.equal(result.submitted, false);
    assert.equal(result.queued, true);
    assert.match(result.message, /已保留/);
  }
  const persisted = h.makeClient().getPending();
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].runId, run.runId);
  assert.equal(persisted[0].score, 100);
  assert.equal(run.submittedScore, -1);
});
