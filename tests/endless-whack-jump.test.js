import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame as createWhack } from '../js/games/whack.js';
import { createGame as createJump } from '../js/games/jump.js';

function harness(factory, options = {}) {
  const results = [];
  const labels = [];
  const sounds = [];
  const noop = () => {};
  const ctx = new Proxy({
    createLinearGradient: () => ({ addColorStop: noop }),
    fillText: (label) => labels.push(String(label)),
    measureText: (label) => ({ width: String(label).length * 10 }),
  }, {
    get: (target, key) => key in target ? target[key] : noop,
    set: (target, key, value) => { target[key] = value; return true; },
  });
  const game = factory({
    ctx, width: 960, height: 560, drawFrog() {},
    audio: { play: (kind) => sounds.push(kind) },
    onEnd: (result) => results.push(result),
    ...options,
  });
  return { game, results, labels, sounds };
}

function advance(game, seconds, input = () => {}) {
  for (let frame = 0; frame < Math.round(seconds * 120); frame += 1) {
    input(game);
    game.update(1 / 120);
  }
}

function until(game, predicate, seconds = 6) {
  for (let frame = 0; frame < seconds * 120; frame += 1) {
    const state = game.getState();
    if (predicate(state)) return state;
    game.update(1 / 120);
  }
  assert.fail(`State condition not reached; current phase ${game.getState().phase}`);
}

function catchAllFrogs(game) {
  for (const hole of game.getState().holes.filter((candidate) => candidate.state === 'up')) {
    game.keyDown({ key: String(hole.key) });
  }
}

function jumpToNextCenter(game) {
  const state = game.getState();
  const target = state.platforms.find((platform) => platform.index === state.nextPlatform);
  assert.ok(target, 'the next platform must always exist in the active window');
  game.pointerDown();
  for (let frame = 0; frame < 170; frame += 1) {
    if (game.getState().landingPreview.x >= target.center) break;
    game.update(1 / 120);
  }
  const preview = game.getState().landingPreview;
  assert.ok(preview.success && preview.perfect, `platform ${target.index} center must be reachable`);
  game.pointerUp();
  const landed = until(game, (current) => current.phase !== 'airborne', 3);
  assert.equal(landed.checkpoint, target.index);
  assert.equal(landed.lastLanding.perfect, true);
  assert.ok(Math.abs(landed.lastLanding.x - preview.x) < 1e-7);
  return landed;
}

test('endless whack: five hearts, no 30-second finish, and difficulty reaches a stable cap', () => {
  const { game, results, labels } = harness(createWhack, { endless: true, difficulty: 'hard' });
  game.start();
  assert.equal(game.getState().endless, true);
  assert.equal(game.getState().lives, 5);
  assert.equal(game.getState().timeLeft, null);
  advance(game, 31, catchAllFrogs);
  assert.equal(game.getState().phase, 'playing');
  assert.ok(game.getState().survivalTime > 30);
  assert.ok(game.getState().score > 0);
  assert.equal(results.length, 0);
  assert.equal(game.getState().lives, 5);
  advance(game, 64, catchAllFrogs);
  const capped = game.getState();
  assert.equal(capped.intensity, 1);
  advance(game, 95, catchAllFrogs);
  const later = game.getState();
  assert.equal(later.intensity, capped.intensity);
  assert.equal(later.phase, 'playing');
  assert.equal(later.lives, 5);
  assert.ok(later.holes.every((hole) => hole.duration >= 0.6), 'even hard mode has a bounded reaction window');
  assert.equal(later.holes.length, 9);
  assert.equal(results.length, 0);
  game.render(190);
  assert.ok(labels.some((label) => label.includes('无限蛙田')));
  assert.ok(labels.some((label) => label.includes('存活')));
});

test('endless whack: gold frogs add points and restore one heart without exceeding five', () => {
  const { game, results } = harness(createWhack);
  game.start({ endless: true });
  game.pointerDown({ x: 10, y: 10 });
  game.pointerDown({ x: 10, y: 10 });
  assert.equal(game.getState().lives, 3);
  let previousGolden = 0;
  for (let frame = 0; frame < 25 * 120 && previousGolden < 3; frame += 1) {
    catchAllFrogs(game);
    game.update(1 / 120);
    const state = game.getState();
    if (state.goldenHits > previousGolden) {
      previousGolden = state.goldenHits;
      assert.equal(state.lives, Math.min(5, 3 + previousGolden));
    }
  }
  assert.equal(previousGolden, 3);
  assert.equal(game.getState().lives, 5);
  assert.ok(game.getState().score > game.getState().hits * 10);
  assert.equal(results.length, 0);
});

test('endless whack: escaping frogs and empty swings lose lives, with one final result and a normal-mode retry', () => {
  const { game, results } = harness(createWhack, { endless: true });
  game.start();
  const escaped = until(game, (state) => state.escaped > 0);
  assert.equal(escaped.lives, 4);
  for (let index = 0; index < 4; index += 1) game.pointerDown({ x: 10, y: 10 });
  assert.equal(game.getState().phase, 'ended');
  assert.equal(game.getState().lives, 0);
  assert.equal(results.length, 1);
  assert.equal(results[0].endless, true);
  assert.ok(results[0].message.includes('5 颗心'));
  const survival = game.getState().survivalTime;
  advance(game, 40);
  game.pointerDown({ x: 10, y: 10 });
  assert.equal(results.length, 1);
  assert.equal(game.getState().survivalTime, survival);

  game.start({ endless: false });
  assert.equal(game.getState().endless, false);
  assert.equal(game.getState().lives, null);
  assert.equal(game.getState().timeLeft, 30);
  advance(game, 30.1);
  assert.equal(results.length, 2);
  assert.equal(results[1].endless, false);
});

test('endless whack: ignoring all frogs eventually ends naturally rather than running with negative hearts', () => {
  const { game, results } = harness(createWhack);
  game.start({ endless: true });
  advance(game, 12);
  assert.equal(game.getState().phase, 'ended');
  assert.equal(game.getState().lives, 0);
  assert.equal(game.getState().escaped, 5);
  assert.equal(results.length, 1);
});

test('endless jump: 500 perfect jumps cross the old finish, remain reachable, and use a bounded platform window', () => {
  const { game, results, labels } = harness(createJump, { endless: true });
  game.start();
  assert.equal(game.getState().totalPlatforms, null);
  let priorScore = 0;
  for (let index = 1; index <= 500; index += 1) {
    const landed = jumpToNextCenter(game);
    assert.equal(landed.endless, true);
    assert.equal(landed.phase, 'ready');
    assert.equal(landed.lives, 3);
    assert.equal(landed.completed, index);
    assert.equal(landed.stage, Math.floor(index / 5) + 1);
    assert.equal(landed.nextPlatform, index + 1);
    assert.equal(landed.platformWindowStart, Math.max(0, index - 2));
    assert.ok(landed.platforms.length <= 10, 'platform count must not grow with distance');
    assert.ok(landed.platforms.every((platform) => platform.width >= 96));
    assert.ok(landed.score > priorScore);
    priorScore = landed.score;
    assert.equal(results.length, 0, `platform ${index} must not trigger a finite campaign result`);
    if (index === 30 || index === 300) game.render(index);
  }
  const final = game.getState();
  assert.equal(final.perfects, 500);
  assert.equal(final.platforms.length, 10);
  assert.equal(final.platforms[0].index, 498);
  assert.equal(final.platforms.at(-1).index, 507);
  assert.ok(final.score > 15000);
  assert.ok(labels.some((label) => label.includes('无限')));
  assert.ok(!labels.some((label) => /\/ 30|\/ 6/.test(label)), 'endless HUD must not imply a fixed finish');
});

test('endless jump: checkpoints recover after old platforms are pruned; three misses end once and normal mode resets', () => {
  const { game, results } = harness(createJump);
  game.start({ endless: true });
  for (let index = 0; index < 55; index += 1) jumpToNextCenter(game);
  const checkpoint = game.getState();
  const platform = checkpoint.platforms.find((candidate) => candidate.index === checkpoint.checkpoint);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    game.pointerDown();
    advance(game, 0.25);
    assert.equal(game.getState().landingPreview.direction, 'short');
    game.pointerUp();
    const missed = until(game, (state) => state.phase === 'missed');
    assert.equal(missed.lives, 2 - attempt);
    assert.equal(missed.score, checkpoint.score);
    advance(game, 0.3);
    assert.equal(game.getState().lives, 2 - attempt);
    const restored = until(game, (state) => ['ready', 'ended'].includes(state.phase));
    assert.equal(restored.completed, 55);
    assert.equal(restored.platforms.length, 10);
    if (attempt < 2) {
      assert.equal(restored.phase, 'ready');
      assert.equal(restored.player.x, platform.center);
      assert.equal(restored.player.y + restored.player.footOffset, platform.top);
      assert.equal(restored.nextPlatform, 56);
    }
  }
  assert.equal(results.length, 1);
  assert.equal(results[0].endless, true);
  assert.equal(results[0].completed, 55);
  assert.equal(results[0].won, false);
  assert.ok(results[0].message.includes('无限'));
  advance(game, 10);
  assert.equal(results.length, 1);
  game.start({ endless: false });
  const restarted = game.getState();
  assert.equal(restarted.endless, false);
  assert.equal(restarted.totalPlatforms, 30);
  assert.equal(restarted.platforms.length, 31);
  assert.equal(restarted.platformWindowStart, 0);
  assert.equal(restarted.completed, 0);
  assert.equal(restarted.score, 0);
  assert.equal(restarted.lives, 3);
});

test('endless jump: cancellation and restart preserve the selected mode without launching', () => {
  const { game, results } = harness(createJump, { endless: true });
  game.start();
  game.pointerDown();
  advance(game, 0.6);
  game.cancelInput();
  game.pointerUp();
  assert.equal(game.getState().phase, 'ready');
  assert.equal(game.getState().charge, 0);
  game.start();
  assert.equal(game.getState().endless, true);
  assert.equal(game.getState().completed, 0);
  assert.equal(game.getState().platforms.length, 8);
  assert.equal(results.length, 0);
});
