const COLS = 13;
const ROWS = 9;
const TILE = 48;
const BOARD = { x: 168, y: 74, cols: COLS, rows: ROWS, tile: TILE, width: COLS * TILE, height: ROWS * TILE };
const FUSE = 2.15;
const FIRE_TIME = 0.58;
const DIRECTIONS = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };
const keyOf = (x, y) => `${x},${y}`;
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));

function randomSource(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let next = Math.imul(value ^ value >>> 15, value | 1);
    next ^= next + Math.imul(next ^ next >>> 7, next | 61);
    return ((next ^ next >>> 14) >>> 0) / 4294967296;
  };
}

function reachable(grid, start) {
  const seen = new Set([keyOf(start.x, start.y)]);
  const queue = [start];
  for (let i = 0; i < queue.length; i += 1) {
    for (const [dx, dy] of Object.values(DIRECTIONS)) {
      const x = queue[i].x + dx, y = queue[i].y + dy, key = keyOf(x, y);
      if (grid[y]?.[x] !== 0 || seen.has(key)) continue;
      seen.add(key); queue.push({ x, y });
    }
  }
  return seen;
}

export function traceBlast(grid, x, y, range) {
  const cells = [{ x, y }];
  for (const [dx, dy] of Object.values(DIRECTIONS)) {
    for (let distance = 1; distance <= range; distance += 1) {
      const cx = x + dx * distance, cy = y + dy * distance;
      const tile = grid[cy]?.[cx];
      if (tile === undefined || tile === 1) break;
      cells.push({ x: cx, y: cy });
      if (tile === 2) break;
    }
  }
  return cells;
}

export function generateArena({ level = 1, multiplayer = false, seed = 1 } = {}) {
  const random = randomSource(seed);
  const grid = Array.from({ length: ROWS }, (_, y) => Array.from({ length: COLS }, (_, x) =>
    x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1 || (x % 2 === 0 && y % 2 === 0) ? 1 : 0));
  const spawnPoints = [{ x: 1, y: 1 }, { x: 11, y: 7 }];
  const enemySpawns = [{ x: 9, y: 5 }, { x: 11, y: 3 }, { x: 7, y: 7 }, { x: 7, y: 1 }]
    .slice(0, Math.min(4, 1 + Math.floor((level - 1) / 2)));
  const protectedCells = new Set();
  for (const point of [...spawnPoints, ...(multiplayer ? [] : enemySpawns)]) {
    for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
      if (Math.abs(dx) + Math.abs(dy) <= 1) protectedCells.add(keyOf(point.x + dx, point.y + dy));
    }
  }
  const candidates = [];
  for (let y = 1; y < ROWS - 1; y += 1) for (let x = 1; x < COLS - 1; x += 1) {
    if (!grid[y][x] && !protectedCells.has(keyOf(x, y))) candidates.push({ x, y, order: random() });
  }
  candidates.sort((a, b) => a.order - b.order);
  let crates = 0;
  const maximum = Math.min(22, 11 + Math.floor((level - 1) * 1.5));
  for (const point of candidates) {
    if (crates >= maximum) break;
    const pair = multiplayer ? [point, { x: COLS - 1 - point.x, y: ROWS - 1 - point.y }] : [point];
    if (pair.some((p) => grid[p.y][p.x] || protectedCells.has(keyOf(p.x, p.y)))) continue;
    for (const p of pair) grid[p.y][p.x] = 2;
    const open = grid.flat().filter((tile) => tile === 0).length;
    if (reachable(grid, spawnPoints[0]).size !== open) {
      for (const p of pair) grid[p.y][p.x] = 0;
    } else crates += pair.length;
  }
  const drops = [];
  const types = ['capacity', 'range', 'speed'];
  for (let y = 1; y < ROWS - 1; y += 1) for (let x = 1; x < COLS - 1; x += 1) {
    const mirrored = multiplayer && y * COLS + x > (ROWS - 1 - y) * COLS + COLS - 1 - x;
    const dropIndex = mirrored ? COLS - 1 - x + ROWS - 1 - y + level : x + y + level;
    if (grid[y][x] === 2) drops.push({ x, y, type: types[dropIndex % 3] });
  }
  return { grid, drops, spawnPoints, enemySpawns: multiplayer ? [] : enemySpawns, exit: { x: 11, y: 7 } };
}

export function createGame(env) {
  const { ctx, drawFrog, audio, onScore, onStatus, onEnd } = env;
  let endless = env.endless === true;
  let multiplayer = env.multiplayer === true;
  if (multiplayer) endless = false;
  let phase = 'idle';
  let level = 1;
  let round = 1;
  let wins = [0, 0];
  let draws = 0;
  let score = 0;
  let elapsed = 0;
  let phaseTime = 0;
  let baseSeed = Number.isFinite(env.seed) ? env.seed >>> 0 : Math.floor(Math.random() * 0xffffffff);
  let random = randomSource(baseSeed);
  let grid = [], drops = [], players = [], enemies = [], bombs = [], explosions = [], items = [], effects = [];
  let exit = { x: 11, y: 7 };
  let nextBombId = 1;
  let endSent = false;
  let winner = null;
  let lastRoundWinner = null;
  let destroyedCrates = 0;

  const sound = (kind) => audio?.play?.(kind);
  const status = (label) => onStatus?.(label);
  const at = (a, b) => a.x === b.x && a.y === b.y;
  const activeEnemies = () => enemies.filter((enemy) => enemy.alive);
  const alivePlayers = () => players.filter((player) => player.alive);

  function actor(id, x, y, playerIndex = null) {
    return { id, x, y, renderX: x, renderY: y, playerIndex, alive: true,
      lives: multiplayer ? 1 : 3, capacity: 1, range: 2, speed: 5.2,
      moveTimer: 0, bombCooldown: 0, invincible: playerIndex === null ? 0 : 1.3,
      held: [], lastDirection: 'down' };
  }

  function loadLevel(keep = null) {
    const seed = (baseSeed + level * 997 + round * 811 + draws * 37) >>> 0;
    random = randomSource(seed + 177);
    const arena = generateArena({ level, multiplayer, seed });
    grid = arena.grid; drops = arena.drops; exit = arena.exit;
    bombs = []; explosions = []; items = []; effects = []; nextBombId = 1;
    players = [actor('p0', 1, 1, 0)];
    if (multiplayer) players.push(actor('p1', 11, 7, 1));
    else if (keep) Object.assign(players[0], { lives: Math.min(3, keep.lives + 1), capacity: keep.capacity, range: keep.range, speed: keep.speed });
    enemies = arena.enemySpawns.map((point, index) => {
      const enemy = actor(`e${index}`, point.x, point.y);
      enemy.lives = 1;
      enemy.speed = Math.min(3.4, 2.15 + (level - 1) * 0.12);
      enemy.moveTimer = 0.5 + index * 0.23;
      return enemy;
    });
    phase = 'playing'; phaseTime = 0; lastRoundWinner = null;
    status(multiplayer
      ? `第 ${round} 局 · 三局两胜 · 1P WASD / 空格 · 2P 方向键 / Enter · 注意自己放的弹！`
      : `${endless ? '无限' : '经典'}第 ${level}${endless ? '' : ' / 6'} 关 · 炸掉 ${enemies.length} 个奶盒，再走进右下出口。`);
  }

  function start(options = {}) {
    if (options.endless !== undefined) endless = options.endless === true;
    if (options.multiplayer !== undefined) multiplayer = options.multiplayer === true;
    if (multiplayer) endless = false;
    if (Number.isFinite(options.seed)) baseSeed = options.seed >>> 0;
    level = multiplayer ? 1 : clamp(Math.floor(Number(options.level) || 1), 1, endless ? 1000000 : 6);
    round = 1; wins = [0, 0]; draws = 0; score = 0; elapsed = 0;
    endSent = false; winner = null; destroyedCrates = 0;
    loadLevel(); onScore?.(0);
  }

  function addScore(points) { score += points; onScore?.(score); }

  function finish(won) {
    if (endSent) return;
    endSent = true; phase = 'ended'; cancelInput();
    onEnd?.({ score, endless, multiplayer, level, won, winner, wins: [...wins],
      title: multiplayer ? `${winner + 1}P 奶蛙，笑到最后！` : won ? '六关拆完，笑气毕业！' : '奶蛙笑趴了，下次绕远点',
      message: multiplayer ? `比分 ${wins[0]} : ${wins[1]} · 三局两胜！再来一场，交换路线试试。`
        : `${endless ? '无限挑战' : '经典挑战'} · 到达第 ${level} 关 · 炸开 ${destroyedCrates} 个箱子 · ${score} 分。${won ? '六个出口全部通过！' : '放弹后记得转弯，十字笑气会被石墙挡住。'}` });
  }

  function walkable(x, y, entity = null) {
    return grid[y]?.[x] === 0 && !bombs.some((bomb) => bomb.x === x && bomb.y === y)
      && !enemies.some((enemy) => enemy.alive && enemy !== entity && enemy.x === x && enemy.y === y);
  }

  function move(entity, action) {
    const direction = DIRECTIONS[action];
    if (!direction) return false;
    const x = entity.x + direction[0], y = entity.y + direction[1];
    if (!walkable(x, y, entity)) return false;
    entity.x = x; entity.y = y; entity.lastDirection = action;
    if (entity.playerIndex !== null) collect(entity);
    return true;
  }

  function collect(player) {
    const index = items.findIndex((item) => at(item, player));
    if (index < 0) return;
    const [item] = items.splice(index, 1);
    const names = { capacity: '弹药容量 +1', range: '十字火力 +1', speed: '移动速度提升' };
    if (item.type === 'capacity') player.capacity = Math.min(3, player.capacity + 1);
    if (item.type === 'range') player.range = Math.min(5, player.range + 1);
    if (item.type === 'speed') player.speed = Math.min(7.5, player.speed + 0.65);
    if (!multiplayer) addScore(15);
    sound('score'); status(`${player.playerIndex + 1}P 捡到 ${names[item.type]}！`);
    effects.push({ x: player.x, y: player.y, text: names[item.type], age: 0 });
  }

  function placeBomb(player) {
    if (!player?.alive || phase !== 'playing' || player.bombCooldown > 0) return false;
    if (bombs.some((bomb) => at(bomb, player)) || bombs.filter((bomb) => bomb.ownerId === player.id).length >= player.capacity) return false;
    bombs.push({ id: nextBombId++, x: player.x, y: player.y, ownerId: player.id, range: player.range, fuse: FUSE });
    player.bombCooldown = 0.28;
    sound('pop'); return true;
  }

  function detonate() {
    const queue = bombs.filter((bomb) => bomb.fuse <= 0 || explosions.some((fire) => fire.cells.some((cell) => at(cell, bomb)))).map((bomb) => bomb.id);
    while (queue.length) {
      const id = queue.shift();
      const index = bombs.findIndex((bomb) => bomb.id === id);
      if (index < 0) continue;
      const [bomb] = bombs.splice(index, 1);
      const cells = traceBlast(grid, bomb.x, bomb.y, bomb.range);
      for (const cell of cells) {
        for (const other of bombs) if (at(other, cell) && !queue.includes(other.id)) queue.push(other.id);
        if (grid[cell.y][cell.x] === 2) {
          grid[cell.y][cell.x] = 0; destroyedCrates += 1;
          if (!multiplayer) addScore(10);
          const drop = drops.findIndex((item) => at(item, cell));
          if (drop >= 0) items.push(drops.splice(drop, 1)[0]);
        }
      }
      explosions.push({ id: bomb.id, ownerId: bomb.ownerId, cells, life: FIRE_TIME });
      sound('hit'); sound('laugh:attack');
    }
  }

  function dangerMap() {
    const danger = new Map();
    const deadlines = bombs.map((bomb) => ({ bomb, time: bomb.fuse, cells: traceBlast(grid, bomb.x, bomb.y, bomb.range) }));
    for (let iteration = 0; iteration < bombs.length; iteration += 1) {
      for (const source of deadlines) for (const target of deadlines) {
        if (source.time < target.time && source.cells.some((cell) => at(cell, target.bomb))) target.time = source.time;
      }
    }
    for (const entry of deadlines) for (const cell of entry.cells) {
      const key = keyOf(cell.x, cell.y);
      danger.set(key, Math.min(danger.get(key) ?? Infinity, entry.time));
    }
    for (const fire of explosions) for (const cell of fire.cells) danger.set(keyOf(cell.x, cell.y), 0);
    return danger;
  }

  function escapeDirection(enemy, danger) {
    const queue = [{ x: enemy.x, y: enemy.y, first: null, distance: 0 }];
    const seen = new Set([keyOf(enemy.x, enemy.y)]);
    for (let i = 0; i < queue.length; i += 1) {
      const current = queue[i];
      if (current.first && !danger.has(keyOf(current.x, current.y))) return current.first;
      for (const [action, [dx, dy]] of Object.entries(DIRECTIONS)) {
        const x = current.x + dx, y = current.y + dy, key = keyOf(x, y);
        if (seen.has(key) || !walkable(x, y, enemy)) continue;
        const deadline = danger.get(key);
        if (deadline !== undefined && deadline < (current.distance + 1) / enemy.speed + 0.12) continue;
        seen.add(key); queue.push({ x, y, first: current.first || action, distance: current.distance + 1 });
      }
    }
    return null;
  }

  function moveEnemy(enemy, danger) {
    const currentDeadline = danger.get(keyOf(enemy.x, enemy.y));
    // Milk cartons react to a fast fuse, then search for an actually reachable safe cell.
    // Early enemies give a new player a fair trapping window; later ones react sooner.
    const reactionWindow = Math.min(1.35, 0.85 + (level - 1) * 0.1);
    if (currentDeadline !== undefined && currentDeadline <= reactionWindow) {
      const escape = escapeDirection(enemy, danger);
      if (escape) move(enemy, escape);
      return;
    }
    const player = players[0];
    const options = Object.entries(DIRECTIONS).filter(([, [dx, dy]]) =>
      walkable(enemy.x + dx, enemy.y + dy, enemy) && (danger.get(keyOf(enemy.x + dx, enemy.y + dy)) ?? Infinity) > reactionWindow)
      .map(([action, [dx, dy]]) => ({ action, distance: Math.abs(enemy.x + dx - player.x) + Math.abs(enemy.y + dy - player.y), order: random() }));
    options.sort((a, b) => (Math.abs(enemy.x - player.x) + Math.abs(enemy.y - player.y) < 5 ? a.distance - b.distance : 0) || a.order - b.order);
    if (options.length) move(enemy, options[0].action);
  }

  function hurt(player) {
    if (!player.alive || player.invincible > 0) return;
    player.lives -= 1; player.invincible = 2; player.held = [];
    sound('laugh:hurt');
    if (player.lives <= 0) { player.alive = false; return; }
    player.x = player.playerIndex === 1 ? 11 : 1;
    player.y = player.playerIndex === 1 ? 7 : 1;
    player.renderX = player.x; player.renderY = player.y;
    status(`噗哈哈！还剩 ${player.lives} 心，回到安全角落，再找机会。`);
  }

  function checkDamage() {
    const fire = new Set(explosions.flatMap((blast) => blast.cells.map((cell) => keyOf(cell.x, cell.y))));
    for (const enemy of enemies) if (enemy.alive && fire.has(keyOf(enemy.x, enemy.y))) {
      enemy.alive = false; sound('score'); addScore(100);
      effects.push({ x: enemy.x, y: enemy.y, text: '奶盒笑趴了 +100', age: 0 });
    }
    for (const player of players) {
      if (fire.has(keyOf(player.x, player.y)) || (!multiplayer && enemies.some((enemy) => enemy.alive && at(enemy, player)))) hurt(player);
    }
  }

  function evaluateRound() {
    if (phase !== 'playing') return;
    if (multiplayer && alivePlayers().length < 2) {
      phase = 'roundover'; phaseTime = 0; cancelInput();
      const survivor = alivePlayers()[0];
      if (survivor) {
        lastRoundWinner = survivor.playerIndex; wins[lastRoundWinner] += 1;
        winner = wins[lastRoundWinner] >= 2 ? lastRoundWinner : null;
        status(`${lastRoundWinner + 1}P 赢下本局！比分 ${wins[0]} : ${wins[1]}${winner !== null ? ' · 比赛结束' : ' · 下一局马上开始'}。`);
        sound('win');
        sound('laugh:victory');
      } else { draws += 1; status('两只奶蛙同时笑趴了！本局重赛，不计分。'); }
    } else if (!multiplayer && !players[0].alive) {
      phase = 'ending'; phaseTime = 0; cancelInput(); status('三颗心都笑没了。奶蛙说：这次算热身。');
    } else if (!multiplayer && activeEnemies().length === 0 && at(players[0], exit)) {
      phase = 'levelclear'; phaseTime = 0; cancelInput(); addScore(200 + players[0].lives * 50); sound('win');
      sound('laugh:victory');
      status(!endless && level === 6 ? '六关全通！笑气拆迁队正式毕业。' : `第 ${level} 关通过！奖励 1 心，准备下一座迷宫。`);
    }
  }

  function updateStep(dt) {
    elapsed += dt; phaseTime += dt;
    effects = effects.filter((effect) => { effect.age += dt; return effect.age < 1; });
    if (phase === 'roundover' && phaseTime >= 1.2) {
      if (winner !== null) finish(true);
      else { round = wins[0] + wins[1] + 1; loadLevel(); }
      return;
    }
    if (phase === 'ending' && phaseTime >= 0.95) { finish(false); return; }
    if (phase === 'levelclear' && phaseTime >= 1.1) {
      if (!endless && level >= 6) finish(true);
      else { const keep = { ...players[0] }; level += 1; loadLevel(keep); }
      return;
    }
    if (phase !== 'playing') return;
    for (const fire of explosions) fire.life -= dt;
    explosions = explosions.filter((fire) => fire.life > 0);
    for (const player of players) {
      player.invincible = Math.max(0, player.invincible - dt);
      player.bombCooldown = Math.max(0, player.bombCooldown - dt);
      player.moveTimer = Math.max(0, player.moveTimer - dt);
    }
    // Explosions resolve before movement, so stepping on a blast boundary cannot skip damage.
    for (const bomb of bombs) bomb.fuse -= dt;
    detonate(); checkDamage();
    for (const player of players) {
      if (!player.alive || player.moveTimer > 0) continue;
      const direction = player.held.filter((action) => action in DIRECTIONS).at(-1);
      if (direction) { move(player, direction); player.moveTimer = 1 / player.speed; }
    }
    const danger = dangerMap();
    for (const enemy of enemies) {
      if (!enemy.alive) continue;
      enemy.moveTimer -= dt;
      if (enemy.moveTimer <= 0) { moveEnemy(enemy, danger); enemy.moveTimer += 1 / enemy.speed; }
    }
    checkDamage(); evaluateRound();
    for (const entity of [...players, ...enemies]) {
      entity.renderX += (entity.x - entity.renderX) * Math.min(1, dt * 22);
      entity.renderY += (entity.y - entity.renderY) * Math.min(1, dt * 22);
    }
  }

  function update(dt) {
    if (phase === 'idle' || phase === 'ended' || !Number.isFinite(dt) || dt <= 0) return;
    let remaining = Math.min(dt, 0.25);
    while (remaining > 1e-8) {
      const portion = Math.min(remaining, 1 / 120);
      updateStep(portion); remaining -= portion;
      if (phase === 'ended') break;
    }
  }

  function controlDown(action, player = 0) {
    const entity = players[player];
    if (phase !== 'playing' || !entity?.alive || (!DIRECTIONS[action] && action !== 'bomb')) return false;
    if (!entity.held.includes(action)) {
      entity.held.push(action);
      if (action === 'bomb') placeBomb(entity);
    }
    return true;
  }

  function controlUp(actions, player = 0) {
    const entity = players[player];
    if (!entity) return;
    if (!actions) entity.held = [];
    else {
      const released = Array.isArray(actions) ? actions : [actions];
      entity.held = entity.held.filter((action) => !released.includes(action));
    }
  }

  function cancelInput() { for (const player of players) player.held = []; }

  function keyControl(event) {
    const key = event.key?.toLowerCase();
    const first = { w: 'up', a: 'left', s: 'down', d: 'right', ' ': 'bomb', spacebar: 'bomb' };
    const second = { arrowup: 'up', arrowleft: 'left', arrowdown: 'down', arrowright: 'right', enter: 'bomb' };
    if (first[key]) return { action: first[key], player: 0 };
    if (second[key]) return { action: second[key], player: multiplayer ? 1 : 0 };
    if (event.code === 'Space') return { action: 'bomb', player: 0 };
    return null;
  }

  function label(value, x, y, size = 17, color = '#476356', align = 'center', weight = 700) {
    ctx.font = `${weight} ${size}px "PingFang SC", "Microsoft YaHei", sans-serif`;
    ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillStyle = color; ctx.fillText(value, x, y);
  }

  function box(x, y, w, h, r, fill, stroke) {
    ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
    ctx.fillStyle = fill; ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); }
  }

  function position(entity) { return { x: BOARD.x + (entity.x + 0.5) * TILE, y: BOARD.y + (entity.y + 0.5) * TILE }; }

  function render(time = elapsed) {
    ctx.save();
    ctx.fillStyle = '#e7f0e9'; ctx.fillRect(0, 0, 960, 560);
    box(18, 15, 924, 47, 16, '#fffdf5');
    label('奶蛙炸弹人', 39, 38, 23, '#456353', 'left');
    label(multiplayer ? `双人对战 · 第 ${round} 局 · ${wins[0]} : ${wins[1]}` : `${endless ? '无限' : '经典'} · 第 ${level}${endless ? '' : ' / 6'} 关`, 480, 38, 21);
    label(`${score} 分`, 915, 38, 21, '#879066', 'right');
    box(BOARD.x - 6, BOARD.y - 6, BOARD.width + 12, BOARD.height + 12, 13, '#aec4b4');
    for (let y = 0; y < ROWS; y += 1) for (let x = 0; x < COLS; x += 1) {
      const px = BOARD.x + x * TILE, py = BOARD.y + y * TILE, tile = grid[y][x];
      ctx.fillStyle = (x + y) % 2 ? '#e5eed9' : '#edf2e1'; ctx.fillRect(px, py, TILE, TILE);
      if (tile === 1) {
        box(px + 2, py + 3, TILE - 4, TILE - 5, 8, '#96b9aa', '#7a9e90');
        box(px + 6, py + 6, TILE - 12, 8, 3, '#b9d2c3');
      } else if (tile === 2) {
        box(px + 4, py + 5, TILE - 8, TILE - 8, 6, '#daba89', '#b59464');
        ctx.strokeStyle = '#b59464'; ctx.lineWidth = 3; ctx.beginPath();
        ctx.moveTo(px + 11, py + 12); ctx.lineTo(px + 37, py + 38); ctx.moveTo(px + 37, py + 12); ctx.lineTo(px + 11, py + 38); ctx.stroke();
        box(px + 6, py + 7, TILE - 12, 6, 2, '#eedbb5');
      }
    }
    if (!multiplayer) {
      const p = position(exit), unlocked = activeEnemies().length === 0;
      box(p.x - 18, p.y - 21, 36, 42, 8, unlocked ? '#debbda' : '#c8cdc4', unlocked ? '#a980ae' : '#9da999');
      label(unlocked ? '出口' : '锁', p.x, p.y, unlocked ? 13 : 17, unlocked ? '#805785' : '#7f9079');
    }
    for (const item of items) {
      const p = position(item), symbols = { capacity: '+弹', range: '+火', speed: '+速' };
      box(p.x - 15, p.y - 15, 30, 30, 8, '#fff4c0', '#d3bb6e');
      label(symbols[item.type], p.x, p.y, 13, '#ad873d');
    }
    for (const bomb of bombs) {
      const p = position(bomb), pulse = 1 + Math.sin(time * (bomb.fuse < 0.8 ? 25 : 8)) * 0.07;
      ctx.save(); ctx.translate(p.x, p.y); ctx.scale(pulse, pulse);
      box(-15, -11, 30, 28, 13, bomb.ownerId === 'p1' ? '#b491bd' : '#657b69', '#465b4e');
      label('哈', 0, 4, 15, '#fff4ce');
      ctx.strokeStyle = '#bc9469'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, -10); ctx.quadraticCurveTo(0, -24, 11, -18); ctx.stroke();
      ctx.fillStyle = '#e6a566'; ctx.beginPath(); ctx.arc(11, -18, 4, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    for (const fire of explosions) {
      ctx.globalAlpha = 0.75 + Math.sin(time * 35) * 0.14;
      for (const cell of fire.cells) {
        const p = position(cell); box(p.x - 22, p.y - 22, 44, 44, 15, '#f1cd76');
        box(p.x - 15, p.y - 14, 30, 28, 12, '#fff0b6'); label('哈', p.x, p.y, 18, '#c58d50');
      }
      ctx.globalAlpha = 1;
    }
    for (const enemy of enemies) if (enemy.alive) {
      const p = position({ x: enemy.renderX, y: enemy.renderY });
      box(p.x - 14, p.y - 19, 28, 36, 6, '#f4d8d6', '#be9692');
      box(p.x - 14, p.y - 19, 28, 9, 3, '#dba6a5');
      label('• •', p.x, p.y - 3, 15, '#875e68'); label('MILK', p.x, p.y + 10, 8, '#a87c82');
    }
    for (const player of players) {
      if (!player.alive) continue;
      const p = position({ x: player.renderX, y: player.renderY });
      ctx.globalAlpha = player.invincible > 0 ? 0.65 + Math.sin(time * 22) * 0.25 : 1;
      const color = player.playerIndex ? '#9f79b0' : '#5a9ba4';
      ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(p.x, p.y + 14, 19, 7, 0, 0, Math.PI * 2); ctx.stroke();
      drawFrog(ctx, p.x, p.y + 1, 31, { skinSlot: player.playerIndex, pose: player.held.some((action) => action in DIRECTIONS) ? 'run' : player.playerIndex ? 'angry' : 'smug' });
      ctx.globalAlpha = 1;
      box(p.x - 12, p.y - 28, 24, 13, 5, color); label(`${player.playerIndex + 1}P`, p.x, p.y - 21, 10, '#fffef5');
    }
    const first = players[0];
    label(multiplayer ? '1P 蓝圈' : '奶蛙装备', 85, 112, 17, '#537f7d');
    label(`♥ ${first.lives}`, 85, 148, 26, '#c47f88');
    label(`容量 ${first.capacity}`, 85, 204, 16); label(`火力 ${first.range}`, 85, 236, 16);
    label(`速度 ${first.speed.toFixed(1)}`, 85, 268, 15);
    label('W A S D', 85, 341, 16); label('空格 放弹', 85, 370, 15);
    label('约 2 秒后爆炸', 85, 428, 13, '#94a186');
    if (multiplayer) {
      const second = players[1];
      label('2P 紫圈', 875, 112, 17, '#9776a8'); label(`♥ ${second.lives}`, 875, 148, 26, '#c47f88');
      label(`容量 ${second.capacity}`, 875, 204, 16); label(`火力 ${second.range}`, 875, 236, 16);
      label('↑ ↓ ← →', 875, 341, 19); label('Enter 放弹', 875, 370, 15);
      label('三局两胜', 875, 428, 16, '#94a186');
    } else {
      label('奶盒还剩', 875, 112, 16); label(String(activeEnemies().length), 875, 148, 30, '#aa8e80');
      for (const [name, y] of [['+弹：多放一颗', 232], ['+火：炸得更远', 266], ['+速：跑得更快', 300]]) label(name, 875, y, 13, '#8a957b');
      label('清掉所有奶盒', 875, 373, 14); label('走进右下出口', 875, 400, 14);
    }
    label('放弹后立刻转弯 · 石墙挡笑气 · 木箱炸开后停止 · 小心连锁！', 480, 536, 16, '#7a8d74');
    for (const effect of effects) {
      const p = position(effect); ctx.globalAlpha = 1 - effect.age;
      label(effect.text, p.x, p.y - 22 - effect.age * 32, 16, '#a28a48');
    }
    ctx.globalAlpha = 1;
    if (phase === 'roundover' || phase === 'levelclear') {
      box(300, 222, 360, 105, 20, '#fffdf4ef', '#c4d2b7');
      label(phase === 'levelclear' ? !endless && level === 6 ? '六关全通，奶蛙毕业！' : '出口到达，下一关！' : lastRoundWinner === null ? '同时笑趴！本局重赛' : `${lastRoundWinner + 1}P 赢下本局`, 480, 258, 24);
      label(multiplayer ? `比分 ${wins[0]} : ${wins[1]}` : `第 ${level} 关通过`, 480, 294, 17, '#99a083');
    }
    ctx.restore();
  }

  loadLevel(); phase = 'idle';
  return {
    start, update, render, controlDown, controlUp, cancelInput,
    pointerDown() {}, pointerMove() {}, pointerUp() {},
    keyDown(event) {
      const control = keyControl(event); if (!control) return false;
      event.preventDefault?.();
      if (!(event.repeat && control.action === 'bomb')) controlDown(control.action, control.player);
      return true;
    },
    keyUp(event) { const control = keyControl(event); if (!control) return false; controlUp(control.action, control.player); return true; },
    destroy() { phase = 'ended'; cancelInput(); bombs = []; explosions = []; effects = []; },
    getState() {
      return { phase, score, endless, multiplayer, level, totalLevels: endless ? null : 6, round, wins: [...wins], winner,
        elapsed, phaseTime, destroyedCrates, boardRect: { ...BOARD }, grid: grid.map((row) => [...row]),
        exit: { ...exit, unlocked: activeEnemies().length === 0 },
        players: players.map((player) => ({ ...player, held: [...player.held] })),
        enemies: enemies.map((enemy) => ({ id: enemy.id, x: enemy.x, y: enemy.y, alive: enemy.alive, speed: enemy.speed })),
        bombs: bombs.map((bomb) => ({ ...bomb })),
        explosions: explosions.map((blast) => ({ ...blast, cells: blast.cells.map((cell) => ({ ...cell })) })),
        items: items.map((item) => ({ ...item })),
      };
    },
  };
}
