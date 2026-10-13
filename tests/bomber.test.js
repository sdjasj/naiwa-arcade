import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, generateArena, traceBlast } from '../js/games/bomber.js';

const directions = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };
const key = (point) => `${point.x},${point.y}`;

function harness(options = {}) {
  const results = [], scores = [], sounds = [], frogs = [];
  const noop = () => {};
  const ctx = new Proxy({ measureText: () => ({ width: 50 }) }, {
    get: (target, property) => property in target ? target[property] : noop,
    set: (target, property, value) => { target[property] = value; return true; },
  });
  const game = createGame({
    ctx, drawFrog: (...args) => frogs.push(args), seed: 40,
    onScore: (value) => scores.push(value), onStatus() {},
    onEnd: (result) => results.push(result), audio: { play: (kind) => sounds.push(kind) }, ...options,
  });
  return { game, results, scores, sounds, frogs };
}

function advance(game, seconds) {
  for (let frame = 0; frame < Math.round(seconds * 120); frame += 1) game.update(1 / 120);
}

function until(game, predicate, seconds = 6) {
  for (let frame = 0; frame < seconds * 120; frame += 1) {
    const state = game.getState();
    if (predicate(state)) return state;
    game.update(1 / 120);
  }
  assert.fail(`Timed out in ${game.getState().phase}`);
}

function pathTo(state, goal, avoid = new Set(), bombs = state.bombs, playerIndex = 0) {
  const player = state.players[playerIndex];
  const seen = new Set([key(player)]), queue = [{ ...player, path: [] }];
  for (let i = 0; i < queue.length; i += 1) {
    const current = queue[i];
    if (goal(current) && current.path.length) return current.path;
    for (const [action, [dx, dy]] of Object.entries(directions)) {
      const next = { x: current.x + dx, y: current.y + dy }, id = key(next);
      if (state.grid[next.y]?.[next.x] !== 0 || seen.has(id) || avoid.has(id)
        || bombs.some((bomb) => key(bomb) === id)
        || state.enemies.some((enemy) => enemy.alive && key(enemy) === id)) continue;
      seen.add(id); queue.push({ ...next, path: [...current.path, action] });
    }
  }
  return null;
}

function walk(game, path, playerIndex = 0) {
  assert.ok(path, 'a walking route must exist');
  for (const action of path) {
    const before = game.getState().players[playerIndex];
    game.controlDown(action, playerIndex);
    until(game, (state) => key(state.players[playerIndex]) !== key(before), 1);
    game.controlUp(action, playerIndex);
  }
}

// A small player bot uses visible board geometry and the same keyboard/touch API as a human.
// It opens crates, collects upgrades, escapes marked blast lines and walks to the unlocked exit.
function autoplay(game, stop = () => false) {
  const visited = new Set();
  let dodges = 0;
  for (let frame = 0; frame < 30000; frame += 1) {
    const state = game.getState(), player = state.players[0];
    visited.add(state.level);
    if (state.phase === 'ended' || stop(state)) return { state, visited, dodges };
    game.cancelInput();
    const fire = new Set(state.explosions.flatMap((blast) => blast.cells).map(key));
    const danger = new Set([...state.bombs.flatMap((bomb) => traceBlast(state.grid, bomb.x, bomb.y, bomb.range)).map(key), ...fire]);
    if (state.phase === 'playing') {
      let path;
      if (danger.has(key(player))) path = pathTo(state, (point) => !danger.has(key(point)), fire);
      else if (state.exit.unlocked) path = pathTo(state, (point) => key(point) === key(state.exit), danger);
      else if (state.items.length) path = pathTo(state, (point) => state.items.some((item) => key(item) === key(point)), danger);
      if (!path && !danger.has(key(player)) && !state.exit.unlocked) {
        const cells = traceBlast(state.grid, player.x, player.y, player.range);
        const useful = cells.some((cell) => state.grid[cell.y][cell.x] === 2
          || state.enemies.some((enemy) => enemy.alive && key(enemy) === key(cell)));
        const predicted = new Set([...danger, ...cells.map(key)]);
        const escape = pathTo(state, (point) => !predicted.has(key(point)), fire, [...state.bombs, { x: player.x, y: player.y }]);
        if (useful && escape && state.bombs.filter((bomb) => bomb.ownerId === player.id).length < player.capacity) {
          game.controlDown('bomb'); game.controlUp('bomb'); path = escape;
        } else path = pathTo(state, (point) => traceBlast(state.grid, point.x, point.y, player.range).some((cell) =>
          state.grid[cell.y][cell.x] === 2 || state.enemies.some((enemy) => enemy.alive && key(enemy) === key(cell))), danger);
      }
      if (path) game.controlDown(path[0]);
    }
    game.update(1 / 30);
    const after = game.getState();
    for (const enemy of after.enemies.filter((entity) => entity.alive)) {
      assert.equal(after.grid[enemy.y][enemy.x], 0, 'enemies cannot walk through walls or crates');
      const before = state.enemies.find((entity) => entity.id === enemy.id);
      if (before && danger.has(key(before)) && !danger.has(key(enemy)) && key(before) !== key(enemy)) dodges += 1;
    }
  }
  assert.fail('The public-input player bot did not finish the expected campaign');
}

test('bomber maps: random layouts keep all floors connected, safe spawns, bounded crates and a reachable exit', () => {
  for (let seed = 0; seed < 80; seed += 1) for (const multiplayer of [false, true]) {
    const arena = generateArena({ seed, multiplayer, level: seed + 1 });
    const seen = new Set(['1,1']), queue = [{ x: 1, y: 1 }];
    for (let i = 0; i < queue.length; i += 1) for (const [dx, dy] of Object.values(directions)) {
      const point = { x: queue[i].x + dx, y: queue[i].y + dy }, id = key(point);
      if (arena.grid[point.y]?.[point.x] !== 0 || seen.has(id)) continue;
      seen.add(id); queue.push(point);
    }
    assert.equal(seen.size, arena.grid.flat().filter((tile) => tile === 0).length);
    assert.ok(seen.has(key(arena.exit)));
    for (const spawn of arena.spawnPoints) {
      assert.equal(arena.grid[spawn.y][spawn.x], 0);
      assert.ok(Object.values(directions).filter(([dx, dy]) => arena.grid[spawn.y + dy]?.[spawn.x + dx] === 0).length >= 2);
    }
    assert.ok(arena.grid.flat().filter((tile) => tile === 2).length <= 22);
    assert.ok(arena.enemySpawns.length <= 4);
    if (multiplayer) {
      for (let y = 0; y < 9; y += 1) for (let x = 0; x < 13; x += 1) assert.equal(arena.grid[y][x], arena.grid[8 - y][12 - x]);
      for (const drop of arena.drops) assert.equal(arena.drops.find((item) => item.x === 12 - drop.x && item.y === 8 - drop.y)?.type, drop.type);
    }
  }
});

test('bomber explosions: solid walls stop before the wall; crates are hit but stop the ray; no diagonal blast', () => {
  const grid = Array.from({ length: 7 }, () => Array(7).fill(0));
  grid[3][5] = 1; grid[1][3] = 2;
  const cells = new Set(traceBlast(grid, 3, 3, 4).map(key));
  assert.ok(cells.has('4,3'));
  assert.ok(!cells.has('5,3') && !cells.has('6,3'));
  assert.ok(cells.has('3,1'));
  assert.ok(!cells.has('3,0'));
  assert.ok(!cells.has('2,2'));
  assert.equal(grid[1][3], 2, 'tracing is read-only');
});

test('bomber controls: idle preview, single-player arrows, held-key cancellation, mode precedence and restart', () => {
  const { game, frogs, results } = harness();
  game.render(0); assert.ok(frogs.length);
  game.controlDown('right'); advance(game, 0.3);
  assert.equal(game.getState().phase, 'idle');
  game.start();
  game.keyDown({ key: 'ArrowRight' });
  until(game, (state) => state.players[0].x === 2);
  game.cancelInput();
  const point = key(game.getState().players[0]);
  advance(game, 0.5);
  assert.equal(key(game.getState().players[0]), point);
  assert.deepEqual(game.getState().players[0].held, []);
  game.start({ endless: true, multiplayer: true });
  assert.equal(game.getState().multiplayer, true);
  assert.equal(game.getState().endless, false);
  game.keyDown({ key: 'ArrowLeft' });
  until(game, (state) => state.players[1].x === 10);
  game.keyUp({ key: 'ArrowLeft' });
  assert.equal(game.getState().players[0].x, 1);
  assert.deepEqual(game.getState().players[1].held, []);
  game.start({ endless: true, multiplayer: false });
  assert.equal(game.getState().endless, true);
  assert.equal(game.getState().players.length, 1);
  game.destroy(); advance(game, 5);
  assert.equal(results.length, 0);
});

test('bomber bombs: one press places one bomb; capacity applies; the owner can leave but cannot walk back through it', () => {
  const { game } = harness(); game.start();
  game.controlDown('bomb'); game.controlDown('bomb');
  game.keyDown({ key: ' ', repeat: true });
  assert.equal(game.getState().bombs.length, 1);
  game.controlDown('right');
  until(game, (state) => state.players[0].x === 2);
  game.controlUp(['right', 'bomb']);
  advance(game, 0.3);
  game.controlDown('bomb'); game.controlUp('bomb');
  assert.equal(game.getState().bombs.length, 1, 'capacity is one until an upgrade is collected');
  game.controlDown('left'); advance(game, 0.5); game.controlUp('left');
  assert.equal(game.getState().players[0].x, 2);
  assert.equal(game.getState().bombs[0].x, 1);
  game.render(1);
});

test('bomber chain reaction: the first bomb detonates a newer neighboring bomb before its own fuse expires', () => {
  const { game } = harness({ multiplayer: true }); game.start();
  walk(game, pathTo(game.getState(), (point) => point.x === 2 && point.y === 1, new Set(), [], 1), 1);
  game.controlDown('bomb', 0); game.controlUp('bomb', 0);
  advance(game, 0.75);
  game.controlDown('bomb', 1); game.controlUp('bomb', 1);
  assert.equal(game.getState().bombs.length, 2);
  until(game, (state) => state.explosions.length > 0, 2);
  assert.equal(game.getState().bombs.length, 0);
  assert.equal(game.getState().explosions.length, 2);
  assert.ok(game.getState().explosions.every((fire) => fire.life > 0.5));
  game.render(3);
});

test('bomber damage: a lingering blast costs one heart, grants invulnerability and eventually ends after three hits', () => {
  const { game, results } = harness({ seed: 1 }); game.start();
  for (let hit = 0; hit < 3; hit += 1) {
    game.controlDown('bomb'); game.controlUp('bomb');
    until(game, (state) => state.players[0].lives === 2 - hit, 3);
    assert.ok(game.getState().players[0].invincible > 1.8);
    advance(game, 0.6);
    assert.equal(game.getState().players[0].lives, 2 - hit, 'a blast must not hit on every update');
  }
  until(game, (state) => state.phase === 'ended');
  assert.equal(results.length, 1); assert.equal(results[0].won, false);
  advance(game, 10); assert.equal(results.length, 1);
  game.start(); assert.equal(game.getState().players[0].lives, 3);
});

test('bomber multiplayer: two round victories finish the match once, while simultaneous defeat replays without a point', () => {
  const { game, results } = harness({ multiplayer: true }); game.start();
  for (let round = 1; round <= 2; round += 1) {
    game.controlDown('bomb', 0); game.controlUp('bomb', 0);
    until(game, (state) => state.phase === 'roundover');
    assert.deepEqual(game.getState().wins, [0, round]);
    until(game, (state) => state.phase === (round === 2 ? 'ended' : 'playing'));
  }
  assert.equal(results.length, 1); assert.equal(results[0].winner, 1);
  assert.deepEqual(results[0].wins, [0, 2]);
  advance(game, 10); assert.equal(results.length, 1);
  game.start();
  for (const player of [0, 1]) { game.controlDown('bomb', player); game.controlUp('bomb', player); }
  until(game, (state) => state.phase === 'roundover');
  assert.deepEqual(game.getState().wins, [0, 0]);
  until(game, (state) => state.phase === 'playing');
  assert.equal(game.getState().round, 1);
  assert.equal(game.getState().players.length, 2);
  assert.equal(game.getState().bombs.length, 0);
});

test('bomber classic: public movement and bomb controls can clear six levels, collect all upgrades and unlock exits', () => {
  const { game, results, scores } = harness({ seed: 40 }); game.start();
  const { state, visited, dodges } = autoplay(game);
  assert.equal(state.phase, 'ended'); assert.equal(state.level, 6);
  assert.deepEqual([...visited], [1, 2, 3, 4, 5, 6]);
  assert.equal(results.length, 1); assert.equal(results[0].won, true);
  assert.ok(state.destroyedCrates > 50);
  assert.ok(state.players[0].capacity > 1 && state.players[0].capacity <= 3);
  assert.ok(state.players[0].range > 2 && state.players[0].range <= 5);
  assert.ok(state.players[0].speed > 5.2 && state.players[0].speed <= 7.5);
  assert.ok(dodges > 0, 'enemy AI should visibly leave threatened cells instead of always standing in explosions');
  assert.ok(scores.every((value, index) => index === 0 || value >= scores[index - 1]));
  assert.equal(state.exit.unlocked, true);
  game.render(200);
});

test('bomber endless: completing six levels continues to seven, clears old objects and keeps map difficulty bounded', () => {
  const { game, results } = harness({ seed: 40, endless: true }); game.start();
  const { state } = autoplay(game, (current) => current.level === 7);
  assert.equal(state.phase, 'playing'); assert.equal(state.endless, true);
  assert.equal(state.level, 7); assert.equal(results.length, 0);
  assert.equal(state.bombs.length, 0); assert.equal(state.explosions.length, 0); assert.equal(state.items.length, 0);
  assert.ok(state.enemies.length <= 4);
  game.start({ level: 200, endless: true });
  const later = game.getState();
  assert.equal(later.level, 200);
  assert.equal(later.grid.length, 9); assert.ok(later.grid.every((row) => row.length === 13));
  assert.equal(later.enemies.length, 4);
  assert.ok(later.enemies.every((enemy) => enemy.speed <= 3.4));
  assert.ok(later.grid.flat().filter((tile) => tile === 2).length <= 22);
  game.start({ endless: false });
  assert.equal(game.getState().level, 1); assert.equal(game.getState().endless, false);
});

test('bomber state snapshots cannot mutate live actors, maps or bomb data, and invalid dt does not advance time', () => {
  const { game } = harness(); game.start(); game.controlDown('bomb'); game.controlUp('bomb');
  const original = game.getState();
  const snapshot = game.getState();
  snapshot.grid[1][1] = 1; snapshot.players[0].x = 10; snapshot.players[0].held.push('left'); snapshot.bombs[0].fuse = 0;
  assert.deepEqual(game.getState(), original);
  for (const dt of [NaN, Infinity, 0, -1]) game.update(dt);
  assert.deepEqual(game.getState(), original);
});
