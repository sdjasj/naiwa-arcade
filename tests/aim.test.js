import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../js/games/aim.js';

function harness(options = {}) {
  const scores = [], results = [], sounds = [], draws = [], messages = [];
  const noop = () => {};
  const ctx = new Proxy({
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    measureText: text => ({ width: String(text).length * 8 }),
  }, {
    get: (target, key) => key in target ? target[key] : noop,
    set: (target, key, value) => { target[key] = value; return true; },
  });
  const game = createGame({ ctx, width: 960, height: 560,
    drawFrog: (...args) => draws.push(args), audio: { play: kind => sounds.push(kind) },
    onScore: score => scores.push(score), onEnd: result => results.push(result), onStatus: text => messages.push(text), ...options });
  return { game, scores, results, sounds, draws, messages };
}
function advance(game, seconds, step = 1 / 120) {
  let remaining = seconds;
  while (remaining > 1e-9) {
    const dt = Math.min(step, remaining); game.update(dt); remaining -= dt;
  }
}
function ready(game, options) { game.start(options); game.update(3); assert.equal(game.getState().phase, 'playing'); }
function click(game, point = game.getState().targets[0].screen) { game.pointerDown(point); game.pointerUp(point); }
function aimAt(game, target = game.getState().targets[0]) {
  const { view } = game.getState();
  const yaw = Math.atan2(target.x, target.z);
  const pitch = Math.atan2(target.y, Math.hypot(target.x, target.z));
  game.look((yaw - view.yaw) / (0.0018 * view.sensitivity), -(pitch - view.pitch) / (0.0018 * view.sensitivity));
  return game.getState().targets.find(item => item.id === target.id);
}
function near(value, expected, tolerance = 1e-7) { assert.ok(Math.abs(value - expected) <= tolerance, `${value} should be near ${expected}`); }
function withRandom(value, work) {
  const random = Math.random; Math.random = typeof value === 'function' ? value : () => value;
  try { return work(); } finally { Math.random = random; }
}

test('aim: idle preview uses frog art, cannot shoot/finish, and render does not advance simulation', () => {
  const { game, draws, scores, results } = harness();
  const initial = game.getState();
  game.render(0); game.render(500);
  assert.ok(draws.length >= 2);
  assert.deepEqual(game.getState(), initial);
  click(game); game.update(100);
  assert.equal(game.finish(), false);
  assert.equal(game.getState().phase, 'idle');
  assert.equal(game.getState().stats.shots, 0);
  assert.deepEqual(scores, []); assert.deepEqual(results, []);
});

test('aim: the full three-second countdown neither scores nor carries a held trigger into training', () => {
  const { game } = harness({ aimDrill: 'track' });
  game.start(); game.pointerDown(game.getState().targets[0].screen);
  advance(game, 2.9);
  assert.equal(game.getState().phase, 'countdown'); near(game.getState().countdown, 0.1);
  assert.equal(game.getState().stats.elapsed, 0); assert.equal(game.getState().score, 0);
  advance(game, 0.1);
  assert.equal(game.getState().phase, 'playing'); assert.equal(game.getState().firing, false);
  advance(game, 0.2);
  assert.equal(game.getState().stats.shots, 0); assert.equal(game.getState().stats.trackingFireTime, 0);
  game.pointerDown(game.getState().targets[0].screen); game.update(1 / 120);
  assert.ok(game.getState().score > 0);
});

test('aim grid: genuine clicks replace one target, preserve three distinct slots, and misses break combo', () => {
  const { game, scores } = harness(); ready(game); advance(game, 0.3);
  const initial = game.getState(), target = initial.targets[0];
  game.pointerMove(target.screen); advance(game, 0.3);
  assert.equal(game.getState().stats.shots, 0, 'hovering alone never fires');
  click(game, target.screen);
  const hit = game.getState();
  assert.equal(hit.score, 100); assert.equal(scores.at(-1), 100);
  assert.equal(hit.stats.shots, 1); assert.equal(hit.stats.hits, 1); assert.equal(hit.combo, 1);
  assert.equal(hit.targets.length, 3); assert.equal(new Set(hit.targets.map(t => t.slot)).size, 3);
  assert.equal(hit.targets.some(t => t.id === target.id), false);
  assert.equal(hit.targets.filter(t => initial.targets.some(old => old.id === t.id)).length, 2);
  advance(game, 0.09);
  const fresh = game.getState().targets[0].screen;
  click(game, { x: fresh.x + fresh.r + 1, y: fresh.y });
  assert.equal(game.getState().stats.misses, 1); assert.equal(game.getState().stats.accuracy, 50);
  assert.equal(game.getState().combo, 0); assert.equal(game.getState().stats.bestCombo, 1);
  assert.equal(game.getState().score, 100);
});

test('aim grid: duplicate held inputs and clicks within one simulation instant cannot farm shots', () => {
  const { game } = harness(); ready(game);
  const point = game.getState().targets[0].screen;
  game.pointerDown(point); game.pointerDown(point); game.pointerUp(point);
  for (let i = 0; i < 100; i++) click(game);
  assert.equal(game.getState().stats.shots, 1); assert.equal(game.getState().score, 100);
  advance(game, 0.08); click(game);
  assert.equal(game.getState().stats.shots, 2); assert.equal(game.getState().stats.hits, 2);
});

test('aim grid: switch time measures successive hits rather than the lifetime of an untouched static target', () => {
  const { game } = harness(); ready(game);
  const initial = game.getState().targets;
  advance(game, 1); click(game, initial[0].screen);
  advance(game, 0.25); click(game, initial[1].screen);
  assert.equal(game.getState().stats.hits, 2);
  near(game.getState().stats.averageReactionMs, 625);
});

test('aim precision: hits create a new acquisition at alternating depths and measure each reaction interval', () => withRandom(0.5, () => {
  const { game } = harness({ aimDrill: 'precision' }); ready(game);
  const first = game.getState().targets[0]; advance(game, 0.5); click(game, first.screen);
  const second = game.getState().targets[0];
  assert.notEqual(first.id, second.id); assert.equal(first.z, 9.5); assert.equal(second.z, 16.8);
  assert.ok(second.screen.r < first.screen.r);
  assert.ok(Math.abs(first.screen.x - second.screen.x) > 50, 'even repeated random numbers require a fresh acquisition');
  advance(game, 0.2); click(game, second.screen);
  assert.equal(game.getState().targets[0].z, 12.6); assert.equal(game.getState().targets.length, 1);
  near(game.getState().stats.averageReactionMs, 350);
  assert.equal(game.getState().score, 300);
}));

test('aim FPS: camera look projects fixed world positions, reverses correctly, and ray hits require center alignment', () => {
  const { game } = harness({ aimInput: 'fps' }); ready(game);
  const initial = game.getState(); const target = initial.targets[0];
  game.pointerMove(target.screen); click(game, target.screen);
  assert.equal(game.getState().stats.misses, 1, 'screen click does not teleport the FPS crosshair');
  game.look(50, 25);
  const turned = game.getState();
  assert.ok(turned.view.yaw > 0 && turned.view.pitch < 0);
  assert.ok(turned.targets[0].screen.x < target.screen.x);
  assert.ok(turned.targets[0].screen.y < target.screen.y);
  assert.deepEqual(turned.targets[0].world, target.world);
  assert.deepEqual(turned.crosshair, { x: 480, y: 280 });
  game.look(-50, -25);
  near(game.getState().targets[0].screen.x, target.screen.x); near(game.getState().targets[0].screen.y, target.screen.y);
  const aimed = aimAt(game, target); near(aimed.screen.x, 480); near(aimed.screen.y, 280);
  advance(game, 0.08); click(game, { x: 0, y: 0 });
  assert.equal(game.getState().stats.hits, 1); assert.equal(game.getState().stats.shots, 2);
});

test('aim FPS: every difficulty, grid slot, far/near edge spawn, and tracking path can be centered within camera limits', () => {
  let seed = 12093;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  withRandom(random, () => {
  for (const difficulty of ['easy', 'normal', 'hard']) {
    const { game: grid } = harness({ aimInput: 'fps', difficulty }); ready(grid);
    const seenSlots = new Set();
    // A fixed spawn sequence makes the edge coverage repeatable across runs.
    for (let i = 0; i < 90; i++) {
      const target = grid.getState().targets[i % 3]; seenSlots.add(target.slot);
      const aimed = aimAt(grid, target); near(aimed.screen.x, 480); near(aimed.screen.y, 280);
      const before = grid.getState().stats.hits;
      click(grid); assert.equal(grid.getState().stats.hits, before + 1); grid.update(0.08);
    }
    assert.equal(seenSlots.size, 15, 'all authored grid locations must actually spawn and be hit');
    for (const random of [0, 0.999999]) withRandom(random, () => {
      const { game } = harness({ aimInput: 'fps', aimDrill: 'precision', difficulty }); ready(game);
      for (let i = 0; i < 12; i++) {
        const target = game.getState().targets[0], aimed = aimAt(game, target);
        near(aimed.screen.x, 480); near(aimed.screen.y, 280);
        click(game); assert.equal(game.getState().stats.hits, i + 1); game.update(0.08);
      }
    });
    const { game: tracking } = harness({ aimInput: 'fps', aimDrill: 'track', difficulty, endless: true }); ready(tracking);
    for (let i = 0; i < 180; i++) {
      tracking.update(0.137);
      const centered = aimAt(tracking); near(centered.screen.x, 480); near(centered.screen.y, 280);
      assert.equal(centered.screen.visible, true);
      tracking.pointerDown({ x: 0, y: 0 }); tracking.update(1 / 120); tracking.pointerUp({});
    }
    assert.equal(tracking.getState().stats.hits, 180);
  }
  });
});

test('aim: sensitivity changes only FPS camera gain and invalid values cannot corrupt projections', () => {
  const { game } = harness({ aimInput: 'fps' }); ready(game);
  game.look(10, 0); const first = game.getState().view.yaw;
  game.look(-10, 0); game.setSensitivity(2); game.look(10, 0);
  near(game.getState().view.yaw, first * 2);
  assert.equal(game.setSensitivity(Infinity), 2);
  assert.equal(game.setSensitivity(900), 3); assert.equal(game.setSensitivity(-1), 0.2);
  game.look(1e6, -1e6);
  const edge = game.getState(); assert.equal(edge.view.yaw, 0.32); assert.equal(edge.view.pitch, 0.15);
  assert.ok(edge.targets.every(t => t.screen.visible));
  game.look(NaN, 4); game.update(NaN); game.update(-1);
  assert.deepEqual(game.getState(), edge);
});

test('aim: difficulty changes real target size and tracking speed without changing per-hit points', () => {
  for (const aimDrill of ['grid', 'precision', 'track']) withRandom(0.5, () => {
    const easy = harness({ aimDrill, difficulty: 'easy' }).game;
    const hard = harness({ aimDrill, difficulty: 'hard' }).game;
    ready(easy); ready(hard);
    assert.ok(easy.getState().targets[0].r > hard.getState().targets[0].r);
    assert.ok(easy.getState().targets[0].screen.r > hard.getState().targets[0].screen.r);
    if (aimDrill === 'track') {
      const start = easy.getState().targets[0].x;
      easy.update(0.2); hard.update(0.2);
      assert.ok(Math.abs(hard.getState().targets[0].x - start) > Math.abs(easy.getState().targets[0].x - start));
    } else {
      click(easy); click(hard); assert.equal(easy.getState().score, hard.getState().score);
    }
  });
});

test('aim tracking: firing off-target only counts fire time, following awards time-based points, and release/cancel stops', () => {
  const { game } = harness({ aimDrill: 'track' }); ready(game);
  game.pointerDown({ x: 30, y: 120 }); advance(game, 0.5);
  assert.equal(game.getState().score, 0); near(game.getState().stats.trackingFireTime, 0.5);
  for (let i = 0; i < 120; i++) { game.pointerMove(game.getState().targets[0].screen); game.update(1 / 120); }
  const followed = game.getState();
  near(followed.stats.trackingHitTime, 1); near(followed.stats.trackingFireTime, 1.5);
  assert.equal(followed.score, 120); near(followed.stats.accuracy, 100 / 1.5);
  assert.equal(followed.stats.hits, 1); assert.equal(followed.stats.shots, 1);
  game.pointerUp({}); advance(game, 1);
  near(game.getState().stats.trackingFireTime, 1.5); assert.equal(game.getState().score, 120);
  game.pointerDown({ x: 30, y: 120 }); advance(game, 0.25); game.cancelInput();
  const cancelled = game.getState(); assert.equal(cancelled.stats.misses, 1); assert.equal(cancelled.firing, false);
  game.render(999); game.render(1000); assert.deepEqual(game.getState(), cancelled, 'pause rendering is inert');
  advance(game, 0.5); near(game.getState().stats.trackingFireTime, 1.75);
});

test('aim tracking: 15 Hz and 120 Hz simulation award the same coverage and points for identical held input', () => {
  const slow = harness({ aimDrill: 'track' }).game, fast = harness({ aimDrill: 'track' }).game;
  ready(slow); ready(fast);
  slow.pointerDown(slow.getState().targets[0].screen); fast.pointerDown(fast.getState().targets[0].screen);
  advance(slow, 2, 1 / 15); advance(fast, 2, 1 / 120);
  near(slow.getState().stats.trackingFireTime, 2);
  near(slow.getState().stats.trackingHitTime, fast.getState().stats.trackingHitTime);
  assert.equal(slow.getState().score, fast.getState().score);
  assert.ok(slow.getState().score > 0 && slow.getState().score < 240, 'stationary pointer loses the moving ball');
});

test('aim: classic ends once after 60 effective seconds, excluding countdown and without simulation after end', () => {
  const { game, results } = harness(); game.start(); game.update(3 + 59.8);
  assert.equal(game.getState().phase, 'playing'); near(game.getState().elapsed, 59.8);
  game.update(0.3); assert.equal(game.getState().phase, 'ended'); assert.equal(game.getState().elapsed, 60);
  assert.equal(results.length, 1); assert.equal(results[0].won, true); assert.match(results[0].message, /60.0 秒/);
  const ended = game.getState(); game.update(10); click(game); game.finish();
  assert.equal(results.length, 1); assert.equal(game.getState().stats.shots, 0);
  assert.equal(game.getState().elapsed, ended.elapsed);
});

test('aim: infinite sessions pass the classic endpoint, remain bounded, and finish only when requested', () => {
  const { game, results } = harness({ endless: true }); ready(game);
  for (let i = 0; i < 1800; i++) { click(game); game.update(0.08); }
  const active = game.getState();
  assert.equal(active.phase, 'playing'); assert.ok(active.elapsed > 120);
  assert.equal(active.targets.length, 3); assert.ok(active.particles <= 96); assert.ok(active.rings <= 8);
  assert.equal(active.stats.hits, 1800); assert.equal(results.length, 0);
  assert.equal(game.finish(), true); assert.equal(game.finish(), false); assert.equal(results.length, 1);
  assert.equal(results[0].score, active.score); assert.match(results[0].title, /无限/);
});

test('aim: restarting resets all scores, timing, shots, held input and view while applying new options', () => {
  const { game, results, scores } = harness({ aimDrill: 'track', endless: true }); ready(game);
  game.pointerDown(game.getState().targets[0].screen); game.update(0.1); game.finish();
  game.start({ aimDrill: 'precision', aimInput: 'fps', difficulty: 'hard', endless: false, sensitivity: 2 });
  const state = game.getState();
  assert.equal(state.phase, 'countdown'); assert.equal(state.countdown, 3); assert.equal(state.elapsed, 0);
  assert.equal(state.score, 0); assert.equal(scores.at(-1), 0); assert.equal(state.firing, false);
  assert.equal(state.aimDrill, 'precision'); assert.equal(state.aimInput, 'fps'); assert.equal(state.difficulty, 'hard');
  assert.equal(state.endless, false); assert.equal(state.sensitivity, 2); assert.equal(state.targets.length, 1);
  assert.equal(state.stats.shots, 0); assert.equal(state.stats.hits, 0); assert.equal(state.stats.misses, 0);
  assert.equal(state.stats.trackingFireTime, 0); assert.equal(state.stats.averageReactionMs, 0);
  assert.deepEqual(state.crosshair, { x: 480, y: 280 }); assert.equal(state.view.yaw, 0); assert.equal(state.view.pitch, 0);
  state.targets[0].x = 999; state.targets[0].world.x = 888; state.targets[0].screen.x = 777;
  state.stats.hits = 999; state.view.yaw = 999;
  assert.ok(game.getState().targets[0].x < 3); assert.equal(game.getState().stats.hits, 0); assert.equal(game.getState().view.yaw, 0);
  assert.equal(game.finish(), true, 'a started countdown can be manually settled'); assert.equal(results.length, 2);
  game.destroy(); assert.equal(game.start(), false); game.update(100); assert.equal(results.length, 2);
});
