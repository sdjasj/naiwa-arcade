import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../js/games/survivor.js';

const STEP = 1 / 60;

function seeded(seed, run) {
  const original = Math.random;
  Math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  try { return run(); } finally { Math.random = original; }
}

function harness(options = {}) {
  const results = [], scores = [], sounds = new Set(), draws = [];
  const noop = () => {};
  const ctx = new Proxy({ measureText: value => ({ width: String(value).length * 10 }) }, {
    get: (target, key) => key in target ? target[key] : noop,
    set: (target, key, value) => { target[key] = value; return true; },
  });
  const game = createGame({ ctx, width: 960, height: 560,
    drawFrog: (...args) => draws.push(args), audio: { play: kind => sounds.add(kind) },
    onScore: value => scores.push(value), onEnd: value => results.push(value), ...options,
  });
  return { game, results, scores, sounds, draws };
}

function advance(game, seconds) {
  for (let i = 0; i < Math.round(seconds / STEP); i += 1) game.update(STEP);
}

function until(game, predicate, seconds = 30, input = () => {}) {
  for (let i = 0; i <= seconds / STEP; i += 1) {
    const state = game.getState({ details: true });
    if (predicate(state)) return state;
    input(game, state);
    game.update(STEP);
  }
  assert.fail(`Condition not reached within ${seconds}s: ${JSON.stringify(game.getState())}`);
}

const priority = ['rapid', 'power', 'spread', 'belly', 'bottles', 'regen', 'heart', 'boots', 'vitamins', 'heal', 'lucky'];

function chooseBuild(game, state) {
  if (state.phase !== 'upgrading') return;
  const order = state.upgrades.map((choice, index) => ({ index,
    weight: state.player.hp < state.player.maxHp * 0.65 && ['heal', 'heart'].includes(choice.id) ? -1 : priority.indexOf(choice.id),
  })).sort((a, b) => a.weight - b.weight);
  assert.equal(game.chooseUpgrade(order[0].index), true);
}

// A player-like driver: circle the arena, steer away from visible threats and
// tap dash when crowded. It uses only the real pointer and button input API.
function kite(game, state) {
  chooseBuild(game, state);
  if (state.phase !== 'playing') return;
  const angle = state.elapsed * 0.56;
  let dx = 480 + 330 * Math.cos(angle) - state.player.x;
  let dy = 310 + 150 * Math.sin(angle) - state.player.y;
  const length = Math.hypot(dx, dy);
  dx /= length || 1; dy /= length || 1;
  for (const enemy of state.enemies) {
    const distance = Math.hypot(enemy.x - state.player.x, enemy.y - state.player.y);
    if (distance > 0 && distance < 135) {
      const weight = (135 - distance) / 70;
      dx += (state.player.x - enemy.x) / distance * weight;
      dy += (state.player.y - enemy.y) / distance * weight;
    }
  }
  for (const bullet of state.enemyProjectiles) {
    const distance = Math.hypot(bullet.x - state.player.x, bullet.y - state.player.y);
    if (distance > 0 && distance < 90) {
      const weight = (90 - distance) / 90;
      dx += (state.player.x - bullet.x) / distance * weight;
      dy += (state.player.y - bullet.y) / distance * weight;
    }
  }
  game.pointerDown({ x: state.player.x + dx * 100, y: state.player.y + dy * 100 });
  if (state.dashCooldown === 0 && state.enemies.some(enemy => Math.hypot(enemy.x - state.player.x, enemy.y - state.player.y) < 80)) {
    game.controlUp('dash'); game.controlDown('dash');
  }
}

test('survivor: idle preview and read-only state; start resets the arena', () => seeded(12, () => {
  const { game, draws, scores } = harness();
  game.render(0);
  assert.equal(draws.length, 1, 'idle preview renders the supplied actual meme sprite');
  assert.equal(game.controlDown('left'), false);
  game.pointerDown({ x: 0, y: 0 });
  advance(game, 1);
  assert.equal(game.getState().elapsed, 0);
  game.start();
  assert.equal(scores[0], 0);
  const snapshot = game.getState();
  assert.equal(snapshot.enemies, undefined, 'normal UI state does not copy entity arrays');
  snapshot.player.hp = 0; snapshot.held.left = true; snapshot.caps.enemies = 10000;
  assert.equal(game.getState().player.hp, 100);
  assert.equal(game.getState().held.left, false);
  assert.equal(game.getState().caps.enemies, 80);
  advance(game, 0.8);
  const detailed = game.getState({ details: true });
  assert.ok(detailed.enemies.length > 0);
  detailed.enemies[0].hp = 0;
  assert.ok(game.getState({ details: true }).enemies[0].hp > 0);
  game.render(0.8);
}));

test('survivor: keyboard and touch controls normalize diagonals and keep the frog in bounds', () => seeded(2, () => {
  const { game } = harness(); game.start();
  const origin = game.getState().player;
  assert.equal(game.keyDown({ code: 'KeyD' }), true);
  assert.equal(game.keyDown({ key: 'ArrowUp' }), true);
  advance(game, 0.5);
  const moved = game.getState().player;
  assert.ok(Math.abs(Math.hypot(moved.x - origin.x, moved.y - origin.y) - 104) < 0.001);
  game.keyUp({ code: 'KeyD' }); game.keyUp({ key: 'ArrowUp' });
  advance(game, 0.1);
  assert.deepEqual(game.getState().player, moved);
  assert.equal(game.controlDown('left', 1), false);
  assert.equal(game.controlDown('teleport'), false);
  assert.equal(game.keyDown({ key: 'q' }), false);
  game.controlDown('left'); game.controlDown('down');
  advance(game, 4);
  const state = game.getState();
  assert.equal(state.player.x, state.bounds.left);
  assert.equal(state.player.y, state.bounds.bottom);
  game.cancelInput();
  assert.ok(Object.values(game.getState().held).every(value => !value));
  const stopped = game.getState().player;
  advance(game, 0.1);
  assert.deepEqual(game.getState().player, stopped);
  game.pointerDown({ x: 900, y: 230 }); advance(game, 0.1);
  assert.ok(game.getState().player.x > stopped.x);
  game.pointerMove({ x: NaN, y: Infinity });
  game.pointerUp();
  const pointerStopped = game.getState().player.x;
  advance(game, 0.1);
  assert.equal(game.getState().player.x, pointerStopped);
}));

test('survivor: dash has invulnerability and cooldown; pause cancellation prevents stuck controls', () => seeded(4, () => {
  const { game } = harness(); game.start();
  const x = game.getState().player.x;
  game.controlDown('right'); game.keyDown({ code: 'Space', key: ' ' });
  advance(game, 0.1);
  assert.ok(game.getState().player.x - x > 60);
  assert.equal(game.getState().player.invulnerable, true);
  assert.equal(game.getState().stats.dashes, 1);
  game.keyDown({ code: 'Space', repeat: true });
  game.controlUp('dash'); game.controlDown('dash');
  assert.equal(game.getState().stats.dashes, 1, 'cooldown cannot be bypassed by repeated taps');
  advance(game, 0.3); game.cancelInput();
  const paused = game.getState();
  game.render(1); game.render(7);
  assert.equal(game.getState().elapsed, paused.elapsed);
  assert.equal(game.getState().dashCooldown, paused.dashCooldown);
  advance(game, 0.2);
  assert.equal(game.getState().player.x, paused.player.x);
  game.controlDown('left'); game.pointerUp({ cancelled: true });
  assert.equal(game.getState().held.left, false);
  until(game, state => state.dashCooldown === 0, 5);
  game.keyDown({ code: 'Space' });
  assert.equal(game.getState().stats.dashes, 2);
}));

test('survivor: automatic attacks award experience; level choices freeze combat and unlock belly waves', () => seeded(7, () => {
  const { game, scores } = harness(); game.start();
  const first = until(game, state => state.phase === 'upgrading');
  assert.ok(first.elapsed > 5 && first.elapsed < 20);
  assert.ok(first.kills >= 8);
  assert.ok(first.stats.shots > 0);
  assert.equal(first.level, 2);
  assert.deepEqual(first.upgrades.map(item => item.id), ['belly', 'bottles', 'rapid']);
  assert.equal(scores.at(-1), first.score);
  const frozen = game.getState({ details: true });
  game.controlDown('left'); advance(game, 2); game.render(20);
  assert.deepEqual(game.getState({ details: true }), frozen);
  const choices = game.getUpgrades(); choices[0].name = 'mutated'; choices.pop();
  assert.equal(game.getUpgrades().length, 3);
  assert.notEqual(game.getUpgrades()[0].name, 'mutated');
  assert.equal(game.chooseUpgrade(-1), false);
  assert.equal(game.chooseUpgrade(3), false);
  assert.equal(game.chooseUpgrade(0.5), false);
  game.keyDown({ code: 'Digit1', repeat: true });
  assert.equal(game.getState().phase, 'upgrading');
  assert.equal(game.keyDown({ key: '1' }), true);
  assert.equal(game.getState().phase, 'playing');
  assert.equal(game.getState().weapons.belly, 1);
  assert.equal(game.getUpgrades().length, 0);
  assert.equal(game.chooseUpgrade(0), false);
  advance(game, 0.05);
  assert.equal(game.getState().stats.shockwaves, 1);
}));

test('survivor: canvas upgrade card selects orbiting bottles which damage approaching enemies', () => seeded(3, () => {
  const { game } = harness(); game.start();
  const first = until(game, state => state.phase === 'upgrading');
  game.pointerDown({ x: 4, y: 4 });
  assert.equal(game.getState().phase, 'upgrading', 'clicking outside a card does not select');
  const card = first.upgradeRects[1];
  game.pointerDown({ x: card.x + card.width / 2, y: card.y + card.height / 2 });
  assert.equal(game.getState().weapons.bottles, 1);
  const hit = until(game, state => state.stats.bottleHits > 0, 40, (g, state) => {
    chooseBuild(g, state);
    const enemy = state.enemies[0];
    if (enemy) g.pointerDown({ x: enemy.x, y: enemy.y });
  });
  assert.ok(hit.stats.bottleHits > 0);
  game.render(hit.elapsed);
}));

test('survivor: choosing added damage changes newly fired bullets', () => seeded(2, () => {
  const { game } = harness(); game.start();
  const offered = until(game, state => state.phase === 'upgrading' && state.upgrades.some(choice => choice.id === 'power'), 120, kite);
  const previous = offered.weapons.power || 0;
  assert.equal(game.chooseUpgrade(offered.upgrades.findIndex(choice => choice.id === 'power')), true);
  assert.equal(game.getState().weapons.power, previous + 1);
  const expectedDamage = 25 * (1 + (previous + 1) * 0.25);
  const fired = until(game, state => state.projectiles.some(bullet => bullet.damage === expectedDamage), 5, kite);
  assert.ok(fired.projectiles.some(bullet => bullet.damage > 25));
}));

test('survivor: damage grants recovery time; health depletion ends exactly once', () => seeded(9, () => {
  const { game, results, sounds } = harness(); game.start();
  const stationary = (g, state) => {
    if (state.phase === 'upgrading') g.chooseUpgrade(state.upgrades.findIndex(choice => choice.id !== 'heal' && choice.id !== 'heart'));
  };
  const hit = until(game, state => state.stats.damageTaken > 0, 90, stationary);
  assert.ok(hit.player.hp < hit.player.maxHp);
  assert.equal(hit.player.invulnerable, true);
  advance(game, 0.4);
  assert.equal(game.getState().player.hp, hit.player.hp, 'overlapping enemies cannot drain health every frame');
  const ended = until(game, state => state.phase === 'ended', 220, stationary);
  assert.equal(ended.player.hp, 0);
  assert.equal(results.length, 1);
  assert.equal(results[0].won, false);
  assert.equal(results[0].endless, false);
  assert.ok(sounds.has('laugh'));
  advance(game, 10);
  assert.equal(results.length, 1);
  assert.equal(game.getState().elapsed, ended.elapsed);
}));

test('survivor: classic mode needs three minutes and the final boss; all enemy types appear', () => seeded(7, () => {
  const { game, results, scores } = harness(); game.start();
  const kinds = new Set(); let firstFinalAt;
  const state = until(game, value => value.phase === 'ended', 260, (g, value) => {
    value.enemies.forEach(enemy => kinds.add(enemy.kind));
    if (value.finalBossSpawned && firstFinalAt === undefined) firstFinalAt = value.elapsed;
    if (value.elapsed < 180) assert.equal(value.won, false);
    kite(g, value);
  });
  assert.equal(state.won, true);
  assert.ok(state.elapsed >= 180);
  assert.ok(firstFinalAt >= 150 && firstFinalAt < 151);
  assert.equal(state.finalBossDefeated, true);
  assert.equal(state.stats.bosses, 3);
  assert.ok(state.level >= 10);
  assert.ok(state.stats.shots > 300);
  assert.ok(state.stats.shockwaves > 0);
  assert.deepEqual([...kinds].sort(), ['boss', 'carton', 'runner', 'shooter', 'tank']);
  assert.equal(results.length, 1);
  assert.equal(results[0].won, true);
  assert.equal(scores.at(-1), state.score);
  game.render(state.elapsed);
}));

test('survivor: endless keeps growing beyond three minutes with bounded entities and three choices at max ranks', () => seeded(7, () => {
  const { game, results } = harness({ endless: true }); game.start();
  let maxEnemies = 0, lateUpgrade = false;
  const state = until(game, value => value.elapsed >= 700, 705, (g, value) => {
    assert.notEqual(value.phase, 'ended');
    for (const [type, count] of Object.entries(value.entityCounts)) assert.ok(count <= value.caps[type], `${type} exceeds its cap`);
    maxEnemies = Math.max(maxEnemies, value.entityCounts.enemies);
    if (value.phase === 'upgrading') {
      assert.equal(value.upgrades.length, 3);
      assert.equal(new Set(value.upgrades.map(choice => choice.id)).size, 3);
      if (value.level >= 60) lateUpgrade = true;
    }
    kite(g, value);
  });
  assert.ok(state.wave > 40);
  assert.ok(state.level >= 60);
  assert.equal(lateUpgrade, true);
  assert.ok(maxEnemies > 40, 'exercise a crowded late game');
  assert.equal(state.won, false);
  assert.equal(state.finalBossSpawned, false);
  assert.ok(state.stats.bosses >= 10);
  assert.equal(results.length, 0);
  assert.ok(state.weapons.power >= 8, 'damage upgrades take effect throughout long games');
  game.render(state.elapsed);
}));

test('survivor: restart, mode override, invalid frame values, and destroy leave no active inputs', () => seeded(19, () => {
  const { game, results } = harness({ endless: true }); game.start();
  until(game, state => state.phase === 'upgrading');
  game.start({ endless: false });
  let state = game.getState();
  assert.equal(state.endless, false);
  assert.equal(state.level, 1); assert.equal(state.score, 0); assert.equal(state.elapsed, 0);
  assert.equal(state.player.hp, 100); assert.equal(state.upgrades.length, 0);
  assert.deepEqual(state.weapons, {});
  game.update(NaN); game.update(Infinity); game.update(-1);
  assert.equal(game.getState().elapsed, 0);
  game.update(500);
  assert.equal(game.getState().elapsed, 0.05, 'large resumed frame is safely capped');
  game.start({ endless: true }); game.controlDown('left'); game.controlDown('dash');
  game.destroy();
  state = game.getState();
  assert.equal(state.phase, 'idle');
  assert.ok(Object.values(state.entityCounts).every(count => count === 0));
  assert.ok(Object.values(state.held).every(value => !value));
  assert.deepEqual(game.getUpgrades(), []);
  advance(game, 5);
  assert.equal(results.length, 0);
  game.start();
  assert.equal(game.getState().endless, true);
  assert.equal(game.getState().dashCooldown, 0);
}));
