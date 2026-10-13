import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, LEVELS } from '../js/games/angry.js';

// These input-only routes are test fixtures, not in-game hints or state overrides.
// Each pair is an angle in degrees and a pull strength from zero to one.
const ROUTES = [
  [[5, 0.95]],
  [[40, 0.75], [5, 0.55]],
  [[5, 0.95]],
  [[35, 0.75], [45, 0.85], [5, 0.55]],
  [[10, 1]],
  [[70, 0.95], [5, 0.85]],
  [[15, 0.95], [60, 0.95], [5, 0.55]],
  [[40, 0.75], [45, 0.75], [5, 0.55]],
  [[60, 0.75], [15, 0.95]],
  [[55, 0.75], [10, 1]],
  [[50, 0.75], [40, 0.75], [5, 0.55]],
  [[60, 0.95], [5, 0.55]],
];

function setup(progress) {
  const results = [], saves = [];
  const game = createGame({
    ctx: {}, drawFrog() {}, progress,
    onEnd: result => results.push(result),
    onProgress: next => saves.push(next),
  });
  return { game, results, saves };
}

function advanceUntil(game, predicate, seconds = 12, dt = 1 / 60) {
  for (let frame = 0; frame < Math.ceil(seconds / dt); frame++) {
    game.update(dt);
    const state = game.getState();
    if (predicate(state)) return state;
  }
  assert.fail(`Game did not reach the expected state: ${JSON.stringify(game.getState())}`);
}

function shoot(game, angle, power, dt = 1 / 60) {
  assert.equal(game.getState().phase, 'ready', 'a shot uses the normal ready input flow');
  const radians = angle * Math.PI / 180;
  const length = 112 * power;
  game.pointerDown({ x: 176, y: 342 });
  game.pointerMove({ x: 176 - Math.cos(radians) * length, y: 342 + Math.sin(radians) * length });
  game.pointerUp();
  assert.equal(game.getState().phase, 'flying');
  return advanceUntil(game, state => ['ready', 'levelclear', 'ended'].includes(state.phase), 12, dt);
}

function solve(game, level, dt = 1 / 60) {
  for (const [angle, power] of ROUTES[level - 1]) shoot(game, angle, power, dt);
  const state = game.getState();
  assert.equal(state.phase, 'levelclear', `level ${level} is solved using legal drag inputs`);
  assert.equal(state.targets, 0);
  return state;
}

test('angry levels: twelve named authored stages expose usable picker metadata', () => {
  assert.equal(LEVELS.length, 12);
  assert.equal(new Set(LEVELS.map(level => level.name)).size, 12);
  for (const level of LEVELS) {
    assert.ok(level.name.length > 0 && level.hint.length > 0);
    assert.ok(level.shots >= 3 && level.shots <= 5);
  }
  assert.deepEqual(LEVELS.slice(0, 3).map(level => level.shots), [3, 3, 3]);
});

for (let level = 1; level <= LEVELS.length; level++) {
  test(`angry level ${level}: ${LEVELS[level - 1].name} remains stable for a minute without input`, () => {
    const { game, results, saves } = setup();
    game.start({ level });
    const initial = game.getState();
    for (let frame = 0; frame < 60 * 60; frame++) game.update(1 / 60);
    const state = game.getState();
    assert.equal(state.phase, 'ready');
    assert.equal(state.level, level);
    assert.equal(state.totalLevels, 12);
    assert.equal(state.levelName, LEVELS[level - 1].name);
    assert.equal(state.targets, initial.targets);
    assert.equal(state.bodies.length, initial.bodies.length);
    assert.equal(state.score, 0, 'untouched buildings do not damage themselves');
    assert.equal(state.shots, LEVELS[level - 1].shots);
    assert.ok(state.bodies.every(body => Number.isFinite(body.x) && Number.isFinite(body.y)));
    assert.equal(results.length, 0);
    assert.equal(saves.length, 0);
  });

  test(`angry level ${level}: real drags solve the stage at both 60 and 120 Hz`, () => {
    for (const dt of [1 / 60, 1 / 120]) {
      const { game, results, saves } = setup();
      game.start({ level });
      const state = solve(game, level, dt);
      assert.equal(state.shots, LEVELS[level - 1].shots - ROUTES[level - 1].length);
      assert.ok(state.stars >= 1 && state.stars <= 3);
      assert.equal(saves.length, 1, 'each cleared stage saves progress once');
      assert.equal(saves[0].unlocked, Math.min(12, level + 1));
      assert.equal(saves[0].stars[level], state.stars);
      assert.equal(results.length, 0, 'clearing a stage first presents its star result');
      if (level < LEVELS.length) {
        const next = advanceUntil(game, value => value.level === level + 1, 3, dt);
        assert.equal(next.shots, LEVELS[level].shots);
        assert.equal(results.length, 0, 'intermediate stages continue the campaign');
      } else {
        advanceUntil(game, value => value.phase === 'ended', 3, dt);
        assert.equal(results.length, 1);
        assert.equal(results[0].won, true);
        assert.equal(results[0].level, 12);
      }
    }
  });
}

test('angry campaign: all twelve levels advance, save stars and emit one final victory', () => {
  const { game, results, saves } = setup();
  game.start();
  for (let level = 1; level <= LEVELS.length; level++) {
    assert.equal(game.getState().level, level);
    solve(game, level);
    if (level < LEVELS.length) advanceUntil(game, state => state.level === level + 1, 3);
  }
  advanceUntil(game, state => state.phase === 'ended', 3);
  for (let frame = 0; frame < 60; frame++) game.update(1 / 60);
  assert.equal(results.length, 1);
  assert.equal(results[0].won, true);
  assert.equal(results[0].level, 12);
  assert.equal(saves.length, 12);
  assert.deepEqual(Object.keys(game.getState().progress.stars), Array.from({ length: 12 }, (_, i) => String(i + 1)));
  assert.equal(game.getState().progress.unlocked, 12);
  for (let i = 1; i < saves.length; i++) assert.ok(saves[i].unlocked >= saves[i - 1].unlocked);
});

test('angry progress: weaker replays preserve best stars and previously unlocked stages', () => {
  const input = { unlocked: 8, stars: { 1: 3, 4: 2 } };
  const { game, saves } = setup(input);
  game.start({ level: 1 });
  shoot(game, 0, 0.2);
  const state = solve(game, 1);
  assert.equal(state.stars, 2, 'using an extra shot lowers the current run rating');
  assert.equal(state.progress.stars[1], 3, 'the saved best is monotone');
  assert.equal(state.progress.stars[4], 2);
  assert.equal(state.progress.unlocked, 8);
  assert.deepEqual(saves[0], input);
  assert.deepEqual(input, { unlocked: 8, stars: { 1: 3, 4: 2 } }, 'caller-owned progress is not mutated');
  game.start({ level: 1 });
  solve(game, 1);
  assert.equal(saves[1].stars[1], 3);
});

test('angry progress: a final-ammo clear awards one star and unlocks the next stage', () => {
  const { game, saves } = setup();
  game.start();
  shoot(game, 0, 0.2);
  shoot(game, 0, 0.2);
  solve(game, 1);
  assert.equal(game.getState().stars, 1);
  assert.deepEqual(saves[0], { unlocked: 2, stars: { 1: 1 } });
});

test('angry selected-stage retry: failure reports its level and start restores that stage', () => {
  const { game, results, saves } = setup({ unlocked: 9, stars: { 1: 3 } });
  game.start({ level: 7 });
  for (let i = 0; i < LEVELS[6].shots; i++) shoot(game, 0, 0.2);
  assert.equal(results.length, 1);
  assert.equal(results[0].level, 7);
  assert.equal(results[0].won, false);
  assert.equal(saves.length, 0);
  game.start({ level: results[0].level });
  const state = game.getState();
  assert.equal(state.level, 7);
  assert.equal(state.levelName, LEVELS[6].name);
  assert.equal(state.shots, 4);
  assert.equal(state.score, 0);
  assert.equal(state.phase, 'ready');
  assert.deepEqual(state.progress, { unlocked: 9, stars: { 1: 3 } });
});

test('angry selection and cancellation: bound selected levels and preserve ammo on cancelled drags', () => {
  const { game } = setup();
  game.start({ level: 999 });
  assert.equal(game.getState().level, 12);
  const initial = game.getState();
  game.pointerDown({ x: 176, y: 342 });
  game.pointerMove({ x: 70, y: 420 });
  game.pointerUp({ x: -1, y: -1, cancelled: true });
  const cancelled = game.getState();
  assert.equal(cancelled.phase, 'ready');
  assert.equal(cancelled.shots, 5);
  assert.equal(cancelled.aimAngle, initial.aimAngle);
  assert.equal(cancelled.aimPower, initial.aimPower);
  assert.equal(cancelled.frog, null);
  game.start({ level: -8 });
  assert.equal(game.getState().level, 1);
});
