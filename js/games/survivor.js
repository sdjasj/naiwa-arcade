const TAU = Math.PI * 2;
const ROUND_SECONDS = 180;
const CAPS = { enemies: 80, projectiles: 120, enemyProjectiles: 72, gems: 100, effects: 160, labels: 18 };
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const DEFINITIONS = {
  belly: { name: '肚皮震波', max: 5, description: rank => rank ? `震波范围扩大，下次升级为 ${rank + 1} 级。` : '解锁周期震波，震开并伤害身边的敌人。' },
  bottles: { name: '旋转奶瓶', max: 5, description: rank => `让 ${rank + 1} 只奶瓶绕身旋转，持续打击靠近的敌人。` },
  rapid: { name: '魔性连笑', max: 6, description: () => '笑声弹发射速度提高 18%，笑得根本停不下。' },
  power: { name: '笑声加料', max: 10, description: () => '所有武器伤害提高 25%，每一声哈哈都有分量。' },
  spread: { name: '分裂笑声弹', max: 3, description: rank => `每次额外发射 ${rank + 1} 颗笑声弹，覆盖更大范围。` },
  boots: { name: '蛙步生风', max: 3, description: () => '移动速度提高 10%，冲刺冷却缩短 0.5 秒。' },
  regen: { name: '自动喝奶', max: 4, description: rank => `每 8 秒自动回复 ${(rank + 1) * 3} 点生命。` },
  heart: { name: '大肚能容', max: 6, description: () => '生命上限增加 15，并立即回复 25 点生命。' },
  heal: { name: '吨吨吨，补一口', max: Infinity, description: () => '立即回复 40 点生命，下一波继续笑着上。' },
  lucky: { name: '摸鱼奖金', max: Infinity, description: () => '立即获得 250 分，并回复 12 点生命。' },
  vitamins: { name: '续杯营养奶', max: Infinity, description: () => '生命上限增加 5，并回复 15 点生命。无限成长，续杯快乐。' },
};

export function createGame(env) {
  const { ctx, width = 960, height = 560, drawFrog, audio, onScore, onStatus, onEnd } = env;
  // The meme sprite is taller than its collision circle. Keep its whole face
  // below the HUD and its feet above the bottom control hint.
  const bounds = { left: 30, right: width - 30, top: 138, bottom: height - 53 };
  const center = { x: width / 2, y: (bounds.top + bounds.bottom) / 2 };
  const held = { left: false, right: false, up: false, down: false, dash: false };
  let endless = env.endless === true;
  let phase = 'idle';
  let player = { x: center.x, y: center.y, hp: 100, maxHp: 100 };
  let elapsed = 0, wave = 1, level = 1, xp = 0, xpNeeded = 8, kills = 0, score = 0;
  let enemies = [], projectiles = [], enemyProjectiles = [], gems = [], effects = [], labels = [];
  let upgrades = [], ranks = {}, pointer = null;
  let spawnTimer = 0.6, shotTimer = 0.25, bellyTimer = 0, regenerationTimer = 8;
  let dashTime = 0, dashCooldown = 0, invulnerability = 0, endingTime = 0, statusCooldown = 0;
  let dashDirection = { x: 1, y: 0 }, facing = { x: 1, y: 0 };
  let nextId = 1, nextBossAt = 60, finalBossSpawned = false, finalBossDefeated = false;
  let pendingXp = 0, lastReportedScore = 0, ended = false, won = false;
  let stats = { shots: 0, shockwaves: 0, bottleHits: 0, bosses: 0, dashes: 0, damageTaken: 0 };

  const sound = kind => audio?.play?.(kind);
  const status = text => onStatus?.(text);
  const rank = id => ranks[id] || 0;
  const power = () => 1 + rank('power') * 0.25;
  const movementSpeed = () => 208 * (1 + rank('boots') * 0.1);
  const shotInterval = () => Math.max(0.2, 0.68 * 0.82 ** rank('rapid'));
  const dashInterval = () => 4.2 - rank('boots') * 0.5;
  const difficulty = () => Math.min(28, wave);

  function cancelInput() {
    for (const key of Object.keys(held)) held[key] = false;
    pointer = null;
  }

  function reportScore() {
    if (score !== lastReportedScore) { lastReportedScore = score; onScore?.(score); }
  }

  function effect(item) {
    if (effects.length >= CAPS.effects) effects.shift();
    effects.push({ age: 0, life: 0.45, ...item });
  }

  function floating(text, x, y, color = '#416443') {
    if (labels.length >= CAPS.labels) labels.shift();
    labels.push({ text, x, y, color, age: 0, life: 0.85 });
  }

  function spark(x, y, color, count = 5) {
    for (let i = 0; i < count; i += 1) {
      const a = i * TAU / count + Math.random() * 0.4;
      const speed = 35 + Math.random() * 95;
      effect({ type: 'spark', x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, color, size: 2 + Math.random() * 3 });
    }
  }

  function start(options = {}) {
    if (typeof options?.endless === 'boolean') endless = options.endless;
    phase = 'playing'; player = { x: center.x, y: center.y, hp: 100, maxHp: 100 };
    elapsed = 0; wave = 1; level = 1; xp = 0; xpNeeded = 8; kills = 0; score = 0;
    enemies = []; projectiles = []; enemyProjectiles = []; gems = []; effects = []; labels = [];
    ranks = {}; upgrades = []; spawnTimer = 0.6; shotTimer = 0.25; bellyTimer = 0;
    regenerationTimer = 8; dashTime = 0; dashCooldown = 0; invulnerability = 0; endingTime = 0; statusCooldown = 0;
    dashDirection = { x: 1, y: 0 }; facing = { x: 1, y: 0 };
    nextId = 1; nextBossAt = 60; finalBossSpawned = false; finalBossDefeated = false;
    pendingXp = 0; lastReportedScore = 0; ended = false; won = false;
    stats = { shots: 0, shockwaves: 0, bottleHits: 0, bosses: 0, dashes: 0, damageTaken: 0 };
    cancelInput(); onScore?.(0);
    status(endless ? '无限生存 · 自动攻击 · 移动躲敌，空格冲刺，每分钟有新 BOSS。' : '坚持 3 分钟并击败最终 BOSS · 自动攻击，WASD / 方向键移动，空格冲刺。');
  }

  function addEnemy(kind = 'carton', final = false) {
    if (enemies.length >= CAPS.enemies) {
      if (kind !== 'boss') return;
      const replace = enemies.findIndex(enemy => enemy.kind !== 'boss');
      if (replace < 0) return;
      enemies.splice(replace, 1);
    }
    const side = Math.floor(Math.random() * 4);
    let x = 45 + Math.random() * (width - 90), y = bounds.top + Math.random() * (bounds.bottom - bounds.top);
    if (side === 0) x = -35;
    else if (side === 1) x = width + 35;
    else if (side === 2) y = 65;
    else y = height + 35;
    // Spawn outside a generous player neighborhood, including along the top edge.
    if (Math.hypot(x - player.x, y - player.y) < 145) {
      x = player.x < width / 2 ? width + 35 : -35;
      y = clamp(player.y + (Math.random() - 0.5) * 180, bounds.top, bounds.bottom);
    }
    const data = {
      carton: { hp: 22, speed: 43, radius: 17, damage: 10, xp: 1, points: 10 },
      runner: { hp: 17, speed: 81, radius: 13, damage: 9, xp: 1, points: 12 },
      tank: { hp: 72, speed: 32, radius: 24, damage: 17, xp: 3, points: 28 },
      shooter: { hp: 42, speed: 38, radius: 18, damage: 12, xp: 2, points: 24 },
      boss: { hp: final ? 850 : 310 + Math.min(600, wave * 17), speed: final ? 48 : 39, radius: final ? 43 : 37, damage: 23, xp: 16, points: final ? 700 : 350 },
    }[kind];
    const hp = data.hp * (kind === 'boss' ? 1 : 1 + Math.min(0.8, (difficulty() - 1) * 0.035));
    enemies.push({ id: nextId++, kind, x, y, ...data, hp, maxHp: hp,
      speed: data.speed * (1 + Math.min(0.48, (difficulty() - 1) * 0.016)),
      attackTimer: kind === 'boss' ? 2.3 : 1.6 + Math.random(), hitFlash: 0, bottleCooldown: 0,
      final, dead: false, wobble: Math.random() * TAU,
    });
    if (kind === 'boss') {
      sound('launch');
      status(final ? '最终 BOSS「加班大王」来了！躲开红色笑声球，撑到 3:00 并击败它。' : `第 ${wave} 波 BOSS 到场！绕着走，奶蛙会自动瞄准。`);
      floating(final ? '加班大王，禁止加班！' : 'BOSS 来了！', width / 2, 154, '#a65d49');
    }
  }

  function spawnWave() {
    const count = Math.min(4, 1 + Math.floor((wave - 1) / 5));
    for (let i = 0; i < count; i += 1) {
      const roll = Math.random();
      const kind = wave >= 4 && roll < 0.12 ? 'shooter' : wave >= 3 && roll < 0.3 ? 'tank' : wave >= 2 && roll < 0.6 ? 'runner' : 'carton';
      addEnemy(kind);
    }
  }

  function dropExperience(enemy) {
    if (gems.length >= CAPS.gems) { pendingXp += enemy.xp; return; }
    gems.push({ x: enemy.x, y: enemy.y, value: enemy.xp, age: 0, radius: enemy.kind === 'boss' ? 8 : 5 });
  }

  function kill(enemy) {
    if (enemy.dead) return;
    enemy.dead = true; kills += 1; score += enemy.points; dropExperience(enemy);
    spark(enemy.x, enemy.y, enemy.kind === 'boss' ? '#ecc361' : '#b7c78d', enemy.kind === 'boss' ? 18 : 4);
    if (enemy.kind === 'boss') {
      stats.bosses += 1; sound('win');
      floating(`BOSS 签退！+${enemy.points}`, enemy.x, enemy.y - 32, '#9e782c');
      player.hp = Math.min(player.maxHp, player.hp + 15);
      if (enemy.final) finalBossDefeated = true;
    }
  }

  function damageEnemy(enemy, amount) {
    if (enemy.dead) return;
    enemy.hp -= amount; enemy.hitFlash = 0.12;
    if (enemy.hp <= 0) kill(enemy);
  }

  function hurt(amount) {
    if (phase !== 'playing' || invulnerability > 0 || dashTime > 0) return;
    const damage = Math.round(amount);
    player.hp = Math.max(0, player.hp - damage); stats.damageTaken += damage;
    invulnerability = 1.05;
    sound('hit'); effect({ type: 'ring', x: player.x, y: player.y, radius: 58, color: '#e4937b', life: 0.35 });
    floating(`−${damage}`, player.x, player.y - 45, '#bb6456');
    if (statusCooldown <= 0) { status('奶蛙挨了一下！移动拉开距离，空格 / 冲刺键可以穿过包围。'); statusCooldown = 3; }
    if (player.hp <= 0) finish(false);
  }

  function finish(success) {
    if (phase === 'ending' || phase === 'ended') return;
    phase = 'ending'; won = success; endingTime = 0; upgrades = []; cancelInput();
    score += Math.floor(elapsed) * 2 + (success ? 1000 : 0); reportScore();
    sound(success ? 'win' : 'laugh');
    status(success ? '三分钟打卡完成，加班大王已下班！' : '奶蛙躺平了，但它的笑声还在继续。');
  }

  function makeUpgrades() {
    const eligible = Object.keys(DEFINITIONS).filter(id => rank(id) < DEFINITIONS[id].max);
    let ids;
    if (level === 2) ids = ['belly', 'bottles', 'rapid'];
    else {
      for (let i = eligible.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [eligible[i], eligible[j]] = [eligible[j], eligible[i]];
      }
      ids = eligible.slice(0, 3);
      if (player.hp < player.maxHp * 0.45 && !ids.includes('heal')) ids[2] = 'heal';
    }
    return ids.map(id => ({ id, name: DEFINITIONS[id].name, description: DEFINITIONS[id].description(rank(id)) }));
  }

  function checkLevel() {
    if (phase !== 'playing' || xp < xpNeeded) return;
    xp -= xpNeeded; level += 1; xpNeeded = 8 + (level - 1) * 5;
    phase = 'upgrading'; upgrades = makeUpgrades(); cancelInput(); sound('score');
    status(`升到 ${level} 级！时间已暂停，按 1 / 2 / 3 或点击选择一种成长。`);
  }

  function chooseUpgrade(index) {
    if (phase !== 'upgrading' || !Number.isInteger(index) || index < 0 || index >= upgrades.length) return false;
    const choice = upgrades[index];
    ranks[choice.id] = rank(choice.id) + 1;
    if (choice.id === 'heart') { player.maxHp += 15; player.hp = Math.min(player.maxHp, player.hp + 25); }
    if (choice.id === 'vitamins') { player.maxHp += 5; player.hp = Math.min(player.maxHp, player.hp + 15); }
    if (choice.id === 'heal') player.hp = Math.min(player.maxHp, player.hp + 40);
    if (choice.id === 'lucky') { score += 250; player.hp = Math.min(player.maxHp, player.hp + 12); reportScore(); }
    if (choice.id === 'belly') bellyTimer = 0;
    if (choice.id === 'rapid') shotTimer = Math.min(shotTimer, shotInterval());
    if (choice.id === 'boots') dashCooldown = Math.min(dashCooldown, dashInterval());
    upgrades = []; phase = 'playing'; cancelInput();
    invulnerability = Math.max(invulnerability, 0.6);
    sound('pop'); floating(choice.name, player.x, player.y - 66);
    status(`获得「${choice.name}」！继续走位，奶蛙替你自动攻击。`);
    checkLevel();
    return true;
  }

  function fire() {
    let nearest = null, nearestDistance = Infinity;
    for (const enemy of enemies) {
      if (enemy.dead) continue;
      const d = distance(player, enemy);
      if (d < nearestDistance) { nearest = enemy; nearestDistance = d; }
    }
    if (!nearest || nearestDistance > 620) return false;
    const count = 1 + rank('spread');
    const angle = Math.atan2(nearest.y - player.y, nearest.x - player.x);
    for (let i = 0; i < count && projectiles.length < CAPS.projectiles; i += 1) {
      // Keep the original aimed shot when adding a spread; an even bullet count
      // must never open a gap around the target and make an upgrade worse.
      const offset = i === 0 ? 0 : Math.ceil(i / 2) * (i % 2 ? 1 : -1) * 0.12;
      const a = angle + offset;
      projectiles.push({ x: player.x, y: player.y - 8, vx: Math.cos(a) * 455, vy: Math.sin(a) * 455,
        radius: 7, damage: 25 * power(), life: 1.65, pierce: rank('power') >= 4 ? 2 : 1, hit: new Set() });
      stats.shots += 1;
    }
    sound('flap'); return true;
  }

  function shockwave() {
    const radius = 87 + rank('belly') * 18;
    stats.shockwaves += 1; sound('launch');
    effect({ type: 'ring', x: player.x, y: player.y, radius, color: '#e2c06a', life: 0.6 });
    for (const enemy of enemies) {
      const d = distance(player, enemy);
      if (enemy.dead || d > radius + enemy.radius) continue;
      damageEnemy(enemy, (26 + rank('belly') * 9) * power());
      if (enemy.kind !== 'boss' && d > 0) {
        enemy.x += (enemy.x - player.x) / d * 34;
        enemy.y += (enemy.y - player.y) / d * 34;
      }
    }
  }

  function bottlePositions() {
    return Array.from({ length: rank('bottles') }, (_, index) => {
      const angle = elapsed * 2.7 + index * TAU / rank('bottles');
      return { x: player.x + Math.cos(angle) * 72, y: player.y + Math.sin(angle) * 56, angle };
    });
  }

  function shootEnemy(enemy) {
    if (enemyProjectiles.length >= CAPS.enemyProjectiles) return;
    const base = Math.atan2(player.y - enemy.y, player.x - enemy.x);
    const count = enemy.kind === 'boss' ? (enemy.final ? 10 : 8) : 1;
    for (let i = 0; i < count && enemyProjectiles.length < CAPS.enemyProjectiles; i += 1) {
      const angle = enemy.kind === 'boss' ? base + i * TAU / count : base;
      const speed = enemy.kind === 'boss' ? 130 : 155;
      enemyProjectiles.push({ x: enemy.x, y: enemy.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 5, radius: 7, damage: enemy.kind === 'boss' ? 14 : 11 });
    }
    effect({ type: 'ring', x: enemy.x, y: enemy.y, radius: enemy.radius + 25, color: '#d48c79', life: 0.45 });
  }

  function inputDirection() {
    let x = Number(held.right) - Number(held.left), y = Number(held.down) - Number(held.up);
    if (!x && !y && pointer) {
      const d = distance(player, pointer);
      if (d > 9) { x = pointer.x - player.x; y = pointer.y - player.y; }
    }
    const length = Math.hypot(x, y);
    return length ? { x: x / length, y: y / length } : { x: 0, y: 0 };
  }

  function dash() {
    if (phase !== 'playing' || dashCooldown > 0) return false;
    const direction = inputDirection();
    dashDirection = direction.x || direction.y ? direction : { ...facing };
    dashTime = 0.24; dashCooldown = dashInterval(); invulnerability = Math.max(invulnerability, 0.35);
    stats.dashes += 1; sound('launch');
    effect({ type: 'ring', x: player.x, y: player.y, radius: 45, color: '#a5c9be', life: 0.28 });
    return true;
  }

  function updateEffects(dt) {
    for (const p of effects) { p.age += dt; p.x += (p.vx || 0) * dt; p.y += (p.vy || 0) * dt; }
    for (const label of labels) { label.age += dt; label.y -= 23 * dt; }
    effects = effects.filter(p => p.age < p.life);
    labels = labels.filter(label => label.age < label.life);
  }

  function update(dt) {
    if (phase === 'idle' || phase === 'ended' || phase === 'upgrading') return;
    dt = Number.isFinite(dt) ? clamp(dt, 0, 0.05) : 0;
    updateEffects(dt);
    if (phase === 'ending') {
      endingTime += dt;
      if (endingTime >= 0.8 && !ended) {
        ended = true; phase = 'ended';
        onEnd?.({ score, won, endless, elapsed, wave, level, kills, stats: { ...stats },
          title: won ? '奶蛙幸存，老板先下班。' : '奶蛙躺了，笑声没停。',
          message: `${endless ? '无限模式' : '经典模式'}坚持 ${Math.floor(elapsed)} 秒，击退 ${kills} 个敌人，升到 ${level} 级。${won ? '三分钟与最终 BOSS 的挑战全部完成！' : '换一种升级组合，再来一局！'}` });
      }
      return;
    }

    elapsed += dt; statusCooldown = Math.max(0, statusCooldown - dt);
    invulnerability = Math.max(0, invulnerability - dt);
    dashCooldown = Math.max(0, dashCooldown - dt);
    const nextWave = Math.floor(elapsed / 15) + 1;
    if (nextWave !== wave) { wave = nextWave; status(`第 ${wave} 波 · 敌人正在增加！经验会自动飞回来，专心走位。`); }
    const input = inputDirection();
    if (input.x || input.y) facing = input;
    const velocity = dashTime > 0 ? dashDirection : input;
    const speed = dashTime > 0 ? 680 : movementSpeed();
    player.x = clamp(player.x + velocity.x * speed * dt, bounds.left, bounds.right);
    player.y = clamp(player.y + velocity.y * speed * dt, bounds.top, bounds.bottom);
    if (dashTime > 0) {
      dashTime = Math.max(0, dashTime - dt);
      effect({ type: 'spark', x: player.x - velocity.x * 20, y: player.y - velocity.y * 20, color: '#c5dbc4', size: 9, life: 0.24 });
    }

    spawnTimer -= dt;
    if (spawnTimer <= 0) { spawnWave(); spawnTimer += Math.max(0.32, 1.02 - difficulty() * 0.052); }
    if (endless && elapsed >= nextBossAt) { addEnemy('boss'); nextBossAt += 60; }
    if (!endless && nextBossAt <= 120 && elapsed >= nextBossAt) { addEnemy('boss'); nextBossAt += 60; }
    if (!endless && elapsed >= 150 && !finalBossSpawned) { finalBossSpawned = true; addEnemy('boss', true); }

    shotTimer -= dt;
    if (shotTimer <= 0) { if (fire()) shotTimer += shotInterval(); else shotTimer = 0; }
    if (rank('belly')) { bellyTimer -= dt; if (bellyTimer <= 0) { shockwave(); bellyTimer = Math.max(1.9, 4.8 - rank('belly') * 0.45); } }
    regenerationTimer -= dt;
    if (regenerationTimer <= 0) {
      regenerationTimer += 8;
      if (rank('regen') && player.hp < player.maxHp) { player.hp = Math.min(player.maxHp, player.hp + rank('regen') * 3); floating(`+${rank('regen') * 3}`, player.x, player.y - 35); }
    }

    const bottles = bottlePositions();
    for (const enemy of enemies) {
      if (enemy.dead) continue;
      enemy.hitFlash = Math.max(0, enemy.hitFlash - dt); enemy.bottleCooldown = Math.max(0, enemy.bottleCooldown - dt);
      const dx = player.x - enemy.x, dy = player.y - enemy.y, d = Math.hypot(dx, dy);
      const move = enemy.kind !== 'shooter' || d > 235 ? 1 : d < 150 ? -0.4 : 0;
      if (d > 1) { enemy.x += dx / d * enemy.speed * dt * move; enemy.y += dy / d * enemy.speed * dt * move; }
      if (enemy.kind === 'shooter' || enemy.kind === 'boss') {
        enemy.attackTimer -= dt;
        if (enemy.attackTimer <= 0) { shootEnemy(enemy); enemy.attackTimer = enemy.kind === 'boss' ? 3.1 : 2.6; }
      }
      if (enemy.bottleCooldown <= 0 && bottles.some(bottle => distance(enemy, bottle) < enemy.radius + 13)) {
        damageEnemy(enemy, (15 + rank('bottles') * 2) * power()); enemy.bottleCooldown = 0.42; stats.bottleHits += 1;
      }
      if (!enemy.dead && distance(player, enemy) < enemy.radius + 20) hurt(enemy.damage);
      if (phase !== 'playing') break;
    }

    if (phase === 'playing') {
      for (const bullet of projectiles) {
        bullet.x += bullet.vx * dt; bullet.y += bullet.vy * dt; bullet.life -= dt;
        for (const enemy of enemies) {
          if (enemy.dead || bullet.hit.has(enemy.id) || bullet.life <= 0) continue;
          if (Math.hypot(bullet.x - enemy.x, bullet.y - enemy.y) < bullet.radius + enemy.radius) {
            damageEnemy(enemy, bullet.damage); bullet.hit.add(enemy.id); bullet.pierce -= 1;
            spark(bullet.x, bullet.y, '#d7ba67', 2);
            if (bullet.pierce <= 0) bullet.life = 0;
          }
        }
      }
      for (const bullet of enemyProjectiles) {
        bullet.x += bullet.vx * dt; bullet.y += bullet.vy * dt; bullet.life -= dt;
        if (distance(player, bullet) < bullet.radius + 19) { hurt(bullet.damage); bullet.life = 0; }
        if (phase !== 'playing') break;
      }
      for (const gem of gems) {
        gem.age += dt;
        const dx = player.x - gem.x, dy = player.y - gem.y, d = Math.hypot(dx, dy);
        const travel = (210 + gem.age * 85) * dt;
        if (d <= travel + 17) { pendingXp += gem.value; gem.collected = true; }
        else { gem.x += dx / d * travel; gem.y += dy / d * travel; }
      }
    }
    enemies = enemies.filter(enemy => !enemy.dead);
    projectiles = projectiles.filter(bullet => bullet.life > 0 && bullet.x > -80 && bullet.x < width + 80 && bullet.y > -80 && bullet.y < height + 80);
    enemyProjectiles = enemyProjectiles.filter(bullet => bullet.life > 0 && bullet.x > -60 && bullet.x < width + 60 && bullet.y > 30 && bullet.y < height + 60);
    gems = gems.filter(gem => !gem.collected);
    xp += pendingXp; pendingXp = 0; reportScore();
    if (phase === 'playing' && !endless && elapsed >= ROUND_SECONDS && finalBossDefeated) finish(true);
    if (phase === 'playing') checkLevel();
  }

  function controlDown(action, playerIndex = 0) {
    if (playerIndex !== 0 || !Object.hasOwn(held, action)) return false;
    if (phase !== 'playing') return false;
    if (action === 'dash') { if (!held.dash) dash(); held.dash = true; }
    else held[action] = true;
    return true;
  }

  function controlUp(action, playerIndex = 0) {
    if (playerIndex !== 0 || !Object.hasOwn(held, action)) return false;
    held[action] = false; return true;
  }

  function actionFor(event) {
    const code = event.code, key = event.key?.toLowerCase();
    if (code === 'ArrowLeft' || code === 'KeyA' || key === 'arrowleft' || key === 'a') return 'left';
    if (code === 'ArrowRight' || code === 'KeyD' || key === 'arrowright' || key === 'd') return 'right';
    if (code === 'ArrowUp' || code === 'KeyW' || key === 'arrowup' || key === 'w') return 'up';
    if (code === 'ArrowDown' || code === 'KeyS' || key === 'arrowdown' || key === 's') return 'down';
    if (code === 'Space' || key === ' ') return 'dash';
    return null;
  }

  function upgradeRect(index) {
    const cardWidth = Math.min(252, (width - 100) / 3 - 16);
    const allWidth = cardWidth * 3 + 32;
    return { x: (width - allWidth) / 2 + index * (cardWidth + 16), y: height / 2 - 58, width: cardWidth, height: 194 };
  }

  function pointerDown(point) {
    if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return;
    if (phase === 'upgrading') {
      const index = upgrades.findIndex((_, i) => { const r = upgradeRect(i); return point.x >= r.x && point.x <= r.x + r.width && point.y >= r.y && point.y <= r.y + r.height; });
      if (index >= 0) chooseUpgrade(index);
    } else if (phase === 'playing') pointer = { x: point.x, y: point.y };
  }

  function rounded(x, y, w, h, r, fill, stroke) {
    if (w <= 0 || h <= 0) return;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); }
  }

  function text(value, x, y, size = 16, color = '#365344', align = 'center', weight = 700) {
    ctx.font = `${weight} ${size}px "Noto Sans SC", system-ui, sans-serif`; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillText(value, x, y);
  }

  function bottle(x, y, angle = 0, size = 1) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(angle); ctx.scale(size, size);
    rounded(-9, -12, 18, 29, 6, '#fff9dd', '#819373');
    rounded(-6, -20, 12, 10, 3, '#a8c28f', '#819373');
    rounded(-7, 0, 14, 12, 3, '#d3e5c0');
    ctx.strokeStyle = '#bdcaae'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-3, -7); ctx.lineTo(4, -7); ctx.moveTo(-3, -2); ctx.lineTo(4, -2); ctx.stroke();
    ctx.restore();
  }

  function enemyArt(enemy, time) {
    const r = enemy.radius;
    ctx.save(); ctx.translate(enemy.x, enemy.y);
    ctx.fillStyle = '#4b67411a'; ctx.beginPath(); ctx.ellipse(0, r * 0.8, r * 0.9, r * 0.3, 0, 0, TAU); ctx.fill();
    ctx.translate(0, Math.sin(time * 5 + enemy.wobble) * 1.7);
    if (enemy.kind === 'runner') {
      ctx.fillStyle = enemy.hitFlash > 0 ? '#fff8e8' : '#d89596'; ctx.strokeStyle = '#ae757c'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#eeb9b2'; ctx.beginPath(); ctx.ellipse(-5, -5, 4, 6, 0.4, 0, TAU); ctx.fill();
    } else if (enemy.kind === 'shooter') {
      ctx.fillStyle = enemy.hitFlash > 0 ? '#fff9e1' : '#e5bd78'; ctx.strokeStyle = '#b29562'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill(); ctx.stroke();
      rounded(-r - 2, -r - 7, 11, 9, 5, '#b69466'); rounded(r - 9, -r - 7, 11, 9, 5, '#b69466');
      ctx.strokeStyle = '#826a51'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(0, 1); ctx.lineTo(8, 5); ctx.stroke();
    } else {
      const boss = enemy.kind === 'boss', tank = enemy.kind === 'tank';
      rounded(-r, -r, r * 2, r * 2, boss ? 10 : 6, enemy.hitFlash > 0 ? '#fffdf1' : boss ? '#eed4b4' : tank ? '#c9ad88' : '#f2e8c8', boss ? '#a77667' : '#9a9974');
      rounded(-r, -r, r * 2, r * 0.4, 4, boss ? '#cd8c78' : tank ? '#a08b6d' : '#aebf8e');
      if (boss) { text('加班', 0, r * 0.4, r * 0.38, '#956556'); rounded(-r - 13, -5, 13, r * 0.65, 5, '#c2a282'); rounded(r, -5, 13, r * 0.65, 5, '#c2a282'); }
      else if (!tank) text('奶', 0, r * 0.37, 13, '#a4ac87');
    }
    ctx.fillStyle = '#655f53';
    for (const side of [-1, 1]) { ctx.beginPath(); ctx.arc(side * r * 0.34, -r * 0.15, Math.max(2, r * 0.08), 0, TAU); ctx.fill(); }
    ctx.strokeStyle = '#756153'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-r * 0.51, -r * 0.42); ctx.lineTo(-r * 0.17, -r * 0.31); ctx.moveTo(r * 0.51, -r * 0.42); ctx.lineTo(r * 0.17, -r * 0.31); ctx.stroke();
    if (enemy.hp < enemy.maxHp) {
      rounded(-r, -r - 13, r * 2, 5, 2, '#d4d3b6');
      rounded(-r, -r - 13, r * 2 * clamp(enemy.hp / enemy.maxHp, 0, 1), 5, 2, enemy.kind === 'boss' ? '#c98170' : '#a4bb73');
    }
    ctx.restore();
  }

  function clock(seconds) { return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`; }

  function render(time = elapsed) {
    ctx.save(); ctx.fillStyle = '#e9efdc'; ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#e2ead3';
    for (let row = 0; row < 9; row += 1) for (let col = 0; col < 15; col += 1) if ((row + col) % 2 === 0) ctx.fillRect(col * 72, row * 66, 72, 66);
    rounded(16, 89, width - 32, height - 114, 25, '#edf2df88', '#cbd9b6');
    for (let i = 0; i < 31; i += 1) {
      const x = 35 + i * 173 % (width - 70), y = 114 + i * 83 % Math.max(1, height - 157);
      ctx.strokeStyle = i % 3 ? '#becfa2' : '#b8c69d'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, y + 4); ctx.lineTo(x - 3, y - 3); ctx.moveTo(x, y + 4); ctx.lineTo(x + 3, y - 1); ctx.stroke();
      if (i % 5 === 0) { ctx.fillStyle = '#f7e4a8'; ctx.beginPath(); ctx.arc(x + 4, y - 5, 3, 0, TAU); ctx.fill(); }
    }

    const visibleEnemies = phase === 'idle' ? [
      { x: center.x - 176, y: center.y + 36, kind: 'carton', radius: 22, hp: 1, maxHp: 1, wobble: 0 },
      { x: center.x + 172, y: center.y - 62, kind: 'runner', radius: 17, hp: 1, maxHp: 1, wobble: 1 },
      { x: center.x + 209, y: center.y + 90, kind: 'tank', radius: 27, hp: 1, maxHp: 1, wobble: 2 },
    ] : enemies;
    for (const gem of gems) {
      ctx.fillStyle = '#92bc96'; ctx.strokeStyle = '#eef8cf'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(gem.x, gem.y - gem.radius); ctx.lineTo(gem.x + gem.radius, gem.y); ctx.lineTo(gem.x, gem.y + gem.radius); ctx.lineTo(gem.x - gem.radius, gem.y); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    for (const enemy of visibleEnemies) enemyArt(enemy, time);
    for (const bullet of projectiles) {
      ctx.fillStyle = '#f2d36e'; ctx.strokeStyle = '#bb9e49'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(bullet.x, bullet.y, bullet.radius, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fffbe0'; ctx.beginPath(); ctx.arc(bullet.x - 2, bullet.y - 2, 2, 0, TAU); ctx.fill();
    }
    for (const bullet of enemyProjectiles) {
      ctx.fillStyle = '#d58473'; ctx.strokeStyle = '#fff0d6'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(bullet.x, bullet.y, bullet.radius, 0, TAU); ctx.fill(); ctx.stroke();
    }
    const px = phase === 'idle' ? center.x : player.x, py = phase === 'idle' ? center.y : player.y;
    ctx.fillStyle = '#60724b22'; ctx.beginPath(); ctx.ellipse(px, py + 25, 31, 9, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = invulnerability > 0 ? '#ffe08b' : '#fdfdf2'; ctx.lineWidth = invulnerability > 0 ? 3.5 : 2;
    ctx.beginPath(); ctx.ellipse(px, py + 13, invulnerability > 0 ? 39 : 32, invulnerability > 0 ? 28 : 15, 0, 0, TAU); ctx.stroke();
    if (dashTime > 0) ctx.globalAlpha = 0.75;
    drawFrog(ctx, px, py - 6, 55, { expression: phase === 'ending' && !won ? 'squish' : invulnerability > 0 && dashTime <= 0 ? 'hurt' : 'laugh', rotation: facing.x * (dashTime > 0 ? 0.2 : 0.035), scaleY: phase === 'ending' && !won ? 0.63 : 1 });
    ctx.globalAlpha = 1;
    for (const item of bottlePositions()) bottle(item.x, item.y, item.angle * 0.35, 0.85);
    if (phase === 'idle') { bottle(px - 72, py, -0.2); bottle(px + 72, py, 0.2); text('走位交给你，哈哈交给蛙。', width / 2, 155, 24, '#6b805c'); }
    for (const p of effects) {
      ctx.globalAlpha = 1 - p.age / p.life;
      if (p.type === 'ring') {
        ctx.strokeStyle = p.color; ctx.lineWidth = 5 * (1 - p.age / p.life) + 1;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.radius * Math.min(1, 0.15 + p.age / p.life), 0, TAU); ctx.stroke();
      } else { ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU); ctx.fill(); }
    }
    for (const label of labels) { ctx.globalAlpha = Math.min(1, (label.life - label.age) * 3); text(label.text, label.x, label.y, 17, label.color); }
    ctx.globalAlpha = 1;

    rounded(16, 13, 246, 60, 16, '#fffdf3ee');
    text('奶蛙生命', 31, 31, 14, '#71805f', 'left'); text(`${Math.ceil(player.hp)} / ${player.maxHp}`, 245, 31, 14, '#6b775e', 'right');
    rounded(31, 46, 214, 12, 6, '#e8dfd1');
    rounded(31, 46, 214 * Math.max(0, player.hp / player.maxHp), 12, 6, player.hp < player.maxHp * 0.3 ? '#d68a77' : '#a7bf83');
    rounded(width / 2 - 86, 13, 172, 60, 16, '#fffdf3ee');
    text(endless ? `∞ ${clock(elapsed)}` : elapsed >= ROUND_SECONDS ? '最终 BOSS 战' : clock(ROUND_SECONDS - elapsed), width / 2, 36, 25);
    text(`第 ${wave} 波 · ${endless ? '无限生存' : '坚持 3 分钟'}`, width / 2, 59, 12, '#869172');
    rounded(width - 250, 13, 234, 60, 16, '#fffdf3ee');
    text(`击退 ${kills} 只`, width - 234, 33, 17, '#506c4d', 'left');
    text(dashCooldown > 0 ? `冲刺 ${dashCooldown.toFixed(1)}s` : '冲刺就绪', width - 32, 33, 15, dashCooldown > 0 ? '#9b927c' : '#6a967b', 'right');
    text(`Lv.${level}  奶蛙越来越离谱`, width - 133, 57, 12, '#839174');
    rounded(22, 79, width - 44, 6, 3, '#cedabe');
    rounded(22, 79, (width - 44) * Math.min(1, xp / xpNeeded), 6, 3, '#b39ccb');
    text(`经验 ${xp}/${xpNeeded}`, width / 2, height - 13, 12, '#738360');
    text('WASD / 方向键移动', 27, height - 13, 12, '#7a8968', 'left');
    text('空格冲刺 · 经验自动回收', width - 27, height - 13, 12, '#7a8968', 'right');
    const boss = enemies.find(enemy => enemy.kind === 'boss');
    if (boss) {
      rounded(width / 2 - 151, 98, 302, 31, 10, '#fff4e4ee');
      rounded(width / 2 - 139, 118, 278, 5, 2, '#e2cabb');
      rounded(width / 2 - 139, 118, 278 * Math.max(0, boss.hp / boss.maxHp), 5, 2, '#d18e7b');
      text(boss.final ? '最终 BOSS · 加班大王' : 'BOSS · 加班奶盒', width / 2, 108, 12, '#a46f59');
    }

    if (phase === 'upgrading') {
      ctx.fillStyle = '#263e2d8f'; ctx.fillRect(0, 0, width, height);
      text(`奶蛙升级了！Lv.${level}`, width / 2, height / 2 - 124, 31, '#fff9df');
      text('时间已暂停 · 选择一种成长继续生存', width / 2, height / 2 - 86, 17, '#e5ecd6');
      upgrades.forEach((choice, index) => {
        const r = upgradeRect(index);
        rounded(r.x, r.y, r.width, r.height, 20, '#fff9e9', '#ccd9b2');
        rounded(r.x + 17, r.y + 17, 34, 32, 10, '#e6edcf'); text(String(index + 1), r.x + 34, r.y + 33, 20, '#657b49');
        text(choice.name, r.x + r.width / 2, r.y + 78, 21);
        const chars = [...choice.description], perLine = Math.floor((r.width - 34) / 14);
        for (let n = 0; n < chars.length; n += perLine) text(chars.slice(n, n + perLine).join(''), r.x + 17, r.y + 112 + Math.floor(n / perLine) * 22, 14, '#7d876c', 'left', 500);
        text('点击选择', r.x + r.width / 2, r.y + r.height - 22, 13, '#9aaa83');
      });
    }
    ctx.restore();
  }

  return {
    start, update, render, controlDown, controlUp, cancelInput, chooseUpgrade,
    getUpgrades() { return upgrades.map(choice => ({ ...choice })); },
    pointerDown,
    pointerMove(point) { if (phase === 'playing' && pointer && Number.isFinite(point?.x) && Number.isFinite(point?.y)) pointer = { x: point.x, y: point.y }; },
    pointerUp(point) { pointer = null; if (point?.cancelled) cancelInput(); },
    keyDown(event) {
      const digit = /^[123]$/.test(event.key || '') ? Number(event.key) - 1 : /^Digit[123]$/.test(event.code || '') ? Number(event.code.slice(-1)) - 1 : -1;
      if (phase === 'upgrading' && digit >= 0) { if (!event.repeat) chooseUpgrade(digit); return true; }
      const action = actionFor(event);
      if (!action) return false;
      if (!event.repeat || action !== 'dash') controlDown(action);
      return true;
    },
    keyUp(event) { const action = actionFor(event); return action ? controlUp(action) : false; },
    destroy() { phase = 'idle'; cancelInput(); upgrades = []; enemies = []; projectiles = []; enemyProjectiles = []; gems = []; effects = []; labels = []; },
    getState(options = {}) {
      const state = { phase, endless, score, elapsed, roundSeconds: ROUND_SECONDS, wave, level, kills, xp, xpNeeded,
        player: { ...player, invulnerable: invulnerability > 0 || dashTime > 0 },
        dashCooldown, dashTime, held: { ...held }, upgrades: upgrades.map(choice => ({ ...choice })), weapons: { ...ranks }, stats: { ...stats },
        finalBossSpawned, finalBossDefeated, won, bounds: { ...bounds }, caps: { ...CAPS },
        entityCounts: { enemies: enemies.length, projectiles: projectiles.length, enemyProjectiles: enemyProjectiles.length, gems: gems.length, effects: effects.length, labels: labels.length },
      };
      if (options.details) {
        state.enemies = enemies.map(({ id, kind, x, y, hp, maxHp, radius, final }) => ({ id, kind, x, y, hp, maxHp, radius, final }));
        state.projectiles = projectiles.map(({ x, y, damage }) => ({ x, y, damage }));
        state.enemyProjectiles = enemyProjectiles.map(({ x, y, radius }) => ({ x, y, radius }));
        state.gems = gems.map(({ x, y, value }) => ({ x, y, value }));
        state.upgradeRects = upgrades.map((_, index) => upgradeRect(index));
      }
      return state;
    },
  };
}
