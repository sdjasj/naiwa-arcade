import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../js/games/jump.js';

function harness() {
  const results = [];
  const scores = [];
  const sounds = [];
  const frogs = [];
  const noop = () => {};
  const ctx = new Proxy({
    createLinearGradient: () => ({ addColorStop: noop }),
    measureText: (value) => ({ width: String(value).length * 10 }),
  }, {
    get: (target, key) => key in target ? target[key] : noop,
    set: (target, key, value) => { target[key] = value; return true; },
  });
  const game = createGame({
    ctx, canvas: { width: 960, height: 560 }, width: 960, height: 560,
    drawFrog: (_ctx, x, y, size, options) => frogs.push({ x, y, size, options }),
    audio: { play: (kind) => sounds.push(kind) },
    onScore: (score) => scores.push(score),
    onStatus() {},
    onEnd: (result) => results.push(result),
  });
  return { game, results, scores, sounds, frogs };
}

function advance(game, seconds, dt = 1 / 120) {
  let left = seconds;
  while (left > 1e-8) {
    const step = Math.min(dt, left);
    game.update(step);
    left -= step;
  }
}

function until(game, predicate, maxSeconds = 4, dt = 1 / 120) {
  for (let time = 0; time <= maxSeconds; time += dt) {
    const state = game.getState();
    if (predicate(state)) return state;
    game.update(dt);
  }
  assert.fail(`Timed out waiting for game state: ${JSON.stringify(game.getState())}`);
}

// Uses only the marker a player sees, normal charging, and a normal release.
function aimAt(game, destinationX) {
  assert.equal(game.getState().phase, 'ready');
  game.pointerDown({ x: 400, y: 300 });
  let state = game.getState();
  for (let frame = 0; frame < 400 && state.landingPreview.x < destinationX; frame += 1) {
    game.update(1 / 240);
    state = game.getState();
  }
  assert.ok(state.landingPreview.x >= destinationX, 'the destination must be reachable at full charge');
  const preview = state.landingPreview;
  game.pointerUp({ x: 400, y: 300 });
  assert.equal(game.getState().phase, 'airborne');
  return preview;
}

function jumpToCenter(game, dt = 1 / 120) {
  const before = game.getState();
  const preview = aimAt(game, before.platforms[before.nextPlatform].center);
  const landed = until(game, (state) => state.phase !== 'airborne', 3, dt);
  return { preview, landed };
}

test('jump: idle preview is inert, a fresh start has three lives and the course resets after progress', () => {
  const { game, results, scores, frogs } = harness();
  game.render(0);
  assert.ok(frogs.length > 0);
  game.pointerDown();
  advance(game, 0.5);
  game.pointerUp();
  assert.equal(game.getState().phase, 'idle');
  assert.equal(results.length, 0);
  game.start();
  let state = game.getState();
  assert.equal(state.phase, 'ready');
  assert.equal(state.lives, 3);
  assert.equal(state.totalPlatforms, 30);
  assert.equal(state.platforms.length, 31, 'the course includes the starting platform');
  assert.equal(state.completed, 0);
  assert.equal(state.stage, 1);
  const initialPlatforms = state.platforms;
  jumpToCenter(game);
  game.render(2);
  assert.equal(game.getState().completed, 1);
  assert.ok(game.getState().score > 0);
  game.start();
  state = game.getState();
  assert.equal(state.score, 0);
  assert.equal(state.completed, 0);
  assert.equal(state.perfects, 0);
  assert.equal(state.combo, 0);
  assert.equal(state.camera, 0);
  assert.equal(state.lives, 3);
  assert.deepEqual(state.platforms, initialPlatforms);
  assert.equal(scores.at(-1), 0);
});

test('jump: longer charging moves the landing marker farther; charge caps without automatically launching', () => {
  const { game, sounds } = harness();
  game.start();
  game.pointerDown();
  advance(game, 0.25);
  const short = game.getState();
  advance(game, 0.5);
  const long = game.getState();
  assert.ok(long.charge > short.charge);
  assert.ok(long.landingPreview.x > short.landingPreview.x + 100);
  assert.equal(short.landingPreview.direction, 'short');
  game.render(0.75);
  advance(game, 4);
  assert.equal(game.getState().charge, 1);
  assert.equal(game.getState().phase, 'charging');
  assert.equal(sounds.filter((kind) => kind === 'launch').length, 0);
  game.pointerUp();
  assert.equal(game.getState().phase, 'airborne');
  assert.equal(sounds.filter((kind) => kind === 'launch').length, 1);
});

test('jump: Space releases once, autorepeat is ignored, and cancellation safely discards a charge', () => {
  const { game, sounds } = harness();
  const space = { code: 'Space', key: ' ', preventDefault() {} };
  game.start();
  game.keyDown({ ...space, repeat: true });
  assert.equal(game.getState().phase, 'ready');
  game.keyDown(space);
  advance(game, 0.5);
  const beforeRepeat = game.getState().charge;
  game.keyDown({ ...space, repeat: true });
  assert.equal(game.getState().charge, beforeRepeat);
  game.cancelInput();
  const cancelled = game.getState();
  assert.equal(cancelled.phase, 'ready');
  assert.equal(cancelled.charge, 0);
  assert.equal(cancelled.lives, 3);
  assert.equal(cancelled.player.x, cancelled.platforms[0].center);
  game.keyUp(space);
  assert.equal(game.getState().phase, 'ready', 'a release arriving after cancellation must not launch');
  game.pointerDown();
  advance(game, 0.5);
  game.pointerUp({ cancelled: true });
  assert.equal(game.getState().phase, 'ready');
  assert.equal(sounds.filter((kind) => kind === 'launch').length, 0);

  game.keyDown(space);
  advance(game, 0.8);
  game.pointerUp();
  assert.equal(game.getState().phase, 'charging', 'pointer release must not release a keyboard charge');
  game.keyUp(space);
  game.keyUp(space);
  assert.equal(game.getState().phase, 'airborne');
  assert.equal(sounds.filter((kind) => kind === 'launch').length, 1);
});

for (const [name, dt] of [['120 Hz', 1 / 120], ['30 Hz', 1 / 30], ['250 ms frames', 0.25]]) {
  test(`jump: the visible landing prediction matches a perfect landing at ${name}`, () => {
    const { game, scores, results } = harness();
    game.start();
    const { preview, landed } = jumpToCenter(game, dt);
    assert.equal(preview.success, true);
    assert.equal(preview.perfect, true);
    assert.equal(landed.phase, 'ready');
    assert.equal(landed.completed, 1);
    assert.equal(landed.lastLanding.perfect, true);
    assert.ok(Math.abs(landed.lastLanding.x - preview.x) < 0.00001, 'preview and swept collision use the same trajectory');
    assert.equal(landed.score, 30);
    assert.equal(landed.combo, 1);
    assert.equal(landed.lives, 3);
    assert.deepEqual(scores, [0, 30]);
    assert.equal(results.length, 0);
  });
}

test('jump: off-center landings count, while consecutive perfect landings earn bonuses', () => {
  const { game } = harness();
  game.start();
  const target = game.getState().platforms[1];
  aimAt(game, target.x + 18);
  const landed = until(game, (state) => state.phase !== 'airborne');
  assert.equal(landed.completed, 1);
  assert.equal(landed.lastLanding.perfect, false);
  assert.equal(landed.score, 10);
  jumpToCenter(game);
  assert.equal(game.getState().combo, 2);
  assert.equal(game.getState().perfects, 1);
  assert.equal(game.getState().lastLanding.points, 32);
  assert.equal(game.getState().score, 42);
});

test('jump: a missed jump loses exactly one life, preserves progress, and restores the last checkpoint', () => {
  const { game, results, sounds } = harness();
  game.start();
  jumpToCenter(game);
  const checkpoint = game.getState();
  game.pointerDown();
  advance(game, 1.3);
  assert.equal(game.getState().landingPreview.direction, 'long');
  game.pointerUp();
  const missed = until(game, (state) => state.phase === 'missed');
  assert.equal(missed.lives, 2);
  assert.equal(missed.completed, 1);
  assert.equal(missed.combo, 0);
  assert.equal(missed.score, checkpoint.score);
  game.render(3);
  advance(game, 0.5);
  assert.equal(game.getState().lives, 2, 'the miss animation cannot lose another life');
  const recovered = until(game, (state) => state.phase === 'ready');
  assert.equal(recovered.player.x, checkpoint.platforms[1].center);
  assert.equal(recovered.player.y + recovered.player.footOffset, checkpoint.platforms[1].top);
  assert.equal(recovered.nextPlatform, 2);
  assert.equal(results.length, 0);
  assert.ok(sounds.includes('hit'));
  assert.ok(sounds.includes('laugh'));
  jumpToCenter(game);
  assert.equal(game.getState().completed, 2, 'play continues from the saved platform');
  assert.equal(game.getState().lives, 2);
});

test('jump: exhausting three lives sends one loss result and restarting permits a new game', () => {
  const { game, results } = harness();
  game.start();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    game.pointerDown();
    advance(game, 1.3);
    game.pointerUp();
    const missed = until(game, (state) => state.phase === 'missed');
    assert.equal(missed.lives, 2 - attempt);
    const recovered = until(game, (state) => state.phase === 'ready' || state.phase === 'ended');
    assert.equal(recovered.phase, attempt === 2 ? 'ended' : 'ready');
  }
  assert.equal(results.length, 1);
  assert.equal(results[0].score, 0);
  advance(game, 10);
  game.pointerDown();
  game.pointerUp();
  assert.equal(results.length, 1);
  game.start();
  assert.equal(game.getState().lives, 3);
  assert.equal(game.getState().phase, 'ready');
  jumpToCenter(game);
  assert.equal(game.getState().completed, 1);
});

test('jump: all 30 platforms and six stages are reachable using normal input, with one final win', () => {
  const { game, results, scores } = harness();
  game.start();
  const stages = new Set([game.getState().stage]);
  for (let index = 1; index <= 30; index += 1) {
    const { landed } = jumpToCenter(game, index % 2 ? 1 / 60 : 1 / 30);
    assert.equal(landed.completed, index);
    assert.equal(landed.lastLanding.perfect, true);
    assert.equal(landed.lives, 3);
    stages.add(landed.stage);
    assert.equal(results.length, 0, 'the final landing animation precedes the result');
    if (index % 5 === 0) game.render(index);
  }
  assert.deepEqual([...stages], [1, 2, 3, 4, 5, 6]);
  assert.equal(game.getState().phase, 'cleared');
  const final = until(game, (state) => state.phase === 'ended');
  assert.equal(final.perfects, 30);
  assert.equal(final.combo, 30);
  assert.equal(final.nextPlatform, null);
  assert.equal(final.score, 1170);
  assert.ok(final.camera > 8000, 'the camera follows progression across the course');
  assert.ok(scores.every((score, index) => index === 0 || score > scores[index - 1]));
  assert.equal(results.length, 1);
  assert.equal(results[0].score, final.score);
  advance(game, 10);
  assert.equal(results.length, 1);
});

test('jump: invalid frame durations and destruction cannot corrupt state or cause a result', () => {
  const { game, results } = harness();
  game.start();
  game.pointerDown();
  const before = game.getState();
  for (const dt of [NaN, Infinity, -1, 0]) game.update(dt);
  assert.deepEqual(game.getState(), before);
  game.destroy();
  advance(game, 5);
  game.keyUp({ key: ' ', code: 'Space' });
  assert.equal(game.getState().phase, 'destroyed');
  assert.equal(results.length, 0);
});
