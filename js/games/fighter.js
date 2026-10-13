const W = 960;
const H = 560;
const FLOOR = 447;
const GRAVITY = 1750;
const TAU = Math.PI * 2;
const ACTIONS = ['left', 'right', 'jump', 'crouch', 'light', 'heavy', 'block', 'special'];
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
const emptyHeld = () => Object.fromEntries(ACTIONS.map(action => [action, false]));

export const CHARACTERS = Object.freeze({
  belly: Object.freeze({ name: '大肚奶蛙', tagline: '血厚拳重 · 近身冲击', hp: 145, speed: 238, size: 91, color: '#8eaf99', light: 15, heavy: 27, startup: 0.13, recovery: 0.24, reach: 98 }),
  speed: Object.freeze({ name: '暴躁奶蛙', tagline: '移动灵活 · 连拳飞踢', hp: 110, speed: 315, size: 82, color: '#e4ad72', light: 10, heavy: 20, startup: 0.075, recovery: 0.17, reach: 88 }),
  laugh: Object.freeze({ name: '狂笑奶蛙', tagline: '哈哈气功 · 远程消耗', hp: 120, speed: 263, size: 86, color: '#b6a1c9', light: 11, heavy: 19, startup: 0.11, recovery: 0.24, reach: 88 }),
});
const OPPONENTS = [
  { character: 'speed', name: '路边嚣张蛙' },
  { character: 'belly', name: '加奶不加价' },
  { character: 'laugh', name: '嘴强王者' },
  { character: 'speed', name: '蛙风少年' },
  { character: 'laugh', name: '笑声终结者' },
  { character: 'belly', name: '肚皮大擂主' },
];
const normalizeCharacter = value => Object.hasOwn(CHARACTERS, value) ? value : 'belly';
const KEYMAP = {
  KeyA: [0, 'left'], KeyD: [0, 'right'], KeyW: [0, 'jump'], KeyS: [0, 'crouch'],
  KeyJ: [0, 'light'], KeyK: [0, 'heavy'], KeyL: [0, 'block'], Space: [0, 'special'],
  ArrowLeft: [1, 'left'], ArrowRight: [1, 'right'], ArrowUp: [1, 'jump'], ArrowDown: [1, 'crouch'],
  Digit1: [1, 'light'], Numpad1: [1, 'light'], Digit2: [1, 'heavy'], Numpad2: [1, 'heavy'],
  Digit3: [1, 'block'], Numpad3: [1, 'block'], Enter: [1, 'special'], NumpadEnter: [1, 'special'],
};

export function createGame(env) {
  const { ctx, drawFrog, audio, onScore, onStatus, onEnd } = env;
  let endless = env.endless === true;
  let multiplayer = env.multiplayer === true;
  if (multiplayer) endless = false;
  let character = normalizeCharacter(env.character);
  let opponentCharacter = normalizeCharacter(env.opponentCharacter);
  let phase = 'idle';
  let stage = 1;
  let round = 1;
  let score = 0;
  let elapsed = 0;
  let phaseTime = 0;
  let hitStop = 0;
  let shake = 0;
  let attackId = 1;
  let roundWinner = null;
  let endSent = false;
  let wins = [0, 0];
  let players = [];
  let held = [emptyHeld(), emptyHeld()];
  let projectiles = [];
  let effects = [];
  let banner = '';
  let bannerTime = 0;
  let cpu = {};
  let statistics = {};

  const sound = kind => audio?.play?.(kind);
  const status = text => onStatus?.(text);
  const opponentInfo = () => OPPONENTS[(stage - 1) % OPPONENTS.length];
  const challenge = () => Math.min(stage - 1, 8);
  const isGrounded = player => player.y >= FLOOR - 0.1;
  const isCrouching = player => held[player.id].crouch && isGrounded(player) && player.hurtTime <= 0;
  const isBlocking = player => held[player.id].block && isGrounded(player) && !player.attack && player.hurtTime <= 0;
  const bodyHeight = player => isCrouching(player) ? 57 : 108;
  const playable = () => phase === 'fighting';

  function makePlayer(id, kind) {
    const data = CHARACTERS[kind];
    const cpuScale = id === 1 && !multiplayer ? 1 + challenge() * 0.025 : 1;
    const maxHp = Math.round(data.hp * cpuScale);
    return { id, character: kind, x: id === 0 ? 252 : 708, y: FLOOR, vx: 0, vy: 0,
      facing: id === 0 ? 1 : -1, hp: maxHp, maxHp, rage: 0, guard: 100,
      attack: null, buffered: null, hurtTime: 0, squash: 0, blockedFlash: 0,
      combo: 0, bestCombo: 0, lastHit: -10, hits: 0, damage: 0,
      damageScale: id === 1 && !multiplayer ? 1 + challenge() * 0.025 : 1 };
  }

  function resetStatistics() {
    statistics = { hits: [0, 0], blockedHits: [0, 0], whiffs: [0, 0], specials: [0, 0], damage: [0, 0], bestCombo: [0, 0] };
  }

  function cancelInput() {
    held = [emptyHeld(), emptyHeld()];
    for (const player of players) player.buffered = null;
  }

  function beginRound() {
    cancelInput();
    players = [makePlayer(0, character), makePlayer(1, multiplayer ? opponentCharacter : opponentInfo().character)];
    projectiles = [];
    effects = [];
    hitStop = 0;
    shake = 0;
    phaseTime = 0;
    phase = 'fighting';
    roundWinner = null;
    cpu = { thinkIn: 0.12, attackIn: 0.8, blockUntil: 0, crouchUntil: 0, attacks: 0, observedAttack: 0 };
    banner = multiplayer ? `第 ${round} 局 · 先赢两局！` : endless ? `无限擂台 · 第 ${stage} 位挑战者` : `第 ${stage} / ${OPPONENTS.length} 擂 · ${opponentInfo().name}`;
    bannerTime = 1.35;
    status(`${banner} · ${CHARACTERS[character].name}出战！轻拳快、重拳狠，攒满怒气放大招。`);
  }

  function start(options = {}) {
    if (typeof options?.endless === 'boolean') endless = options.endless;
    if (typeof options?.multiplayer === 'boolean') multiplayer = options.multiplayer;
    if (multiplayer) endless = false;
    if (options?.character !== undefined) character = normalizeCharacter(options.character);
    if (options?.opponentCharacter !== undefined) opponentCharacter = normalizeCharacter(options.opponentCharacter);
    stage = 1; round = 1; score = 0; elapsed = 0; attackId = 1; endSent = false;
    wins = [0, 0];
    resetStatistics();
    onScore?.(0);
    beginRound();
  }

  function addScore(points) {
    score += Math.max(0, Math.round(points));
    onScore?.(score);
  }

  function moveFor(player, type) {
    const data = CHARACTERS[player.character];
    if (type === 'light') return { startup: data.startup, active: 0.11, recovery: data.recovery,
      damage: data.light, reach: data.reach, knock: player.character === 'belly' ? 205 : 155,
      stun: 0.17, guardDamage: 18, pulses: [data.startup], projectile: false };
    if (type === 'heavy') {
      const ranged = player.character === 'laugh';
      const startup = player.character === 'speed' ? 0.18 : ranged ? 0.24 : 0.27;
      return { startup, active: 0.14, recovery: ranged ? 0.4 : player.character === 'speed' ? 0.3 : 0.4,
        damage: data.heavy, reach: player.character === 'belly' ? 132 : 116,
        knock: ranged ? 220 : 340, stun: 0.3, guardDamage: 38, pulses: [startup], projectile: ranged };
    }
    if (player.character === 'speed') return { startup: 0.12, active: 0.48, recovery: 0.35,
      damage: 17, reach: 120, knock: 115, stun: 0.24, guardDamage: 27, pulses: [0.12, 0.29, 0.46], projectile: false };
    if (player.character === 'laugh') return { startup: 0.16, active: 0.48, recovery: 0.4,
      damage: 22, reach: 115, knock: 165, stun: 0.24, guardDamage: 29, pulses: [0.16, 0.33, 0.5], projectile: true };
    return { startup: 0.24, active: 0.24, recovery: 0.45,
      damage: 54, reach: 196, knock: 490, stun: 0.48, guardDamage: 90, pulses: [0.24], projectile: false };
  }

  function beginAttack(player, type) {
    if (!playable() || player.hp <= 0 || player.attack || player.hurtTime > 0) return false;
    if (type === 'special' && player.rage < 100) {
      if (player.id === 0 || multiplayer) status(`怒气还差 ${Math.ceil(100 - player.rage)}！命中、挨打和防御都会攒怒气。`);
      return false;
    }
    if (type === 'special') {
      player.rage = 0;
      statistics.specials[player.id]++;
      status(`${player.id + 1}P 大招！${player.character === 'belly' ? '肚皮震天响！' : player.character === 'speed' ? '奶蛙三连闪！' : '蛙哈哈冲击波！'}`);
      sound('laugh');
    }
    player.attack = { id: attackId++, type, age: 0, direction: player.facing,
      crouched: isCrouching(player), hits: 0, emitted: 0, hitPulses: new Set(), ...moveFor(player, type) };
    player.buffered = null;
    if (type !== 'special') sound('flap');
    return true;
  }

  function jump(player) {
    if (!isGrounded(player) || player.hurtTime > 0 || player.attack || held[player.id].crouch || held[player.id].block) return false;
    player.vy = player.character === 'speed' ? -685 : -635;
    sound('flap');
    return true;
  }

  function controlDown(action, index = 0) {
    if (!ACTIONS.includes(action) || (index !== 0 && index !== 1) || (index === 1 && !multiplayer)) return false;
    if (!playable()) return true;
    if (held[index][action]) return true;
    held[index][action] = true;
    const player = players[index];
    if (action === 'jump') jump(player);
    if (['light', 'heavy', 'special'].includes(action)) {
      if (player.attack || player.hurtTime > 0) player.buffered = { type: action, ttl: 0.2 };
      else beginAttack(player, action);
    }
    return true;
  }

  function controlUp(action, index = 0) {
    if (!ACTIONS.includes(action) || (index !== 0 && index !== 1)) return false;
    held[index][action] = false;
    return true;
  }

  function keyBinding(event) {
    if (KEYMAP[event.code]) return KEYMAP[event.code];
    const key = event.key || '';
    const aliases = { a: 'KeyA', d: 'KeyD', w: 'KeyW', s: 'KeyS', j: 'KeyJ', k: 'KeyK', l: 'KeyL', ' ': 'Space', '1': 'Digit1', '2': 'Digit2', '3': 'Digit3' };
    return KEYMAP[aliases[key.toLowerCase()] || key];
  }

  function spark(x, y, color, label) {
    effects.push({ type: 'label', x, y: y - 24, label, color, life: 0.75, age: 0 });
    for (let i = 0; i < 9; i++) {
      const angle = i * TAU / 9;
      effects.push({ type: 'spark', x, y, vx: Math.cos(angle) * (80 + i * 8), vy: Math.sin(angle) * 100 - 20,
        color: i % 2 ? color : '#fff9dc', life: 0.32, age: 0 });
    }
  }

  function hit(attacker, defender, move, sourceX) {
    if (!playable() || defender.hp <= 0) return false;
    const direction = sourceX < defender.x ? 1 : -1;
    const frontal = Math.abs(sourceX - defender.x) < 3 || Math.sign(sourceX - defender.x) === defender.facing;
    let blocked = isBlocking(defender) && frontal;
    let guardBroken = false;
    if (blocked) {
      defender.guard -= move.guardDamage;
      if (defender.guard <= 0) {
        guardBroken = true;
        blocked = false;
        defender.guard = 35;
      }
    }
    const rawDamage = move.damage * attacker.damageScale * (guardBroken ? 1.12 : 1);
    const damage = Math.max(1, Math.round(rawDamage * (blocked ? move.type === 'special' ? 0.4 : 0.18 : 1)));
    // Guarding can absorb ordinary chip at one HP; a guard break or super can finish the round.
    const applied = blocked && move.type !== 'special' ? Math.min(damage, Math.max(0, defender.hp - 1)) : Math.min(damage, defender.hp);
    defender.hp = Math.max(0, defender.hp - applied);
    defender.hurtTime = blocked ? 0.055 : guardBroken ? 0.68 : move.stun;
    defender.blockedFlash = blocked ? 0.2 : 0;
    defender.squash = blocked ? 0.07 : 0.25;
    defender.vx = direction * move.knock * (blocked ? 0.24 : 1);
    if (!blocked && move.type === 'special' && attacker.character === 'belly' && isGrounded(defender)) defender.vy = -225;
    if (!blocked && defender.attack?.type !== 'special') defender.attack = null;
    defender.buffered = null;
    defender.rage = clamp(defender.rage + (blocked ? 14 : 8 + applied * 0.7), 0, 100);
    if (move.type !== 'special') attacker.rage = clamp(attacker.rage + (blocked ? 8 : 8 + applied * 0.8), 0, 100);
    move.hits++;
    if (blocked) {
      statistics.blockedHits[attacker.id]++;
    } else {
      attacker.combo = elapsed - attacker.lastHit < 1.55 ? attacker.combo + 1 : 1;
      attacker.lastHit = elapsed;
      attacker.bestCombo = Math.max(attacker.bestCombo, attacker.combo);
      attacker.hits++;
      defender.combo = 0;
      statistics.hits[attacker.id]++;
      statistics.bestCombo[attacker.id] = Math.max(statistics.bestCombo[attacker.id], attacker.combo);
    }
    attacker.damage += applied;
    statistics.damage[attacker.id] += applied;
    if (attacker.id === 0) addScore(applied * (blocked ? 2 : 5));
    const hitY = Math.max(defender.y - bodyHeight(defender) + 15, defender.y - 66);
    spark(defender.x - direction * 22, hitY, blocked ? '#a5c5ce' : guardBroken ? '#d89a72' : '#e6b05f',
      guardBroken ? '破防！' : blocked ? '挡住！' : move.type === 'special' ? `大招 −${applied}` : `−${applied}`);
    hitStop = Math.max(hitStop, blocked ? 0.035 : move.type === 'special' ? 0.095 : 0.062);
    shake = Math.max(shake, blocked ? 1.5 : move.type === 'special' ? 7 : 3.5);
    sound(blocked ? 'pop' : 'hit');
    if (!blocked && attacker.combo >= 2) status(`${attacker.id + 1}P ${attacker.combo} 连击！脸挤扁了，笑声还在。`);
    if (defender.hp <= 0) finishRound(attacker.id);
    return !blocked;
  }

  function emitProjectile(player, attack) {
    projectiles.push({ owner: player.id, x: player.x + attack.direction * 53,
      y: player.y - (attack.crouched ? 39 : 81), vx: attack.direction * (attack.type === 'special' ? 610 : 525),
      radius: attack.type === 'special' ? 19 : 14, age: 0, life: 1.6,
      move: { ...attack, hits: 0, hitPulses: undefined } });
    sound('launch');
  }

  function updateAttack(player, dt) {
    const attack = player.attack;
    if (!attack) return;
    attack.age += dt;
    const target = players[1 - player.id];
    for (let index = 0; index < attack.pulses.length; index++) {
      const begins = attack.pulses[index];
      if (attack.projectile) {
        if (attack.age >= begins && attack.emitted <= index) {
          emitProjectile(player, attack);
          attack.emitted++;
        }
      } else if (!attack.hitPulses.has(index) && attack.age >= begins && attack.age <= begins + attack.active / attack.pulses.length) {
        const dx = (target.x - player.x) * attack.direction;
        const attackY = player.y - (attack.crouched ? 37 : 66);
        const vertical = attackY + 26 >= target.y - bodyHeight(target) && attackY - 26 <= target.y - 8;
        if (dx > -18 && dx <= attack.reach && vertical) {
          attack.hitPulses.add(index);
          hit(player, target, attack, player.x);
        }
      }
      if (!playable()) return;
    }
    if (attack.age >= attack.startup + attack.active + attack.recovery) {
      if (!attack.projectile && attack.hits === 0) statistics.whiffs[player.id]++;
      player.attack = null;
    }
  }

  function updateCpu(dt) {
    if (multiplayer) return;
    const player = players[1], target = players[0];
    const input = held[1];
    for (const action of ACTIONS) input[action] = false;
    cpu.attackIn -= dt;
    cpu.thinkIn -= dt;
    if (player.hurtTime > 0) return;
    const distance = Math.abs(player.x - target.x);
    if (elapsed < cpu.blockUntil && !player.attack) input.block = true;
    if (elapsed < cpu.crouchUntil && !player.attack) input.crouch = true;
    if (!input.block) {
      const desired = player.character === 'laugh' ? 205 : 81;
      const toward = player.x < target.x ? 'right' : 'left';
      if (distance > desired) input[toward] = true;
      else if (player.character === 'laugh' && distance < 95 && !player.attack) input[toward === 'right' ? 'left' : 'right'] = true;
    }
    if (cpu.thinkIn > 0) return;
    cpu.thinkIn = 0.1;
    if (target.attack && target.attack.id !== cpu.observedAttack && target.attack.age >= 0.055) {
      cpu.observedAttack = target.attack.id;
      if (distance < 235 && Math.random() < 0.15 + challenge() * 0.035) {
        cpu.blockUntil = elapsed + 0.28 + Math.random() * 0.18;
        input.block = true;
        input.left = false; input.right = false;
      }
    }
    const incoming = projectiles.some(p => p.owner === 0 && Math.abs(p.x - player.x) < 210);
    if (incoming && !player.attack && Math.random() < 0.45) {
      input.crouch = true;
      input.block = true;
      cpu.blockUntil = elapsed + 0.3;
      cpu.crouchUntil = elapsed + 0.3;
    }
    if (player.attack || input.block || cpu.attackIn > 0) return;
    const reach = player.character === 'laugh' ? 450 : 118;
    if (distance > reach || Math.abs(player.y - target.y) > 95) return;
    const type = player.rage >= 100 ? 'special' : player.character === 'laugh' || cpu.attacks % 3 === 2 || held[0].block ? 'heavy' : 'light';
    if (beginAttack(player, type)) {
      cpu.attacks++;
      cpu.attackIn = Math.max(0.56, 1.02 - challenge() * 0.05) + Math.random() * 0.23;
    }
  }

  function updatePlayer(player, dt) {
    const input = held[player.id];
    player.hurtTime = Math.max(0, player.hurtTime - dt);
    player.squash = Math.max(0, player.squash - dt);
    player.blockedFlash = Math.max(0, player.blockedFlash - dt);
    if (elapsed - player.lastHit > 1.55) player.combo = 0;
    if (!player.attack) player.facing = players[1 - player.id].x >= player.x ? 1 : -1;
    if (!input.block) player.guard = Math.min(100, player.guard + 17 * dt);
    player.rage = Math.min(100, player.rage + dt * 0.75);
    if (player.buffered) {
      player.buffered.ttl -= dt;
      if (player.buffered.ttl <= 0) player.buffered = null;
      else if (!player.attack && player.hurtTime <= 0) beginAttack(player, player.buffered.type);
    }
    let speed = CHARACTERS[player.character].speed;
    if (isCrouching(player)) speed *= 0.24;
    if (isBlocking(player)) speed = 0;
    if (!isGrounded(player)) speed *= 0.9;
    if (player.attack) speed *= player.attack.type === 'light' ? 0.24 : 0.1;
    let desired = (Number(input.right) - Number(input.left)) * speed;
    if (player.character === 'speed' && player.attack?.type === 'special' && player.attack.age < 0.52) desired = player.attack.direction * 470;
    if (player.hurtTime <= 0) player.vx += (desired - player.vx) * (1 - Math.exp(-dt * 19));
    else player.vx *= Math.exp(-dt * 5);
    player.x = clamp(player.x + player.vx * dt, 76, W - 76);
    player.vy += GRAVITY * dt;
    player.y += player.vy * dt;
    if (player.y >= FLOOR) { player.y = FLOOR; player.vy = 0; }
  }

  function separatePlayers() {
    const a = players[0], b = players[1];
    const overlapY = Math.min(a.y, b.y) - Math.max(a.y - bodyHeight(a), b.y - bodyHeight(b));
    const distance = b.x - a.x;
    if (overlapY > 15 && Math.abs(distance) < 76) {
      const direction = distance >= 0 ? 1 : -1;
      const correction = (76 - Math.abs(distance)) / 2;
      a.x = clamp(a.x - direction * correction, 76, W - 76);
      b.x = clamp(b.x + direction * correction, 76, W - 76);
    }
  }

  function finishRound(winner) {
    if (!playable()) return;
    roundWinner = winner;
    wins[winner]++;
    phase = 'roundover';
    phaseTime = 0;
    projectiles = [];
    cancelInput();
    if (winner === 0) addScore(300 + Math.round(players[0].hp * 2));
    banner = multiplayer ? `${winner + 1}P 拿下本局！  ${wins[0]} : ${wins[1]}`
      : winner === 0 ? `第 ${stage} 擂拿下！蛙哈哈！` : '被笑倒了！奶蛙先歇一会儿。';
    bannerTime = 3;
    status(banner);
    sound(winner === 0 || multiplayer ? 'win' : 'laugh');
  }

  function finishMatch(winner) {
    if (endSent) return;
    endSent = true;
    phase = 'ended';
    cancelInput();
    const won = winner === 0;
    onEnd?.({ score, endless, multiplayer, character, opponentCharacter, won,
      winner: winner + 1, winnerPlayer: winner, stage, round, wins: [...wins],
      title: multiplayer ? `${winner + 1}P 赢下奶蛙擂台！` : won ? '六连胜！奶蛙拳王诞生！' : endless ? `无限擂台，闯到第 ${stage} 擂！` : '脸挤扁了，笑容还在。',
      message: multiplayer ? `${wins[0]} : ${wins[1]}，三局两胜结束。换个角色，再来一场！`
        : won ? `六位对手全部击败！最高 ${statistics.bestCombo[0]} 连击，释放 ${statistics.specials[0]} 次大招。`
          : `拿下 ${wins[0]} 擂，最高 ${statistics.bestCombo[0]} 连击。格挡轻拳，重拳破防，怒气满了就放大招！`,
      stats: Object.fromEntries(Object.entries(statistics).map(([key, value]) => [key, [...value]])),
    });
  }

  function updateEffects(dt) {
    for (const effect of effects) {
      effect.age += dt;
      if (effect.type === 'spark') { effect.x += effect.vx * dt; effect.y += effect.vy * dt; effect.vy += 230 * dt; }
    }
    effects = effects.filter(effect => effect.age < effect.life);
    shake *= Math.exp(-dt * 13);
    bannerTime = Math.max(0, bannerTime - dt);
  }

  function step(dt) {
    if (hitStop > 0) { hitStop = Math.max(0, hitStop - dt); return; }
    updateCpu(dt);
    for (const player of players) updatePlayer(player, dt);
    separatePlayers();
    for (const player of players) {
      updateAttack(player, dt);
      if (!playable()) return;
    }
    for (const projectile of projectiles) {
      projectile.age += dt;
      projectile.x += projectile.vx * dt;
      const target = players[1 - projectile.owner];
      const closestY = clamp(projectile.y, target.y - bodyHeight(target), target.y - 6);
      if (Math.abs(projectile.x - target.x) < 35 + projectile.radius && Math.abs(projectile.y - closestY) < projectile.radius) {
        hit(players[projectile.owner], target, projectile.move, projectile.x);
        projectile.age = projectile.life;
        if (!playable()) return;
      }
      if ((projectile.age >= projectile.life || projectile.x < -60 || projectile.x > W + 60) && projectile.move.hits === 0) statistics.whiffs[projectile.owner]++;
    }
    projectiles = projectiles.filter(p => p.age < p.life && p.x > -60 && p.x < W + 60);
  }

  function update(dt) {
    if (phase === 'idle' || phase === 'ended') return;
    dt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.05);
    elapsed += dt;
    phaseTime += dt;
    updateEffects(dt);
    if (phase === 'roundover') {
      if (phaseTime >= 1.9) {
        if (multiplayer) {
          if (wins[roundWinner] >= 2) finishMatch(roundWinner);
          else { round++; beginRound(); }
        } else if (roundWinner === 1) finishMatch(1);
        else if (!endless && stage >= OPPONENTS.length) finishMatch(0);
        else { stage++; round++; beginRound(); }
      }
      return;
    }
    const steps = Math.max(1, Math.ceil(dt * 120));
    for (let i = 0; i < steps && playable(); i++) step(dt / steps);
  }

  function rounded(x, y, w, h, radius, fill, stroke) {
    ctx.beginPath(); ctx.roundRect(x, y, Math.max(0, w), Math.max(0, h), radius);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); }
  }

  function text(value, x, y, size = 18, color = '#5f584c', align = 'center', weight = 700) {
    ctx.fillStyle = color; ctx.font = `${weight} ${size}px system-ui, "Microsoft YaHei", sans-serif`;
    ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillText(value, x, y);
  }

  function drawArena(time) {
    const scenes = [['#f7eddb', '#e3dcc4', '#a9bca0'], ['#f4e2d9', '#decabd', '#b2b99f'], ['#e9e6f0', '#cdcbdc', '#aaaec2']];
    const colors = scenes[(stage - 1) % scenes.length];
    ctx.fillStyle = colors[0]; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff8e8'; ctx.beginPath(); ctx.arc(785, 205, 57, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#d8c9ae'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(22, 144); ctx.quadraticCurveTo(W / 2, 207, W - 22, 144); ctx.stroke();
    for (let i = 0; i < 13; i++) {
      const x = 49 + i * 71, y = 149 + Math.sin(i / 12 * Math.PI) * 30;
      ctx.fillStyle = ['#d8aa94', '#b5c3a0', '#e7c479'][i % 3];
      ctx.beginPath(); ctx.moveTo(x - 14, y); ctx.lineTo(x + 14, y + 1); ctx.lineTo(x + Math.sin(time * 2 + i) * 3, y + 25); ctx.closePath(); ctx.fill();
    }
    rounded(386, 179, 188, 46, 12, '#fff9e9', '#d6bfa3');
    text('奶  蛙  大  乱  斗', W / 2, 203, 20, '#8f7051');
    ctx.fillStyle = colors[1]; ctx.beginPath(); ctx.moveTo(0, 337); ctx.quadraticCurveTo(230, 251, 460, 340);
    ctx.quadraticCurveTo(695, 266, W, 332); ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.fill();
    for (let i = 0; i < 10; i++) {
      const x = 61 + i * 94, y = 328 + Math.sin(time * 2 + i) * 3;
      rounded(x - 31, y + 9, 62, 37, 9, i % 2 ? '#d1bf9d' : '#c4b89b');
      drawFrog(ctx, x, y, 29, { expression: 'laugh', scaleY: 1 + Math.sin(time * 3 + i) * 0.03 });
    }
    for (const x of [84, W - 84]) {
      rounded(x - 11, 282, 22, 173, 7, '#aa8266', '#806d56');
      rounded(x - 18, 283, 36, 57, 12, '#d79383', '#a76f61');
    }
    for (const [y, color] of [[310, '#bd8b7a'], [352, '#fff8df'], [392, '#a1b7a6']]) {
      ctx.strokeStyle = color; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(86, y); ctx.quadraticCurveTo(W / 2, y + 11, W - 86, y); ctx.stroke();
    }
    ctx.fillStyle = '#e9d2ae'; ctx.beginPath(); ctx.moveTo(42, FLOOR - 10); ctx.lineTo(W - 42, FLOOR - 10);
    ctx.lineTo(W, 513); ctx.lineTo(0, 513); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#bd9a75'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, 513); ctx.lineTo(W, 513); ctx.stroke();
    ctx.strokeStyle = '#cfb58b'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(W / 2, 470, 240, 31, 0, 0, TAU); ctx.stroke();
    text('蛙拳道 · 点到脸扁', W / 2, 478, 17, '#bda17b');
    ctx.fillStyle = colors[2]; ctx.fillRect(0, 516, W, H - 516);
    text(multiplayer ? '1P  A D / W S / J K L / 空格     ·     2P  ← → / ↑ ↓ / 1 2 3 / Enter'
      : 'A D 移动 · W 跳跃 · S 蹲下 · J 轻拳 · K 重拳 · L 防御 · 空格大招', W / 2, 538, 14, '#4e6155');
  }

  function drawPlayer(player, time) {
    const data = CHARACTERS[player.character];
    const knocked = player.hp <= 0;
    const crouched = isCrouching(player);
    const blocked = isBlocking(player) || player.blockedFlash > 0;
    const attack = player.attack;
    const hurt = player.squash > 0;
    const moving = Math.abs(player.vx) > 45 && isGrounded(player);
    const breathing = phase === 'idle' ? Math.sin(time * 2.2 + player.id) * 0.025 : 0;
    ctx.fillStyle = '#6a634224'; ctx.beginPath();
    ctx.ellipse(player.x, FLOOR + 8, knocked ? 63 : 48, 8, 0, 0, TAU); ctx.fill();
    if (player.rage >= 100) {
      ctx.strokeStyle = '#edbf58'; ctx.lineWidth = 3; ctx.globalAlpha = 0.48 + Math.sin(time * 6) * 0.15;
      ctx.beginPath(); ctx.ellipse(player.x, player.y - 54, 68, 83, 0, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1;
    }
    const squashX = knocked ? 1.34 : hurt ? 1.28 : attack?.type === 'special' && player.character === 'belly' ? 1.22 : 1;
    const squashY = knocked ? 0.42 : crouched ? 0.64 : hurt ? 0.77 : 1 + breathing;
    const centerY = player.y - data.size * 0.57 * squashY;
    let expression = hurt || knocked ? 'squish' : attack ? attack.type === 'special' ? 'laugh' : 'angry' : blocked ? 'smug' : 'happy';
    let pose = hurt || knocked ? undefined : attack?.type === 'special' ? player.character === 'belly' ? 'belly' : 'laugh' : moving ? 'run' : undefined;
    drawFrog(ctx, player.x, centerY, data.size, { expression, pose,
      scaleX: squashX * player.facing, scaleY: squashY, rotation: knocked ? player.facing * -0.08 : hurt ? player.facing * 0.09 : 0 });
    rounded(player.x - 35, FLOOR + 16, 70, 17, 8, data.color);
    text(player.id === 0 ? '1P' : multiplayer ? '2P' : 'CPU', player.x, FLOOR + 24, 11, '#fffdf4');
    if (blocked) {
      ctx.strokeStyle = player.blockedFlash > 0 ? '#f8fdff' : '#96b5c1'; ctx.lineWidth = player.blockedFlash > 0 ? 6 : 4;
      ctx.beginPath(); ctx.arc(player.x + player.facing * 27, player.y - (crouched ? 41 : 63), crouched ? 41 : 61,
        player.facing > 0 ? -1.13 : Math.PI - 1.13, player.facing > 0 ? 1.13 : Math.PI + 1.13); ctx.stroke();
    }
    if (attack && !attack.projectile && attack.age >= attack.startup && attack.age < attack.startup + attack.active) {
      const extension = attack.type === 'special' ? attack.reach * 0.64 : attack.reach * 0.6;
      const fistX = player.x + attack.direction * extension;
      const fistY = player.y - (attack.crouched ? 40 : 65);
      ctx.strokeStyle = attack.type === 'special' ? '#e9c16b' : '#f8e8b3'; ctx.lineWidth = attack.type === 'heavy' ? 18 : 13;
      ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(player.x + attack.direction * 27, fistY + 5); ctx.lineTo(fistX, fistY); ctx.stroke();
      rounded(fistX - 15, fistY - 14, 30, 28, 11, '#fff1c9', '#bfa878');
      ctx.strokeStyle = '#fff9dc'; ctx.lineWidth = 3;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath(); ctx.moveTo(fistX + attack.direction * 21, fistY - 15 + i * 14);
        ctx.lineTo(fistX + attack.direction * (36 + (i % 2) * 8), fistY - 18 + i * 17); ctx.stroke();
      }
    }
    if (player.combo >= 2 && playable()) text(`${player.combo} 连击`, player.x, player.y - 154, 22, '#a27749');
  }

  function drawHud() {
    for (const player of players) {
      const left = player.id === 0, x = left ? 26 : 588, data = CHARACTERS[player.character];
      const label = left ? `1P · ${data.name}` : multiplayer ? `2P · ${data.name}` : `CPU · ${opponentInfo().name}`;
      text(label, left ? x : x + 346, 26, 18, '#665a48', left ? 'left' : 'right');
      rounded(x, 45, 346, 26, 12, '#ded4c0', '#c8bda8');
      const hpWidth = 338 * player.hp / player.maxHp;
      if (hpWidth > 0) rounded(left ? x + 4 : x + 342 - hpWidth, 49, hpWidth, 18, Math.min(8, hpWidth / 2), player.hp < player.maxHp * 0.3 ? '#d89480' : data.color);
      text(`${Math.ceil(player.hp)} / ${player.maxHp}`, x + 173, 58, 12, '#fffdf5');
      rounded(x, 79, 246, 11, 5, '#dfd5c0');
      if (player.rage > 0) rounded(x, 79, 246 * player.rage / 100, 11, 5, player.rage >= 100 ? '#e3b54b' : '#dfc482');
      text(player.rage >= 100 ? '怒气满 · 大招！' : `怒气 ${Math.floor(player.rage)}%`, x + 346, 85, 12, '#99805a', 'right');
      if (multiplayer) {
        for (let i = 0; i < 2; i++) {
          ctx.fillStyle = i < wins[player.id] ? '#dda64f' : '#e0d6c2'; ctx.beginPath(); ctx.arc(x + 9 + i * 22, 109, 6, 0, TAU); ctx.fill();
        }
      } else text(data.tagline, x, 108, 12, '#958673', 'left', 500);
    }
    text(multiplayer ? `双人 · 第 ${round} 局` : endless ? `无限 · 第 ${stage} 擂` : `第 ${stage} / ${OPPONENTS.length} 擂`, W / 2, 30, 14, '#8f785d');
    text('VS', W / 2, 62, 30, '#b48f60', 'center', 900);
    text(multiplayer ? `${wins[0]} : ${wins[1]}` : `${score} 分`, W / 2, 94, 15, '#a58b69');
  }

  function render(time = elapsed) {
    ctx.save();
    drawArena(time);
    if (shake > 0.2) ctx.translate(Math.sin(elapsed * 91) * shake, Math.cos(elapsed * 79) * shake * 0.35);
    for (const player of [...players].sort((a, b) => a.y - b.y)) drawPlayer(player, time);
    for (const projectile of projectiles) {
      const color = CHARACTERS[players[projectile.owner].character].color;
      ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.fillStyle = '#fff9e6';
      ctx.beginPath(); ctx.arc(projectile.x, projectile.y, projectile.radius, 0, TAU); ctx.fill(); ctx.stroke();
      text('哈', projectile.x, projectile.y, projectile.radius + 3, '#9a78b0');
      ctx.globalAlpha = 0.45; ctx.beginPath();
      ctx.arc(projectile.x - Math.sign(projectile.vx) * 24, projectile.y, projectile.radius * 0.62, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1;
    }
    for (const effect of effects) {
      ctx.globalAlpha = Math.min(1, (1 - effect.age / effect.life) * 2);
      if (effect.type === 'label') text(effect.label, effect.x, effect.y - effect.age * 42, 22, effect.color);
      else {
        ctx.fillStyle = effect.color; ctx.save(); ctx.translate(effect.x, effect.y); ctx.rotate(effect.age * 8);
        ctx.fillRect(-4, -4, 8, 8); ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
    drawHud();
    if (bannerTime > 0) {
      const over = phase === 'roundover' || phase === 'ended';
      const boxY = over ? 218 : 239;
      rounded(250, boxY, 460, over ? 100 : 49, 18, '#fff9e9ed', '#d8c49f');
      text(banner, W / 2, boxY + (over ? 35 : 25), over ? 25 : 18, '#866442');
      if (over) text(multiplayer ? `比分 ${wins[0]} : ${wins[1]} · 先赢两局获胜` : roundWinner === 0 ? '喘口气，下一位准备！' : '试试防御，再找机会反击。', W / 2, boxY + 73, 16, '#9b886b');
    }
    ctx.restore();
  }

  function getState() {
    return { phase, score, endless, multiplayer, character, opponentCharacter,
      stage, round, totalStages: endless || multiplayer ? null : OPPONENTS.length,
      wins: [...wins], roundWinner, hitStop, elapsed, held: held.map(input => ({ ...input })),
      players: players.map(player => ({ id: player.id, character: player.character,
        x: player.x, y: player.y, vx: player.vx, vy: player.vy, hp: player.hp, maxHp: player.maxHp,
        rage: player.rage, guard: player.guard, facing: player.facing,
        grounded: isGrounded(player), blocking: isBlocking(player), crouching: isCrouching(player),
        hurtTime: player.hurtTime, combo: player.combo, bestCombo: player.bestCombo,
        attack: player.attack ? { id: player.attack.id, type: player.attack.type, age: player.attack.age, startup: player.attack.startup, hits: player.attack.hits } : null })),
      projectiles: projectiles.map(p => ({ owner: p.owner, x: p.x, y: p.y, vx: p.vx, radius: p.radius })),
      stats: Object.fromEntries(Object.entries(statistics).map(([key, value]) => [key, [...value]])),
    };
  }

  resetStatistics();
  players = [makePlayer(0, character), makePlayer(1, multiplayer ? opponentCharacter : opponentInfo().character)];
  return { start, update, render, controlDown, controlUp, cancelInput, getState,
    keyDown(event) { const binding = keyBinding(event); if (!binding) return false; if (!event.repeat) controlDown(binding[1], binding[0]); return binding[0] === 0 || multiplayer; },
    keyUp(event) { const binding = keyBinding(event); if (!binding) return false; controlUp(binding[1], binding[0]); return binding[0] === 0 || multiplayer; },
    pointerDown() {}, pointerMove() {}, pointerUp(point) { if (point?.cancelled) cancelInput(); },
    destroy() { cancelInput(); phase = 'idle'; projectiles = []; effects = []; },
  };
}
