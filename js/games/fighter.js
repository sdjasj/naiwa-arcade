import { createFighterInput } from './fighter-input.js?v=8fb8b395f3ed';

const W = 960;
const H = 560;
const FLOOR = 447;
const GRAVITY = 1750;
const TAU = Math.PI * 2;
const ACTIONS = ['left', 'right', 'jump', 'crouch', 'light', 'heavy', 'lightKick', 'heavyKick', 'block', 'special', 'roll', 'throw', 'max'];
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
  KeyU: [0, 'lightKick'], KeyI: [0, 'heavyKick'], KeyO: [0, 'roll'], KeyH: [0, 'throw'], KeyN: [0, 'max'],
  KeyJ: [0, 'light'], KeyK: [0, 'heavy'], KeyL: [0, 'block'], Space: [0, 'special'],
  ArrowLeft: [1, 'left'], ArrowRight: [1, 'right'], ArrowUp: [1, 'jump'], ArrowDown: [1, 'crouch'],
  Digit1: [1, 'light'], Numpad1: [1, 'light'], Digit2: [1, 'heavy'], Numpad2: [1, 'heavy'],
  Digit4: [1, 'lightKick'], Numpad4: [1, 'lightKick'], Digit5: [1, 'heavyKick'], Numpad5: [1, 'heavyKick'],
  Digit0: [1, 'roll'], Numpad0: [1, 'roll'], Digit6: [1, 'throw'], Numpad6: [1, 'throw'], Digit9: [1, 'max'], Numpad9: [1, 'max'],
  Digit3: [1, 'block'], Numpad3: [1, 'block'], Enter: [1, 'special'], NumpadEnter: [1, 'special'],
};

export function createGame(env) {
  const { ctx, drawFrog, audio, onScore, onStatus, onEnd } = env;
  let endless = env.endless === true, multiplayer = env.multiplayer === true, training = env.training === true;
  if (multiplayer || training) endless = false;
  let character = normalizeCharacter(env.character), opponentCharacter = normalizeCharacter(env.opponentCharacter);
  let trainingGuard = ['stand', 'crouch'].includes(env.trainingGuard) ? env.trainingGuard : 'none';
  let phase = 'idle', stage = 1, round = 1, score = 0, elapsed = 0, phaseTime = 0, timer = 99;
  let hitStop = 0, shake = 0, attackId = 1, roundWinner = null, endSent = false;
  let wins = [0, 0], players = [], held = [emptyHeld(), emptyHeld()], projectiles = [], effects = [];
  let banner = '', bannerTime = 0, cpu = {}, statistics = {};
  const inputs = [createFighterInput(), createFighterInput()];
  const sound = kind => audio?.play?.(kind);
  const status = value => onStatus?.(value);
  const opponentInfo = () => OPPONENTS[(stage - 1) % OPPONENTS.length];
  const challenge = () => Math.min(stage - 1, 8);
  const playable = () => phase === 'fighting';
  const isGrounded = p => p.y >= FLOOR - 0.1 && p.vy >= 0;
  const airborne = p => !isGrounded(p);
  const isCrouching = p => held[p.id].crouch && isGrounded(p) && p.hurtTime <= 0 && p.knockdown <= 0;
  const backwardHeld = p => held[p.id][p.facing > 0 ? 'left' : 'right'];
  const forwardHeld = p => held[p.id][p.facing > 0 ? 'right' : 'left'];
  const isBlocking = p => isGrounded(p) && !p.attack && p.hurtTime <= 0 && p.knockdown <= 0 && !p.rollTime && p.grabbedBy === null
    && (held[p.id].block || backwardHeld(p) || p.guardStun > 0);
  const bodyHeight = p => p.knockdown > 0 ? 36 : isCrouching(p) ? 62 : 112;
  const hurtbox = p => ({ x: p.x - 31, y: p.y - bodyHeight(p), width: 62, height: bodyHeight(p) - 5 });
  const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

  function makePlayer(id, kind) {
    const data = CHARACTERS[kind], scale = id === 1 && !multiplayer && !training ? 1 + challenge() * 0.025 : 1;
    return { id, character: kind, x: id ? 708 : 252, y: FLOOR, vx: 0, vy: 0, airVx: 0,
      facing: id ? -1 : 1, hp: Math.round(data.hp * scale), maxHp: Math.round(data.hp * scale),
      rage: training ? 100 : 0, meter: training ? 100 : 0, stocks: training ? 3 : 0, maxTime: 0, guard: 100,
      attack: null, buffered: null, hurtTime: 0, guardStun: 0, squash: 0, blockedFlash: 0,
      combo: 0, bestCombo: 0, comboOwner: null, lastHit: -10, hits: 0, damage: 0, lastDamage: 0,
      movement: 'idle', running: false, backstep: 0, rollTime: 0, rollDirection: 1,
      knockdown: 0, wakeTime: 0, landingRecovery: 0, grabbedBy: null, grabTime: 0, throwInvulnerable: 0,
      jumpAt: -10, jumpType: null, jumpSpeed: 640, lastCrouch: -10, visualHitId: 0, damageScale: scale,
      comboButtons: '', recoverUntil: -1, canRecover: false,
      animation: { name: 'idle', key: 'idle', state: 'idle', phase: 'loop', time: 0, progress: null,
        previous: null, blend: 1, transitions: 0, scaleX: 1, scaleY: 1, rotation: 0,
        offsetX: 0, impulse: 0, impulseAge: 1, grounded: true, landing: 0 } };
  }

  function resetStatistics() {
    statistics = Object.fromEntries(['hits', 'blockedHits', 'whiffs', 'specials', 'damage', 'bestCombo', 'throws', 'throwTechs', 'rolls', 'cancels'].map(key => [key, [0, 0]]));
  }

  function animationFor(p) {
    if (p.hp <= 0 || p.knockdown > 0) return { name: 'hurt', key: 'knockdown', state: p.hp <= 0 ? 'knockout' : 'knockdown', phase: 'down' };
    if ((phase === 'roundover' || phase === 'ended') && p.id === roundWinner) return { name: 'laugh', key: 'victory', state: 'victory', phase: 'loop' };
    if (p.hurtTime > 0 || p.grabbedBy !== null) return { name: 'hurt', key: `hurt:${p.visualHitId}`, state: 'hurt', phase: 'impact' };
    if (p.guardStun > 0) return { name: 'guard', key: `guard:${p.visualHitId}`, state: 'guard-impact', phase: 'impact' };
    if (p.rollTime > 0) return { name: 'dash', key: 'roll', state: 'roll', phase: p.rollTime > 0.12 ? 'evade' : 'recovery' };
    if (p.attack) {
      const a = p.attack;
      const name = a.airborne ? (a.kick ? 'airHeavy' : 'airLight') : a.kick ? 'kick'
        : a.type === 'special' ? p.character === 'speed' ? 'dash' : p.character === 'laugh' ? 'laugh' : 'heavy'
          : a.type === 'command' ? (a.projectile ? 'laugh' : 'heavy') : a.type === 'throw' ? 'heavy' : a.type;
      return { name, key: `attack:${a.id}`, state: a.airborne ? (a.heavy ? 'air-heavy' : 'air-light') : a.type,
        phase: a.age < a.startup ? 'startup' : a.age < a.startup + a.active ? 'active' : 'recovery' };
    }
    if (airborne(p)) return { name: 'jump', key: 'jump', state: 'jump', phase: p.vy < 0 ? 'ascent' : 'descent' };
    if (p.backstep > 0) return { name: 'backwalk', key: 'backstep', state: 'backstep', phase: 'evade' };
    if (isBlocking(p) && (held[p.id].block || p.guardStun > 0)) return { name: 'guard', key: 'guard', state: 'guard', phase: 'hold' };
    if (isCrouching(p)) return { name: 'guard', key: 'crouch', state: 'crouch', phase: 'hold' };
    if (Math.abs(p.vx) > (['walk', 'backwalk', 'run'].includes(p.animation.state) ? 16 : 35)) {
      const back = p.vx * p.facing < 0;
      return { name: back ? 'backwalk' : 'run', key: back ? 'backwalk' : p.running ? 'run' : 'walk',
        state: back ? 'backwalk' : p.running ? 'run' : 'walk', phase: 'loop' };
    }
    return { name: 'idle', key: 'idle', state: 'idle', phase: 'loop' };
  }

  function updateAnimation(p, dt) {
    const a = p.animation, next = animationFor(p);
    if (a.key !== next.key) {
      a.previous = { name: a.name, time: a.time * (a.state === 'walk' ? 0.65 : 1), ...(a.progress === null ? {} : { progress: a.progress }) };
      Object.assign(a, next, { time: 0, progress: null, blend: next.phase === 'impact' || next.phase === 'down' ? 0.82 : 0 }); a.transitions++;
    }
    a.phase = next.phase; a.time += dt;
    a.blend = Math.min(1, a.blend + dt / (p.attack ? 0.05 : 0.08));
    if (a.blend >= 1) a.previous = null;
    if (p.attack && a.key === `attack:${p.attack.id}`) {
      const m = p.attack;
      a.progress = clamp(m.age < m.startup ? m.age / m.startup * 0.4
        : m.age < m.startup + m.active ? 0.4 + (m.age - m.startup) / m.active * 0.25
          : 0.65 + (m.age - m.startup - m.active) / m.recovery * 0.35, 0, 1);
    } else if (a.phase === 'down') a.progress = 0.58;
    else if (a.state === 'hurt') a.progress = Math.min(0.9, 0.32 + a.time / 0.42);
    else if (a.name === 'guard') a.progress = Math.min(0.72, (a.state === 'guard-impact' ? 0.42 : 0) + a.time * 3.8);
    else if (a.state === 'jump') a.progress = clamp((p.jumpSpeed + p.vy) / (p.jumpSpeed * 2), 0, 1);
    else if (a.state === 'roll') a.progress = clamp(a.time / 0.56, 0, 1);
    else a.progress = null;
    const grounded = isGrounded(p);
    if (grounded && !a.grounded) a.landing = 1;
    a.grounded = grounded; a.landing *= Math.exp(-dt * 17); a.impulseAge += dt;
    const recoil = a.impulse * Math.exp(-a.impulseAge * 15) * Math.cos(a.impulseAge * 31);
    const targetY = (isCrouching(p) && p.hurtTime <= 0 ? 0.78 : a.phase === 'down' ? 0.7 : 1)
      + (a.state === 'idle' ? Math.sin(a.time * 2.8 + p.id) * 0.008 : 0) - a.landing * 0.045;
    const smooth = 1 - Math.exp(-dt * 25);
    a.scaleX += ((isCrouching(p) ? 1.06 : 1) + a.landing * 0.035 - a.scaleX) * smooth;
    a.scaleY += (targetY - a.scaleY) * smooth;
    a.rotation += ((a.phase === 'down' ? -p.facing * 0.3 : a.state === 'roll' ? p.rollDirection * Math.sin(a.progress * Math.PI) * 0.2 : 0) - a.rotation) * smooth;
    a.offsetX = recoil * 2.4;
  }

  function cancelInput() {
    held = [emptyHeld(), emptyHeld()];
    for (const input of inputs) input.reset();
    for (const p of players) { p.buffered = null; p.running = false; p.comboButtons = ''; updateAnimation(p, 0); }
  }

  function beginRound() {
    cancelInput();
    players = [makePlayer(0, character), makePlayer(1, multiplayer || training ? opponentCharacter : opponentInfo().character)];
    projectiles = []; effects = []; hitStop = 0; shake = 0; phaseTime = 0; timer = 99;
    phase = 'fighting'; roundWinner = null;
    cpu = { thinkIn: 0.12, attackIn: 0.9, blockUntil: 0, crouchUntil: 0, attacks: 0, observedAttack: 0 };
    banner = training ? '训练场 · 血量 / 能量无限' : multiplayer ? `第 ${round} 局 · 先赢两局！`
      : endless ? `无限擂台 · 第 ${stage} 位挑战者` : `第 ${stage} / ${OPPONENTS.length} 擂 · ${opponentInfo().name}`;
    bannerTime = 1.35;
    status(`${banner} · 后退防御，蹲防下段，跳攻破蹲防；236 + 拳 / 脚发动指令技。`);
    sound('laugh:start');
  }

  function start(options = {}) {
    for (const [key, setter] of [['endless', value => endless = value], ['multiplayer', value => multiplayer = value], ['training', value => training = value]]) {
      if (typeof options?.[key] === 'boolean') setter(options[key]);
    }
    if (multiplayer || training) endless = false;
    if (options?.character !== undefined) character = normalizeCharacter(options.character);
    if (options?.opponentCharacter !== undefined) opponentCharacter = normalizeCharacter(options.opponentCharacter);
    if (['none', 'stand', 'crouch'].includes(options?.trainingGuard)) trainingGuard = options.trainingGuard;
    stage = 1; round = 1; score = 0; elapsed = 0; attackId = 1; endSent = false; wins = [0, 0];
    resetStatistics(); onScore?.(0); beginRound();
  }

  function addScore(points) { score += Math.max(0, Math.round(points)); onScore?.(score); }
  function syncEnergy(p) { p.rage = p.stocks > 0 ? 100 : p.meter; }
  function addEnergy(p, amount) {
    if (training) { p.stocks = 3; p.meter = 100; syncEnergy(p); return; }
    p.meter += amount;
    while (p.meter >= 100 && p.stocks < 3) { p.meter -= 100; p.stocks++; }
    p.meter = p.stocks >= 3 ? 0 : Math.min(p.meter, 100); syncEnergy(p);
  }
  function spendStock(p) {
    if (!training && p.stocks < 1) return false;
    if (!training) p.stocks--;
    syncEnergy(p); return true;
  }

  function moveFor(p, type, command) {
    const data = CHARACTERS[p.character], air = airborne(p), crouch = !air && isCrouching(p);
    const heavy = type === 'heavy' || type === 'heavyKick' || command?.strength === 'heavy';
    const kick = type === 'lightKick' || type === 'heavyKick';
    const base = { heavy, kick, airborne: air, context: air ? 'air' : crouch ? 'crouch' : 'stand', height: air ? 'high' : crouch && kick ? 'low' : 'mid',
      projectile: false, knockdown: false, startup: data.startup, active: 0.11, recovery: data.recovery,
      damage: data.light, reach: data.reach, knock: 155, stun: 0.19, guardDamage: 15, guardStun: 0.15, chip: false, pulses: [] };
    if (type === 'special') {
      Object.assign(base, { heavy: true, startup: p.character === 'belly' ? 0.24 : 0.14, active: 0.45, recovery: 0.4,
        damage: p.character === 'belly' ? 51 : 19, reach: p.character === 'belly' ? 194 : 128,
        knock: p.character === 'belly' ? 490 : 125, stun: 0.32, guardDamage: 45, guardStun: 0.26,
        projectile: p.character === 'laugh', knockdown: true, chip: true,
        pulses: p.character === 'belly' ? [0.24] : [0.14, 0.31, 0.48] });
    } else if (type === 'command') {
      const uppercut = command?.direction === '623', retreat = command?.direction === '214';
      Object.assign(base, { heavy, startup: heavy ? 0.18 : 0.12, active: 0.17, recovery: heavy ? 0.38 : 0.29,
        damage: (heavy ? data.heavy : data.light) + 7, reach: uppercut ? 102 : retreat ? 132 : 159,
        knock: uppercut ? 230 : 330, stun: 0.33, guardDamage: 27, guardStun: 0.23,
        projectile: !uppercut && !retreat && p.character === 'laugh', knockdown: uppercut || heavy,
        chip: true, uppercut, rush: !uppercut && !retreat && p.character !== 'laugh', height: 'mid' });
    } else if (type === 'blowback') {
      Object.assign(base, { heavy: true, kick: true, startup: air ? 0.13 : 0.22, active: 0.17,
        recovery: 0.4, damage: 23, reach: 151, knock: 460, stun: 0.3, guardDamage: 38,
        guardStun: 0.25, knockdown: true });
    } else if (type === 'throw') {
      Object.assign(base, { heavy: true, startup: 0.15, active: 0.03, recovery: 0.3, damage: 25,
        reach: 91, knock: 390, stun: 0.3, knockdown: true, height: 'throw', guardDamage: 0 });
    } else {
      Object.assign(base, { startup: heavy ? (p.character === 'speed' ? 0.18 : 0.26) : kick ? data.startup + 0.025 : data.startup,
        active: heavy ? 0.14 : 0.11, recovery: heavy ? 0.34 : data.recovery,
        damage: (heavy ? data.heavy : data.light) + (kick ? 2 : 0),
        reach: heavy ? kick ? 144 : 129 : kick ? 109 : data.reach,
        knock: heavy ? 325 : 165, stun: heavy ? 0.28 : 0.19, guardDamage: heavy ? 33 : 15,
        guardStun: heavy ? 0.23 : 0.15, knockdown: crouch && type === 'heavyKick' });
      if (air) Object.assign(base, { startup: heavy ? 0.11 : 0.065, active: heavy ? 0.23 : 0.2, recovery: heavy ? 0.22 : 0.16,
        reach: heavy ? 112 : 98, damage: Math.round(base.damage * 0.9), stun: heavy ? 0.29 : 0.22, knockdown: false });
    }
    if (!base.pulses.length) base.pulses = [base.startup];
    return base;
  }

  function busy(p) { return p.hurtTime > 0 || p.guardStun > 0 || p.knockdown > 0 || p.rollTime > 0 || p.backstep > 0 || p.landingRecovery > 0 || p.grabbedBy !== null; }
  function beginAttack(p, type, command) {
    if (!playable() || p.hp <= 0 || busy(p)) return false;
    if (['command', 'special', 'throw'].includes(type) && airborne(p)) return false;
    const cancel = p.attack && ['command', 'special'].includes(type) && p.attack.contact
      && ['light', 'heavy', 'lightKick', 'heavyKick'].includes(p.attack.type)
      && p.attack.age <= p.attack.startup + p.attack.active + 0.18;
    if (p.attack && !cancel) return false;
    if (type === 'special' && p.stocks < 1 && !training) { if (!p.id || multiplayer) status('至少攒一颗能量豆才能放超必杀！'); return false; }
    if (cancel) statistics.cancels[p.id]++;
    if (type === 'special') {
      spendStock(p);
      statistics.specials[p.id]++; sound('laugh:special');
      status(`${p.id + 1}P 超必杀！${p.character === 'belly' ? '肚皮震天响！' : p.character === 'speed' ? '奶蛙三连闪！' : '蛙哈哈冲击波！'}`);
    } else { sound('flap'); sound(type === 'command' ? 'laugh:special' : 'laugh:attack'); }
    p.attack = { id: attackId++, type, age: 0, direction: p.facing, crouched: isCrouching(p),
      hits: 0, emitted: 0, hitPulses: new Set(), contact: null, ...moveFor(p, type, command) };
    if (type === 'special' && p.maxTime > 0) { p.attack.damage *= 1.35; p.maxTime = 0; }
    p.running = false; p.buffered = null; updateAnimation(p, 0); return true;
  }

  function jump(p) {
    if (!isGrounded(p) || busy(p) || held[p.id].block) return false;
    const previous = p.attack;
    if (previous && (previous.age > 0.045 || previous.contact || !['light', 'heavy', 'lightKick', 'heavyKick'].includes(previous.type))) return false;
    const superJump = held[p.id].crouch || elapsed - p.lastCrouch < 0.16;
    const direction = Number(held[p.id].right) - Number(held[p.id].left);
    p.jumpType = superJump ? 'super' : p.running ? 'running' : 'normal';
    p.jumpAt = elapsed;
    p.jumpSpeed = superJump ? 790 : 640; p.vy = -p.jumpSpeed;
    const speed = CHARACTERS[p.character].speed * (p.running ? 1.52 : superJump ? 1.15 : 1);
    p.airVx = direction ? direction * Math.max(Math.abs(p.vx), speed) : p.vx;
    p.vx = p.airVx; p.running = false; p.movement = 'air';
    if (previous) p.attack = { ...previous, age: 0, ...moveFor(p, previous.type) };
    sound('flap'); updateAnimation(p, 0); return true;
  }

  function beginRoll(p) {
    if (p.knockdown > 0 && p.canRecover && airborne(p)) { p.recoverUntil = elapsed + 0.25; return true; }
    if (!playable() || !isGrounded(p) || p.attack || p.hurtTime > 0 || p.knockdown > 0 || p.grabbedBy !== null || p.rollTime > 0) return false;
    if (p.guardStun > 0 && !spendStock(p)) return false;
    p.guardStun = 0; p.rollTime = 0.56; p.rollDirection = backwardHeld(p) ? -p.facing : p.facing;
    p.running = false; p.backstep = 0; p.movement = 'roll'; statistics.rolls[p.id]++; sound('laugh:dash'); updateAnimation(p, 0); return true;
  }

  function beginThrow(p) {
    if (p.grabbedBy !== null && p.grabTime > 0) {
      const attacker = players[p.grabbedBy];
      attacker.attack = null; attacker.throwInvulnerable = p.throwInvulnerable = 0.5;
      attacker.vx = -attacker.facing * 150; p.vx = attacker.facing * 150;
      p.grabbedBy = null; p.grabTime = 0; p.hurtTime = 0;
      statistics.throwTechs[p.id]++; spark((p.x + attacker.x) / 2, FLOOR - 75, '#a3bcc4', '拆投！'); sound('laugh:guard'); return true;
    }
    const target = players[1 - p.id];
    if (!playable() || busy(p) || p.attack || airborne(p) || airborne(target) || target.knockdown > 0 || target.wakeTime > 0
      || target.hurtTime > 0 || target.guardStun > 0
      || target.throwInvulnerable > 0 || target.grabbedBy !== null || Math.abs(target.x - p.x) > 86) return false;
    if (!beginAttack(p, 'throw')) return false;
    target.grabbedBy = p.id; target.grabTime = 0.15; target.attack = null; target.rollTime = 0; target.vx = 0;
    target.visualHitId++; updateAnimation(target, 0); return true;
  }

  function activateMax(p) {
    if (!playable() || busy(p) || p.attack || p.maxTime > 0 || !spendStock(p)) return false;
    p.maxTime = 8; spark(p.x, p.y - 94, '#d4af50', 'MAX！'); sound('laugh:special'); return true;
  }

  function executeCommand(p, command) {
    if (command.type === 'run' || command.type === 'backstep') {
      if (busy(p) || p.attack || airborne(p)) return;
      if (command.type === 'run') p.running = true;
      else { p.backstep = 0.3; p.running = false; p.movement = 'backstep'; }
      return;
    }
    const type = command.type === 'attack' ? command.attack : command.type === 'super' ? 'special' : command.type;
    if (!['light', 'heavy', 'lightKick', 'heavyKick', 'command', 'special'].includes(type)) return;
    if (!beginAttack(p, type, command)) p.buffered = { type, command, expiresAt: command.expiresAt ?? elapsed + 0.14 };
  }

  function controlDown(action, index = 0) {
    if (!ACTIONS.includes(action) || ![0, 1].includes(index) || (index === 1 && !multiplayer && !training)) return false;
    if (!playable() || held[index][action]) return true;
    const p = players[index]; held[index][action] = true;
    inputs[index].down(action, elapsed, p.facing);
    if (action === 'crouch') p.lastCrouch = elapsed;
    if (action === 'jump') jump(p);
    else if (action === 'roll') beginRoll(p);
    else if (action === 'throw') beginThrow(p);
    else if (action === 'max') activateMax(p);
    else if (action === 'special') executeCommand(p, { type: 'super', expiresAt: elapsed + 0.14 });
    for (const command of inputs[index].sample(elapsed, p.facing).commands) executeCommand(p, command);
    updateAnimation(p, 0); return true;
  }

  function controlUp(action, index = 0) {
    if (!ACTIONS.includes(action) || ![0, 1].includes(index)) return false;
    const p = players[index]; held[index][action] = false;
    inputs[index].up(action, elapsed, p?.facing || 1);
    if (p) {
      if (action === 'crouch') p.lastCrouch = elapsed;
      if (action === 'jump' && elapsed - p.jumpAt <= 0.12 && p.vy < -370 && p.jumpType !== 'super') {
        p.vy = -370; p.jumpSpeed = 370; p.jumpType = p.jumpType === 'running' ? 'running-hop' : 'hop';
      }
      if (!forwardHeld(p)) p.running = false;
      updateAnimation(p, 0);
    }
    return true;
  }

  function keyBinding(event) {
    if (KEYMAP[event.code]) return KEYMAP[event.code];
    const aliases = { a: 'KeyA', d: 'KeyD', w: 'KeyW', s: 'KeyS', j: 'KeyJ', k: 'KeyK', l: 'KeyL', u: 'KeyU', i: 'KeyI', o: 'KeyO', h: 'KeyH', n: 'KeyN', ' ': 'Space',
      '0': 'Digit0', '1': 'Digit1', '2': 'Digit2', '3': 'Digit3', '4': 'Digit4', '5': 'Digit5', '6': 'Digit6', '9': 'Digit9' };
    const key = event.key || ''; return KEYMAP[aliases[key.toLowerCase()] || key];
  }

  function spark(x, y, color, label) {
    effects.push({ type: 'label', x, y: y - 24, label, color, life: 0.75, age: 0 });
    for (let i = 0; i < 9; i++) { const angle = i * TAU / 9;
      effects.push({ type: 'spark', x, y, vx: Math.cos(angle) * (80 + i * 8), vy: Math.sin(angle) * 100 - 20, color: i % 2 ? color : '#fff9dc', life: 0.32, age: 0 }); }
  }

  function attackBox(p, attack = p.attack, includeStartup = false) {
    if (!attack || attack.projectile || (!includeStartup && (attack.age < attack.startup || attack.age > attack.startup + attack.active))) return null;
    const height = attack.airborne ? 54 : attack.height === 'low' ? 35 : attack.uppercut ? 112 : 48;
    const y = attack.airborne ? p.y - 74 : attack.height === 'low' ? p.y - 43 : attack.uppercut ? p.y - 150 : p.y - (attack.crouched ? 64 : 92);
    return { x: attack.direction > 0 ? p.x + 10 : p.x - attack.reach, y, width: attack.reach - 10, height };
  }

  function canBeHit(p, move) {
    if (p.hp <= 0 || p.knockdown > 0 || p.wakeTime > 0) return false;
    if (move.type !== 'throw' && p.rollTime > 0.12 && p.rollTime < 0.5) return false;
    if (move.type !== 'throw' && p.backstep > 0.23) return false;
    return true;
  }

  function hit(attacker, defender, move, sourceX) {
    if (!playable() || !canBeHit(defender, move)) return false;
    const direction = sourceX < defender.x ? 1 : -1;
    const frontal = Math.abs(sourceX - defender.x) < 3 || Math.sign(sourceX - defender.x) === defender.facing;
    const crouched = isCrouching(defender);
    let blocked = move.type !== 'throw' && isBlocking(defender) && frontal
      && (move.height !== 'low' || crouched) && (move.height !== 'high' || !crouched);
    let guardBroken = false;
    if (blocked) {
      defender.guard -= move.guardDamage;
      if (defender.guard <= 0) { blocked = false; guardBroken = true; defender.guard = 35; }
    }
    const inCombo = defender.hurtTime > 0 && defender.comboOwner === attacker.id;
    const rawDamage = move.damage * attacker.damageScale * (attacker.maxTime > 0 ? 1.2 : 1) * (guardBroken ? 1.12 : 1);
    const damage = blocked ? move.chip ? Math.max(1, Math.round(rawDamage * 0.15)) : 0 : Math.max(1, Math.round(rawDamage));
    const applied = training ? damage : Math.min(damage, defender.hp);
    if (!training) defender.hp = Math.max(0, defender.hp - applied);
    defender.lastDamage = applied;
    defender.hurtTime = blocked ? 0 : guardBroken ? 0.64 : move.stun;
    defender.guardStun = blocked ? move.guardStun : 0;
    defender.comboOwner = blocked ? null : attacker.id;
    defender.blockedFlash = blocked ? 0.2 : 0; defender.squash = blocked ? 0.07 : 0.25;
    defender.visualHitId++; defender.animation.impulse = direction * (blocked ? 0.4 : move.type === 'special' ? 1.5 : 1); defender.animation.impulseAge = 0;
    defender.vx = direction * move.knock * (blocked ? 0.22 : 1); defender.airVx = defender.vx;
    defender.running = false; defender.grabbedBy = null; defender.grabTime = 0;
    if (!blocked) { defender.rollTime = 0; defender.backstep = 0; defender.landingRecovery = 0; }
    if (!blocked && defender.attack?.type !== 'special') defender.attack = null;
    defender.buffered = null;
    if (!blocked && move.knockdown && (move.type !== 'special' || move.finalPulse)) {
      defender.knockdown = 0.9; defender.hurtTime = 0.25;
      defender.canRecover = move.type !== 'throw' && move.type !== 'special';
      if (move.uppercut || move.type === 'special' || move.type === 'throw') defender.vy = -240;
    }
    addEnergy(defender, blocked ? 8 : 7 + applied * 0.45);
    if (move.type !== 'special') addEnergy(attacker, blocked ? 5 : 7 + applied * 0.6);
    move.hits++; move.contact = blocked ? 'guard' : 'hit';
    if (blocked) statistics.blockedHits[attacker.id]++;
    else {
      attacker.combo = inCombo ? attacker.combo + 1 : 1; attacker.lastHit = elapsed; attacker.bestCombo = Math.max(attacker.bestCombo, attacker.combo);
      attacker.hits++; defender.combo = 0; statistics.hits[attacker.id]++;
      statistics.bestCombo[attacker.id] = Math.max(statistics.bestCombo[attacker.id], attacker.combo);
      if (move.type === 'throw') statistics.throws[attacker.id]++;
    }
    attacker.damage += applied; statistics.damage[attacker.id] += applied;
    if (attacker.id === 0 && !training) addScore(applied * (blocked ? 2 : 5));
    spark(defender.x - direction * 22, defender.y - 66, blocked ? '#a5c5ce' : guardBroken ? '#d89a72' : '#e6b05f',
      guardBroken ? '破防！' : blocked ? applied ? `防御 · −${applied}` : '防御 · 0伤' : move.type === 'throw' ? `投技 −${applied}` : `−${applied}`);
    hitStop = Math.max(hitStop, blocked ? 0.035 : move.type === 'special' ? 0.095 : 0.06);
    shake = Math.max(shake, blocked ? 1.5 : move.type === 'special' ? 7 : 3.5);
    sound(blocked ? 'pop' : 'hit'); sound(blocked ? 'laugh:guard' : 'laugh:hurt');
    if (!blocked && attacker.combo >= 2) { status(`${attacker.id + 1}P ${attacker.combo} 连击！硬直中命中才算连段。`); if (attacker.combo === 2 || attacker.combo % 3 === 0) sound('laugh:combo'); }
    updateAnimation(defender, 0);
    if (!training && defender.hp <= 0) finishRound(attacker.id);
    return blocked ? 'guard' : 'hit';
  }

  function emitProjectile(p, a) {
    projectiles.push({ owner: p.id, x: p.x + a.direction * 53, y: p.y - (a.crouched ? 39 : 81),
      vx: a.direction * (a.type === 'special' ? 610 : 525), radius: a.type === 'special' ? 19 : 14, age: 0, life: 1.6,
      move: { ...a, hits: 0, hitPulses: undefined } }); sound('launch');
  }

  function updateAttack(p, dt) {
    const a = p.attack; if (!a) return;
    a.age += dt;
    const target = players[1 - p.id];
    for (let index = 0; index < a.pulses.length; index++) {
      const begins = a.pulses[index];
      a.finalPulse = index === a.pulses.length - 1;
      if (a.projectile) {
        if (a.age >= begins && a.emitted <= index) { emitProjectile(p, a); a.emitted++; }
      } else if (!a.hitPulses.has(index) && a.age >= begins && a.age <= begins + a.active / a.pulses.length) {
        const contact = a.type === 'throw' ? target.grabbedBy === p.id : overlaps(attackBox(p, a, true), hurtbox(target));
        if (contact && hit(p, target, a, p.x)) a.hitPulses.add(index);
      }
      if (!playable()) return;
    }
    if (a.age >= a.startup + a.active + a.recovery) {
      if (!a.projectile && !a.hits) { statistics.whiffs[p.id]++; if (a.type !== 'special') addEnergy(p, 2); }
      p.attack = null;
    }
  }

  function updateCpu(dt) {
    if (multiplayer || training) return;
    const p = players[1], target = players[0], input = held[1];
    for (const action of ACTIONS) input[action] = false;
    cpu.attackIn -= dt; cpu.thinkIn -= dt;
    if (busy(p)) {
      if (p.grabbedBy !== null && p.grabTime > 0.08 && Math.random() < 0.003) beginThrow(p);
      return;
    }
    const distance = Math.abs(p.x - target.x);
    if (elapsed < cpu.blockUntil && !p.attack) input.block = true;
    if (elapsed < cpu.crouchUntil && !p.attack) input.crouch = true;
    if (!input.block) {
      const desired = p.character === 'laugh' ? 190 : 79, toward = p.x < target.x ? 'right' : 'left';
      if (distance > desired) input[toward] = true;
      else if (p.character === 'laugh' && distance < 95 && !p.attack) input[toward === 'right' ? 'left' : 'right'] = true;
    }
    if (cpu.thinkIn > 0) return; cpu.thinkIn = 0.1;
    if (!p.attack && isGrounded(p) && distance > 200 && distance < 370 && Math.random() < 0.035) jump(p);
    if (target.attack && target.attack.id !== cpu.observedAttack && target.attack.age > 0.025) {
      cpu.observedAttack = target.attack.id;
      if (distance < 245 && Math.random() < 0.2 + challenge() * 0.025) {
        cpu.blockUntil = elapsed + 0.35; cpu.crouchUntil = target.attack.height === 'low' ? elapsed + 0.35 : 0;
        input.block = true; input.crouch = target.attack.height === 'low'; input.left = input.right = false;
      }
    }
    const incoming = projectiles.some(projectile => projectile.owner === 0 && Math.abs(projectile.x - p.x) < 175);
    if (incoming && !p.attack) {
      if (Math.random() < 0.15) beginRoll(p); else { input.crouch = true; input.block = true; cpu.crouchUntil = cpu.blockUntil = elapsed + 0.3; }
    }
    if (p.attack || input.block || cpu.attackIn > 0) return;
    if (distance > (p.character === 'laugh' ? 430 : 122) || Math.abs(p.y - target.y) > 105) return;
    if (isBlocking(target) && distance < 86 && Math.random() < 0.2 && beginThrow(p)) cpu.attackIn = 1.15;
    else {
      const type = p.stocks > 0 ? 'special' : p.character === 'laugh' || cpu.attacks % 5 === 4 ? 'command'
        : cpu.attacks % 4 === 2 ? 'heavyKick' : cpu.attacks % 3 === 1 ? 'lightKick' : 'light';
      if (beginAttack(p, type, { direction: '236', strength: 'light' })) {
        cpu.attacks++; cpu.attackIn = Math.max(0.65, 1.04 - challenge() * 0.04) + Math.random() * 0.2;
      }
    }
  }

  function updatePlayer(p, dt) {
    const input = held[p.id], wasAirborne = airborne(p);
    for (const key of ['hurtTime', 'guardStun', 'squash', 'blockedFlash', 'wakeTime', 'throwInvulnerable', 'landingRecovery', 'maxTime']) p[key] = Math.max(0, p[key] - dt);
    if (input.crouch) p.lastCrouch = elapsed;
    if (p.knockdown > 0) {
      p.knockdown = Math.max(0, p.knockdown - dt);
      if (!p.knockdown) { p.wakeTime = 0.22; p.throwInvulnerable = 0.35; }
    }
    if (p.grabbedBy !== null) {
      // A projectile can interrupt the thrower during the tech window.
      if (players[p.grabbedBy].attack?.type !== 'throw') { p.grabbedBy = null; p.grabTime = 0; p.throwInvulnerable = 0.2; }
      else p.grabTime = Math.max(0, p.grabTime - dt);
    }
    if (!p.attack && !wasAirborne && !p.rollTime && !p.backstep && p.hurtTime <= 0) p.facing = players[1 - p.id].x >= p.x ? 1 : -1;
    if (!isBlocking(p)) p.guard = Math.min(100, p.guard + 15 * dt);
    addEnergy(p, 0);
    if (players[1 - p.id].hurtTime <= 0) p.combo = 0;
    if (p.buffered) {
      if (elapsed > p.buffered.expiresAt) p.buffered = null;
      else { const buffered = p.buffered; if (beginAttack(p, buffered.type, buffered.command)) p.buffered = null; }
    }
    if (p.grabbedBy !== null) { p.vx = 0; p.movement = 'grabbed'; return; }
    if (p.rollTime > 0) {
      p.rollTime = Math.max(0, p.rollTime - dt); p.vx = p.rollDirection * (p.rollTime > 0.12 ? 470 : 80); p.movement = 'roll';
    } else if (p.backstep > 0) {
      p.backstep = Math.max(0, p.backstep - dt); p.vx = -p.facing * (p.backstep > 0.08 ? 395 : 95); p.movement = 'backstep';
    } else if (p.hurtTime > 0 || p.guardStun > 0 || p.knockdown > 0) {
      p.vx *= Math.exp(-dt * (wasAirborne ? 1.8 : 7)); p.airVx = p.vx; p.movement = p.knockdown > 0 ? 'knockdown' : 'stunned';
    } else if (wasAirborne) {
      p.vx = p.airVx; p.movement = 'air';
    } else {
      if (!forwardHeld(p) || isCrouching(p) || input.block) p.running = false;
      let speed = CHARACTERS[p.character].speed * (p.running ? 1.52 : 1);
      if (backwardHeld(p) && !forwardHeld(p)) speed *= 0.72;
      if (isCrouching(p) || input.block || p.landingRecovery > 0 || p.attack) speed = 0;
      let desired = (Number(input.right) - Number(input.left)) * speed;
      if (p.attack?.rush && p.attack.age < p.attack.startup + p.attack.active) desired = p.attack.direction * 285;
      if (p.character === 'speed' && p.attack?.type === 'special' && p.attack.age < 0.55) desired = p.attack.direction * 420;
      p.vx += (desired - p.vx) * (1 - Math.exp(-dt * 22));
      p.movement = Math.abs(p.vx) < 18 ? 'idle' : p.vx * p.facing < 0 ? 'backwalk' : p.running ? 'run' : 'walk';
    }
    p.x = clamp(p.x + p.vx * dt, 68, W - 68);
    p.vy += GRAVITY * dt; p.y += p.vy * dt;
    if (p.y >= FLOOR) {
      p.y = FLOOR; p.vy = 0;
      if (wasAirborne) {
        p.landingRecovery = p.attack?.airborne ? p.attack.heavy ? 0.14 : 0.09 : 0.04;
        if (p.attack?.airborne) { if (!p.attack.hits) statistics.whiffs[p.id]++; p.attack = null; }
        p.facing = players[1 - p.id].x >= p.x ? 1 : -1; p.jumpType = null;
        if (p.knockdown > 0 && p.canRecover && elapsed <= p.recoverUntil) {
          p.knockdown = 0; p.hurtTime = 0; p.wakeTime = 0.2; p.throwInvulnerable = 0.3;
          p.rollTime = 0.3; p.rollDirection = -p.facing; p.movement = 'roll';
          spark(p.x, p.y - 68, '#a8bcab', '受身！'); sound('laugh:dash');
        }
      }
    }
  }

  function separatePlayers() {
    const a = players[0], b = players[1];
    if (a.rollTime > 0 || b.rollTime > 0 || a.knockdown > 0 || b.knockdown > 0) return;
    const overlapY = Math.min(a.y, b.y) - Math.max(a.y - bodyHeight(a), b.y - bodyHeight(b));
    const distance = b.x - a.x;
    if (overlapY > 25 && Math.abs(distance) < 70) {
      const direction = distance >= 0 ? 1 : -1, correction = (70 - Math.abs(distance)) / 2;
      a.x = clamp(a.x - direction * correction, 68, W - 68); b.x = clamp(b.x + direction * correction, 68, W - 68);
    }
  }

  function finishRound(winner, timeout = false) {
    if (!playable() || training) return;
    roundWinner = winner;
    if (winner !== null) wins[winner]++;
    phase = 'roundover'; phaseTime = 0; projectiles = []; cancelInput();
    if (winner === 0) addScore(300 + Math.round(players[0].hp * 2));
    banner = winner === null ? '时间到 · 平局重赛！' : `${timeout ? '时间到！' : ''}${multiplayer ? `${winner + 1}P 拿下本局！ ${wins[0]} : ${wins[1]}` : winner === 0 ? `第 ${stage} 擂拿下！蛙哈哈！` : '被笑倒了！奶蛙先歇一会儿。'}`;
    bannerTime = 3; status(banner);
    if (winner !== null) { if (winner === 0 || multiplayer) sound('win'); sound('laugh:victory'); }
  }

  function finishMatch(winner) {
    if (endSent) return;
    endSent = true; phase = 'ended'; cancelInput();
    const won = winner === 0;
    onEnd?.({ score, endless, multiplayer, training, character, opponentCharacter, won, winner: winner + 1, winnerPlayer: winner, stage, round, wins: [...wins],
      title: multiplayer ? `${winner + 1}P 赢下奶蛙擂台！` : won ? '六连胜！奶蛙拳王诞生！' : endless ? `无限擂台，闯到第 ${stage} 擂！` : '脸挤扁了，笑容还在。',
      message: multiplayer ? `${wins[0]} : ${wins[1]}，三局两胜结束。`
        : won ? `六位对手全部击败！最高 ${statistics.bestCombo[0]} 连击，释放 ${statistics.specials[0]} 次超必杀。`
          : `拿下 ${wins[0]} 擂。试试小跳进攻、后退防御，命中后接 236 + 拳！`,
      stats: Object.fromEntries(Object.entries(statistics).map(([key, value]) => [key, [...value]])) });
  }

  function updateEffects(dt) {
    for (const effect of effects) { effect.age += dt;
      if (effect.type === 'spark') { effect.x += effect.vx * dt; effect.y += effect.vy * dt; effect.vy += 230 * dt; } }
    effects = effects.filter(effect => effect.age < effect.life); shake *= Math.exp(-dt * 13); bannerTime = Math.max(0, bannerTime - dt);
  }

  function step(dt) {
    for (const p of players) {
      if (!p.id || multiplayer || training) {
        const input = held[p.id], commands = inputs[p.id].sample(elapsed, p.facing).commands;
        const buttons = input.light && input.lightKick && input.heavy ? 'ABC' : input.light && input.lightKick ? 'AB' : input.heavy && input.heavyKick ? 'CD' : '';
        if (buttons && buttons !== p.comboButtons) {
          if (buttons === 'ABC') activateMax(p);
          else if (buttons === 'AB') beginRoll(p);
          else {
            if (p.guardStun > 0 && spendStock(p)) { p.guardStun = 0; p.attack = null; }
            beginAttack(p, 'blowback');
          }
        }
        p.comboButtons = buttons;
        for (const command of commands) if (!buttons) executeCommand(p, command);
      }
    }
    if (hitStop > 0) { hitStop = Math.max(0, hitStop - dt); return; }
    if (training && trainingGuard !== 'none') { held[1].block = true; held[1].crouch = trainingGuard === 'crouch'; }
    updateCpu(dt);
    for (const p of players) updatePlayer(p, dt);
    separatePlayers();
    for (const p of players) { updateAttack(p, dt); if (!playable()) return; }
    for (const projectile of projectiles) {
      projectile.age += dt; projectile.x += projectile.vx * dt;
      const target = players[1 - projectile.owner], box = { x: projectile.x - projectile.radius, y: projectile.y - projectile.radius, width: projectile.radius * 2, height: projectile.radius * 2 };
      if (overlaps(box, hurtbox(target)) && hit(players[projectile.owner], target, projectile.move, projectile.x)) {
        projectile.age = projectile.life; if (!playable()) return;
      }
      if ((projectile.age >= projectile.life || projectile.x < -60 || projectile.x > W + 60) && !projectile.move.hits) {
        statistics.whiffs[projectile.owner]++;
        if (projectile.move.type !== 'special') addEnergy(players[projectile.owner], 2);
      }
    }
    projectiles = projectiles.filter(p => p.age < p.life && p.x > -60 && p.x < W + 60);
    for (const p of players) updateAnimation(p, hitStop > 0 ? 0 : dt);
  }

  function update(dt) {
    if (phase === 'idle' || phase === 'ended') return;
    dt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.05);
    elapsed += dt; phaseTime += dt; updateEffects(dt);
    if (phase === 'roundover') {
      for (const p of players) updateAnimation(p, dt);
      if (phaseTime >= 1.9) {
        if (roundWinner === null) { round++; beginRound(); }
        else if (multiplayer) { if (wins[roundWinner] >= 2) finishMatch(roundWinner); else { round++; beginRound(); } }
        else if (roundWinner === 1) finishMatch(1);
        else if (!endless && stage >= OPPONENTS.length) finishMatch(0);
        else { stage++; round++; beginRound(); }
      }
      return;
    }
    if (!training) timer = Math.max(0, timer - dt);
    const steps = Math.max(1, Math.ceil(dt * 120));
    for (let i = 0; i < steps && playable(); i++) step(dt / steps);
    if (playable() && timer <= 0) {
      const difference = players[0].hp / players[0].maxHp - players[1].hp / players[1].maxHp;
      finishRound(Math.abs(difference) < 0.0001 ? null : difference > 0 ? 0 : 1, true);
    }
  }

  function setTrainingGuard(value) {
    if (!['none', 'stand', 'crouch'].includes(value)) return false;
    trainingGuard = value; held[1].block = value !== 'none'; held[1].crouch = value === 'crouch'; return true;
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
      drawFrog(ctx, x, y, 29, { skinSlot: i % 4, expression: 'laugh', animation: 'laugh', animationTime: time + i * 0.17 });
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
    text(multiplayer ? '1P  J / U / K / I 四攻击 · O滚 H投 N爆气     2P  1 / 4 / 2 / 5 · 0滚 6投 9爆气'
      : 'J轻拳 U轻脚 K重拳 I重脚 · 后退防御 · O翻滚 H投技 N爆气 · 空格超必杀', W / 2, 538, 14, '#4e6155');
  }

  function drawPlayer(player, time) {
    const data = CHARACTERS[player.character];
    const knocked = player.hp <= 0 || player.knockdown > 0;
    const crouched = isCrouching(player);
    const blocked = isBlocking(player) || player.blockedFlash > 0;
    const attack = player.attack;
    const a = player.animation;
    ctx.fillStyle = '#6a634224'; ctx.beginPath();
    ctx.ellipse(player.x, FLOOR + 8, knocked ? 63 : 48, 8, 0, 0, TAU); ctx.fill();
    if (player.maxTime > 0) {
      ctx.strokeStyle = '#edbf58'; ctx.lineWidth = 3; ctx.globalAlpha = 0.48 + Math.sin(time * 6) * 0.15;
      ctx.beginPath(); ctx.ellipse(player.x, player.y - 54, 68, 83, 0, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1;
    }
    const expression = a.name === 'hurt' ? 'squish' : a.name === 'laugh' ? 'laugh' : attack ? 'angry' : blocked ? 'smug' : 'happy';
    // Rotate around the planted feet; all atlas states share the same foot line.
    ctx.save();
    ctx.translate(player.x + a.offsetX, player.y);
    ctx.rotate(a.rotation);
    drawFrog(ctx, 0, -data.size * 0.64 * a.scaleY, data.size, {
      skinSlot: player.id, expression, animation: a.name, animationTime: a.time * (a.state === 'walk' ? 0.65 : 1),
      ...(a.progress === null ? {} : { animationProgress: a.progress }),
      ...(a.previous ? { animationFrom: { ...a.previous }, animationMix: a.blend } : {}),
      scaleX: a.scaleX * player.facing, scaleY: a.scaleY,
    });
    ctx.restore();
    rounded(player.x - 35, FLOOR + 16, 70, 17, 8, data.color);
    text(player.id === 0 ? '1P' : training ? '木桩' : multiplayer ? '2P' : 'CPU', player.x, FLOOR + 24, 11, '#fffdf4');
    if (blocked) {
      ctx.strokeStyle = player.blockedFlash > 0 ? '#f8fdff' : '#96b5c1'; ctx.lineWidth = player.blockedFlash > 0 ? 6 : 4;
      ctx.beginPath(); ctx.arc(player.x + player.facing * 27, player.y - (crouched ? 41 : 63), crouched ? 41 : 61,
        player.facing > 0 ? -1.13 : Math.PI - 1.13, player.facing > 0 ? 1.13 : Math.PI + 1.13); ctx.stroke();
    }
    if (attack && !attack.projectile && attack.age >= attack.startup && attack.age < attack.startup + attack.active) {
      const trailX = player.x + attack.direction * attack.reach * 0.68;
      const trailY = player.y - (attack.crouched ? 40 : 65);
      const activeProgress = (attack.age - attack.startup) / attack.active;
      ctx.strokeStyle = attack.type === 'special' ? '#e6ba60' : '#fff9dc'; ctx.lineWidth = 2.5;
      ctx.globalAlpha = Math.sin(activeProgress * Math.PI) * 0.8;
      ctx.lineCap = 'round';
      for (let i = 0; i < 3; i++) {
        ctx.beginPath(); ctx.moveTo(trailX, trailY - 16 + i * 14);
        ctx.quadraticCurveTo(trailX + attack.direction * 17, trailY - 23 + i * 17,
          trailX + attack.direction * (32 + (i % 2) * 9), trailY - 19 + i * 17); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    if (player.combo >= 2 && playable()) text(`${player.combo} 连击`, player.x, player.y - 154, 22, '#a27749');
  }

  function drawHud() {
    for (const player of players) {
      const left = player.id === 0, x = left ? 26 : 588, data = CHARACTERS[player.character];
      const label = left ? `1P · ${data.name}` : training ? `木桩 · ${data.name}` : multiplayer ? `2P · ${data.name}` : `CPU · ${opponentInfo().name}`;
      text(label, left ? x : x + 346, 26, 18, '#665a48', left ? 'left' : 'right');
      rounded(x, 45, 346, 26, 12, '#ded4c0', '#c8bda8');
      const hpWidth = 338 * player.hp / player.maxHp;
      if (hpWidth > 0) rounded(left ? x + 4 : x + 342 - hpWidth, 49, hpWidth, 18, Math.min(8, hpWidth / 2), player.hp < player.maxHp * 0.3 ? '#d89480' : data.color);
      text(`${Math.ceil(player.hp)} / ${player.maxHp}`, x + 173, 58, 12, '#fffdf5');
      rounded(x, 79, 246, 11, 5, '#dfd5c0');
      const energy = player.maxTime > 0 ? player.maxTime / 8 : player.stocks >= 3 ? 1 : player.meter / 100;
      if (energy > 0) rounded(x, 79, 246 * energy, 11, 5, player.maxTime > 0 ? '#dcaa43' : '#dfc482');
      text(player.maxTime > 0 ? `MAX ${player.maxTime.toFixed(1)}s` : `${player.stocks} / 3 能量豆`, x + 346, 85, 12, '#99805a', 'right');
      for (let stock = 0; stock < 3; stock++) {
        ctx.fillStyle = stock < player.stocks ? '#deb14f' : '#d5c8ad'; ctx.beginPath(); ctx.arc(x + 12 + stock * 22, 109, 6, 0, TAU); ctx.fill();
      }
      if (multiplayer) {
        for (let i = 0; i < 2; i++) {
          ctx.fillStyle = i < wins[player.id] ? '#bd8074' : '#e0d6c2'; ctx.beginPath(); ctx.arc(x + 317 + i * 22, 109, 6, 0, TAU); ctx.fill();
        }
      } else text(training ? `最近伤害 ${player.lastDamage}` : data.tagline, x + 81, 108, 12, '#958673', 'left', 500);
    }
    text(training ? '训练 · 无限血气' : multiplayer ? `双人 · 第 ${round} 局` : endless ? `无限 · 第 ${stage} 擂` : `第 ${stage} / ${OPPONENTS.length} 擂`, W / 2, 30, 14, '#8f785d');
    text(training ? '∞' : String(Math.ceil(timer)).padStart(2, '0'), W / 2, 62, 32, timer < 10 ? '#ba7160' : '#b48f60', 'center', 900);
    text(training ? '98风格 · 训练' : multiplayer ? `${wins[0]} : ${wins[1]}` : `${score} 分`, W / 2, 94, 15, '#a58b69');
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
    return { phase, score, endless, multiplayer, training, trainingGuard, character, opponentCharacter,
      stage, round, timer, totalStages: endless || multiplayer || training ? null : OPPONENTS.length,
      wins: [...wins], roundWinner, hitStop, elapsed, held: held.map(input => ({ ...input })),
      inputLogs: inputs.map(input => input.getState().log.map(entry => ({ ...entry }))),
      players: players.map(p => ({ id: p.id, character: p.character,
        x: p.x, y: p.y, vx: p.vx, vy: p.vy, hp: p.hp, maxHp: p.maxHp, rage: p.rage,
        stocks: p.stocks, meter: p.meter, maxTime: p.maxTime, guard: p.guard, facing: p.facing,
        grounded: isGrounded(p), airborne: airborne(p), blocking: isBlocking(p), crouching: isCrouching(p),
        movement: p.movement, running: p.running, jumpType: p.jumpType, airType: p.jumpType,
        hurtTime: p.hurtTime, guardStun: p.guardStun, knockdown: p.knockdown, wakeTime: p.wakeTime,
        landingRecovery: p.landingRecovery, rollTime: p.rollTime, backstep: p.backstep,
        grabbedBy: p.grabbedBy, grabTime: p.grabTime, combo: p.combo, bestCombo: p.bestCombo, lastDamage: p.lastDamage,
        hitbox: attackBox(p), hurtbox: hurtbox(p),
        animation: { name: p.animation.name, state: p.animation.state, phase: p.animation.phase,
          time: p.animation.time, progress: p.animation.progress, blend: p.animation.blend,
          previous: p.animation.previous ? { ...p.animation.previous } : null,
          transitions: p.animation.transitions, footY: p.y, offsetX: p.animation.offsetX,
          scaleX: p.animation.scaleX, scaleY: p.animation.scaleY, rotation: p.animation.rotation },
        attack: p.attack ? { id: p.attack.id, type: p.attack.type, age: p.attack.age, startup: p.attack.startup,
          active: p.attack.active, recovery: p.attack.recovery, context: p.attack.context, airborne: p.attack.airborne,
          height: p.attack.height, hits: p.attack.hits, contact: p.attack.contact, phase: p.animation.phase } : null })),
      projectiles: projectiles.map(p => ({ owner: p.owner, x: p.x, y: p.y, vx: p.vx, radius: p.radius })),
      stats: Object.fromEntries(Object.entries(statistics).map(([key, value]) => [key, [...value]])),
    };
  }

  resetStatistics(); players = [makePlayer(0, character), makePlayer(1, multiplayer || training ? opponentCharacter : opponentInfo().character)];
  return { start, update, render, controlDown, controlUp, cancelInput, getState, setTrainingGuard,
    resetTraining() { if (training) start({ training: true }); },
    keyDown(event) { const binding = keyBinding(event); if (!binding) return false; if (!event.repeat) controlDown(binding[1], binding[0]); return binding[0] === 0 || multiplayer || training; },
    keyUp(event) { const binding = keyBinding(event); if (!binding) return false; controlUp(binding[1], binding[0]); return binding[0] === 0 || multiplayer || training; },
    pointerDown() {}, pointerMove() {}, pointerUp(point) { if (point?.cancelled) cancelInput(); },
    destroy() { cancelInput(); phase = 'idle'; projectiles = []; effects = []; },
  };
}
