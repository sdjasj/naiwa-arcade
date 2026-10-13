import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame as createFlappy } from '../js/games/flappy.js';
import { createGame as createAngry } from '../js/games/angry.js';
import { createGame as createWhack } from '../js/games/whack.js';

// All tests are synchronous. Restore the random source even after a failed assertion.
function deterministic(run) {
  const originalRandom = Math.random;
  Math.random = () => 0.5;
  try {
    run();
  } finally {
    Math.random = originalRandom;
  }
}

function harness(createGame) {
  const scores = [];
  const sounds = [];
  const results = [];
  const statuses = [];
  const frogDraws = [];
  let frogsDrawn = 0;
  const noop = () => {};
  const ctx = new Proxy({
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    measureText: (value) => ({ width: String(value).length * 10 }),
  }, {
    get: (target, key) => key in target ? target[key] : noop,
    set: (target, key, value) => { target[key] = value; return true; },
  });
  const game = createGame({
    ctx,
    canvas: { width: 960, height: 560 },
    width: 960,
    height: 560,
    drawFrog: (_ctx, x, y, size, options) => {
      frogsDrawn += 1;
      frogDraws.push({ x, y, size, options });
    },
    audio: { play: (kind) => sounds.push(kind) },
    onScore: (score) => scores.push(score),
    onStatus: (status) => statuses.push(status),
    onEnd: (result) => results.push(result),
  });
  return { game, scores, sounds, results, statuses, frogDraws, frogsDrawn: () => frogsDrawn };
}

function advance(game, seconds, fps = 120) {
  for (let frame = 0; frame < Math.round(seconds * fps); frame += 1) game.update(1 / fps);
}

function until(game, predicate, maximumSeconds = 12, fps = 120) {
  for (let frame = 0; frame <= maximumSeconds * fps; frame += 1) {
    const state = game.getState();
    if (predicate(state)) return state;
    game.update(1 / fps);
  }
  assert.fail(`Expected state within ${maximumSeconds}s; final state: ${JSON.stringify(game.getState())}`);
}

function shoot(game, angle, power) {
  const radians = angle * Math.PI / 180;
  // Aim using the same drag a player makes on the visible slingshot.
  game.pointerDown({ x: 176, y: 342 });
  game.pointerMove({
    x: 176 - Math.cos(radians) * 112 * power,
    y: 342 + Math.sin(radians) * 112 * power,
  });
  assert.equal(game.getState().phase, 'dragging');
  game.pointerUp();
  assert.equal(game.getState().phase, 'flying');
}

for (const [name, factory, playingPhase] of [
  ['flappy', createFlappy, 'running'],
  ['angry', createAngry, 'ready'],
  ['whack', createWhack, 'playing'],
]) {
  test(`${name}: idle preview, start, restart and destroy`, () => deterministic(() => {
    const { game, results, scores, frogsDrawn } = harness(factory);
    assert.equal(game.getState().phase, 'idle');
    game.render(0);
    assert.ok(frogsDrawn() > 0, 'idle preview should draw its character');
    game.pointerDown({ x: 100, y: 100 });
    game.keyDown({ key: '1', code: 'Digit1' });
    advance(game, 0.2);
    assert.equal(game.getState().phase, 'idle', 'input must not start a round implicitly');

    game.start();
    assert.equal(game.getState().phase, playingPhase);
    assert.equal(game.getState().score, 0);
    game.render(0.3);
    advance(game, 0.2);
    game.start();
    assert.equal(game.getState().phase, playingPhase);
    assert.equal(game.getState().score, 0);
    assert.equal(scores.at(-1), 0);
    assert.equal(results.length, 0);

    game.destroy();
    advance(game, 2);
    assert.equal(results.length, 0, 'destroying a game must not create a result');
  }));
}

test('flappy: controlled taps pass pipes, report one point per pipe, then crash once', () => deterministic(() => {
  const { game, scores, sounds, results } = harness(createFlappy);
  game.start();
  for (let frame = 0; frame < 1500 && game.getState().score < 3; frame += 1) {
    const state = game.getState();
    assert.equal(state.phase, 'running');
    const nextPipe = state.pipes.find((pipe) => pipe.x + pipe.width + state.player.radius >= state.player.x);
    if (state.player.y > nextPipe.center + 20 && state.player.velocity > 0) {
      game.pointerDown({ x: 400, y: 300 });
    }
    game.update(1 / 120);
  }
  assert.equal(game.getState().score, 3);
  assert.deepEqual(scores, [0, 1, 2, 3]);
  assert.equal(sounds.filter((sound) => sound === 'score').length, 3);
  assert.equal(results.length, 0);

  until(game, (state) => state.phase === 'crashed', 3);
  assert.equal(results.length, 0, 'the squash/laugh animation should precede the result');
  game.render(12);
  until(game, (state) => state.phase === 'ended', 2);
  advance(game, 3);
  game.pointerDown({ x: 400, y: 300 });
  assert.equal(results.length, 1);
  assert.equal(results[0].score, 3);
  assert.ok(sounds.includes('hit'));
  assert.ok(sounds.includes('laugh'));

  game.start();
  assert.equal(game.getState().score, 0);
  assert.ok(game.getState().pipes.every((pipe) => !pipe.passed));
  until(game, (state) => state.phase === 'ended', 4);
  assert.equal(results.length, 2, 'restart permits exactly one new result');
}));

test('flappy: sustained high flight collides with the first pipe and held keys do not auto-flap', () => deterministic(() => {
  const { game, sounds, results } = harness(createFlappy);
  game.start();
  const initialVelocity = game.getState().player.velocity;
  game.keyDown({ key: ' ', code: 'Space', repeat: true });
  assert.equal(game.getState().player.velocity, initialVelocity);
  for (let frame = 0; frame < 600 && game.getState().phase === 'running'; frame += 1) {
    if (frame % 15 === 0) game.keyDown({ key: 'ArrowUp', code: 'ArrowUp' });
    game.update(1 / 120);
  }
  assert.equal(game.getState().phase, 'crashed');
  assert.ok(game.getState().player.y < 100, 'collision should be with an upper pipe, not the ground');
  assert.equal(game.getState().score, 0);
  assert.ok(sounds.includes('flap'));
  until(game, (state) => state.phase === 'ended', 2);
  assert.equal(results.length, 1);
}));

test('whack: keyboard and pointer hits build bonuses; repeated hits and empty swings reset combo', () => deterministic(() => {
  const { game, scores, sounds } = harness(createWhack);
  game.start();
  for (let hit = 0; hit < 6; hit += 1) {
    const state = until(game, (current) => current.holes.some((hole) => hole.state === 'up'), 2);
    const hole = state.holes.find((candidate) => candidate.state === 'up');
    if (hit % 2 === 0) game.keyDown({ key: String(hole.key), code: `Digit${hole.key}` });
    else game.pointerDown({ x: hole.x, y: hole.y - 50 });
    assert.equal(game.getState().hits, hit + 1);
    assert.equal(game.getState().combo, hit + 1);
    assert.equal(game.getState().holes[hole.key - 1].state, 'hit');
    game.render(hit);
  }
  assert.ok(game.getState().score > 60, 'successful streaks should award more than base hit points');
  assert.equal(scores.at(-1), game.getState().score);
  const lastHit = game.getState().holes.find((hole) => hole.state === 'hit');
  const scoreBefore = game.getState().score;
  game.keyDown({ key: String(lastHit.key) });
  assert.equal(game.getState().score, scoreBefore, 'one frog can only award points once');
  assert.equal(game.getState().combo, 0);
  game.pointerDown({ x: 10, y: 10 });
  assert.equal(game.getState().score, scoreBefore);
  assert.ok(sounds.includes('miss'));
  assert.equal(sounds.filter((sound) => sound === 'hit').length, 6);
}));

test('whack: escaped frogs laugh, a 30-second round ends once, restart resets all counters', () => deterministic(() => {
  const { game, sounds, results } = harness(createWhack);
  game.start();
  const hole = until(game, (state) => state.holes.some((candidate) => candidate.state === 'up'), 2)
    .holes.find((candidate) => candidate.state === 'up');
  game.keyDown({ key: String(hole.key), repeat: true });
  assert.equal(game.getState().hits, 0, 'held number keys must not repeatedly hammer');
  advance(game, 5);
  assert.ok(game.getState().escaped > 0);
  assert.ok(sounds.includes('laugh'));
  assert.equal(game.getState().score, 0);
  assert.equal(results.length, 0);
  assert.ok(game.getState().timeLeft > 24 && game.getState().timeLeft < 25);
  until(game, (state) => state.phase === 'ended', 26);
  assert.equal(game.getState().timeLeft, 0);
  assert.equal(results.length, 1);
  advance(game, 10);
  game.keyDown({ key: '5' });
  assert.equal(results.length, 1);
  assert.equal(game.getState().score, 0);

  game.start();
  const state = game.getState();
  assert.equal(state.timeLeft, 30);
  assert.equal(state.hits, 0);
  assert.equal(state.escaped, 0);
  assert.equal(state.bestCombo, 0);
  assert.ok(state.holes.every((candidate) => candidate.state === 'hidden'));
  advance(game, 30.1);
  assert.equal(results.length, 2);
}));

test('angry: untouched towers remain standing; keyboard aiming consumes only one shot', () => deterministic(() => {
  const { game, scores, results } = harness(createAngry);
  game.start();
  const initial = game.getState();
  advance(game, 60, 60);
  const settled = game.getState();
  assert.equal(settled.phase, 'ready');
  assert.equal(settled.targets, initial.targets);
  assert.equal(settled.bodies.length, initial.bodies.length);
  assert.deepEqual(scores, [0], 'standing still must not destroy targets or award points');
  for (let index = 0; index < settled.bodies.length; index += 1) {
    assert.ok(Math.abs(settled.bodies[index].y - initial.bodies[index].y) < 2);
    assert.equal(settled.bodies[index].hp, initial.bodies[index].hp);
  }
  game.keyDown({ key: 'ArrowUp' });
  game.keyDown({ key: 'ArrowRight' });
  assert.ok(game.getState().aimAngle > initial.aimAngle);
  assert.ok(game.getState().aimPower > initial.aimPower);
  game.keyDown({ key: ' ', repeat: true });
  assert.equal(game.getState().shots, 3);
  game.keyDown({ key: ' ' });
  assert.equal(game.getState().shots, 2);
  assert.equal(game.getState().phase, 'flying');
  game.keyDown({ key: ' ' });
  assert.equal(game.getState().shots, 2, 'a flight cannot consume another shot');
  assert.equal(results.length, 0);
  game.render(60);
}));

test('angry: three short shots exhaust ammunition and send one loss result', () => deterministic(() => {
  const { game, results } = harness(createAngry);
  game.start();
  for (let shot = 0; shot < 3; shot += 1) {
    shoot(game, 25, 0.18);
    const state = until(game, (current) => ['ready', 'ended'].includes(current.phase), 12, 60);
    assert.equal(state.shots, 2 - shot);
    assert.equal(state.targets, 2);
    assert.equal(state.score, 0);
    assert.equal(state.phase, shot === 2 ? 'ended' : 'ready');
  }
  assert.equal(results.length, 1);
  assert.equal(results[0].score, 0);
  advance(game, 10);
  game.pointerDown({ x: 176, y: 342 });
  game.pointerUp();
  assert.equal(results.length, 1);
  game.start();
  assert.equal(game.getState().level, 1);
  assert.equal(game.getState().shots, 3);
  assert.equal(game.getState().targets, 2);
  assert.equal(game.getState().score, 0);
}));

test('angry: cancelling a drag restores the launcher without consuming a shot, then dragging works again', () => deterministic(() => {
  const { game, sounds, results, frogDraws } = harness(createAngry);
  game.start();
  const initial = game.getState();
  game.pointerDown({ x: 176, y: 342 });
  game.pointerMove({ x: 80, y: 380 });
  assert.equal(game.getState().phase, 'dragging');
  assert.notEqual(game.getState().aimAngle, initial.aimAngle);
  game.pointerUp({ cancelled: true });
  const cancelled = game.getState();
  assert.equal(cancelled.phase, 'ready');
  assert.equal(cancelled.shots, initial.shots);
  assert.equal(cancelled.aimAngle, initial.aimAngle);
  assert.equal(cancelled.aimPower, initial.aimPower);
  assert.equal(cancelled.frog, null, 'cancellation must not create a projectile');
  assert.ok(!sounds.includes('launch'));
  assert.equal(results.length, 0);
  game.render(0);
  assert.equal(frogDraws[0].x, 176, 'the ready frog returns to the slingshot');
  assert.equal(frogDraws[0].y, 342);

  // A late release after cancellation must also leave ammunition untouched.
  game.pointerUp();
  assert.equal(game.getState().shots, initial.shots);
  shoot(game, 10, 0.95);
  assert.equal(game.getState().shots, initial.shots - 1);
  assert.ok(game.getState().frog);
  assert.equal(sounds.filter((sound) => sound === 'launch').length, 1);
}));

test('angry: real drag shots can clear all three levels and award one final victory', () => deterministic(() => {
  const { game, scores, sounds, results } = harness(createAngry);
  game.start();
  const visitedLevels = new Set([1]);
  for (let shot = 0; shot < 9 && game.getState().phase !== 'ended'; shot += 1) {
    // A strong low shot hits the supporting wood and follows through into the milk cartons.
    shoot(game, 10, 0.95);
    const state = until(game, (current) => ['ready', 'ended'].includes(current.phase), 12, 60);
    visitedLevels.add(state.level);
    game.render(shot);
    if (state.phase === 'ready' && state.targets >= 2 && state.shots === 3) {
      assert.equal(results.length, 0, 'a level transition must not end the complete game');
    }
  }
  const final = game.getState();
  assert.deepEqual([...visitedLevels], [1, 2, 3]);
  assert.equal(final.phase, 'ended');
  assert.equal(final.targets, 0);
  assert.ok(final.score >= 2000);
  assert.equal(results.length, 1);
  assert.equal(results[0].score, final.score);
  assert.ok(scores.every((score, index) => index === 0 || score > scores[index - 1]));
  assert.ok(sounds.includes('launch'));
  assert.ok(sounds.includes('laugh'));
  assert.ok(sounds.includes('hit'));
  assert.ok(sounds.includes('win'));
  advance(game, 10);
  assert.equal(results.length, 1);
}));
