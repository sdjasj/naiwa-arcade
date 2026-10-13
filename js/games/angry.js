const W = 960;
const H = 560;
const GROUND = 466;
const SLING = { x: 176, y: 342 };
const MAX_PULL = 112;
const POWER = 8.2;
const GRAVITY = 820;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

export function createGame(env) {
  const { ctx, drawFrog, audio, onScore, onStatus, onEnd } = env;
  let phase = 'idle';
  let score = 0;
  let level = 0;
  let shots = 3;
  let bodies = [];
  let particles = [];
  let frog = null;
  let flightTime = 0;
  let phaseTime = 0;
  let elapsed = 0;
  let nextId = 0;
  let aimAngle = 42 * Math.PI / 180;
  let aimPower = 0.8;
  let keyboardAiming = false;
  let dragStartAim = null;
  let laughTime = 0;
  let hitCooldown = 0;
  let endSent = false;
  let shake = 0;
  let trail = [];
  let trailTime = 0;
  let combo = '';
  let comboTime = 0;

  function sound(kind) { audio?.play?.(kind); }
  function status(text) { onStatus?.(text); }
  function addScore(amount) { score += amount; onScore?.(score); }
  function targetCount() { return bodies.filter(b => b.target && !b.removed).length; }
  function rounded(x, y, w, h, r = 8) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  }

  function body(x, y, w, h, target = false) {
    const mass = target ? 1.1 : Math.max(1.25, w * h / 1050);
    bodies.push({ id: nextId++, x, y, w, h, vx: 0, vy: 0, mass,
      inv: 1 / mass, target, hp: target ? 48 : 190, maxHp: target ? 48 : 190,
      removed: false, angle: 0, spin: 0, tint: nextId % 3 });
  }

  function tower(cx, base = GROUND, wide = 132, tall = 95, topTarget = true) {
    body(cx - wide / 2 + 9, base - tall / 2, 18, tall);
    body(cx + wide / 2 - 9, base - tall / 2, 18, tall);
    body(cx, base - tall - 10, wide + 22, 20);
    body(cx, base - 20, 34, 40, true);
    if (topTarget) body(cx, base - tall - 40, 34, 40, true);
  }

  function loadLevel(index) {
    level = index;
    bodies = [];
    particles = [];
    trail = [];
    shots = 3;
    frog = null;
    phase = 'ready';
    phaseTime = 0;
    aimAngle = (index === 2 ? 47 : 42) * Math.PI / 180;
    aimPower = 0.8;
    keyboardAiming = false;
    dragStartAim = null;
    if (index === 0) {
      tower(701, GROUND, 130, 86);
    } else if (index === 1) {
      tower(648, GROUND, 120, 92, false);
      tower(827, GROUND, 104, 128, true);
      body(650, GROUND - 120, 34, 40, true);
    } else {
      tower(710, GROUND, 182, 95, false);
      const upperBase = GROUND - 115;
      tower(710, upperBase, 110, 76, true);
      body(845, GROUND - 20, 34, 40, true);
    }
    status(`第 ${level + 1} / 3 关 · ${shots} 发机会 · 拉住奶蛙向左下拖，再松手！`);
  }

  function start() {
    score = 0;
    elapsed = 0;
    shake = 0;
    combo = '';
    endSent = false;
    onScore?.(0);
    loadLevel(0);
  }

  function finish(win) {
    if (endSent) return;
    phase = 'ended';
    endSent = true;
    sound(win ? 'win' : 'miss');
    onEnd?.({ score, title: win ? '奶蛙拆迁队，收工！' : '笑是笑了，房还在',
      message: win ? `三关全部拆完！奶蛙的肚子，才是真正的攻城锤。` : `闯到第 ${level + 1} 关，还有 ${targetCount()} 个奶盒在偷笑。瞄准木架底部，再试一次！` });
  }

  function burst(x, y, color, count = 12) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 55 + Math.random() * 180;
      particles.push({ x, y, vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 55, life: 0.6 + Math.random() * 0.4,
        size: 3 + Math.random() * 5, color, angle: Math.random() * 6 });
    }
  }

  function damage(b, impact, fromFrog = false) {
    if (b.removed) return;
    const threshold = b.target ? 105 : 185;
    if (impact < threshold) return;
    b.hp -= (impact - threshold) * (b.target ? 1.0 : fromFrog ? 1.1 : 0.52);
    b.spin = clamp(b.spin + (b.vx / 500), -1.5, 1.5);
    if (b.hp <= 0) {
      b.removed = true;
      burst(b.x, b.y, b.target ? '#eb9588' : '#bf865b', b.target ? 17 : 10);
      addScore(b.target ? 200 : 35);
      if (b.target) {
        sound('score');
        combo = ['奶盒：笑不出来了', '肚皮攻击，效果拔群', '拆掉了！蛙哈哈哈'][Math.floor(Math.random() * 3)];
        comboTime = 1.6;
      } else if (hitCooldown <= 0) {
        sound('hit');
        hitCooldown = 0.16;
      }
      shake = Math.max(shake, b.target ? 4 : 2);
    }
  }

  function collideBodies(a, b) {
    if (a.removed || b.removed) return;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const ox = (a.w + b.w) / 2 - Math.abs(dx);
    const oy = (a.h + b.h) / 2 - Math.abs(dy);
    if (ox <= 0 || oy <= 0) return;
    let nx = 0, ny = 0, penetration;
    if (ox < oy) { nx = dx < 0 ? -1 : 1; penetration = ox; }
    else { ny = dy < 0 ? -1 : 1; penetration = oy; }
    const inv = a.inv + b.inv;
    const correction = Math.max(0, penetration - 0.035) * 0.8 / inv;
    a.x -= nx * correction * a.inv;
    a.y -= ny * correction * a.inv;
    b.x += nx * correction * b.inv;
    b.y += ny * correction * b.inv;
    const relative = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    if (relative >= 0) return;
    const impulse = -relative * 1.03 / inv;
    a.vx -= impulse * nx * a.inv;
    a.vy -= impulse * ny * a.inv;
    b.vx += impulse * nx * b.inv;
    b.vy += impulse * ny * b.inv;
    const tx = -ny, ty = nx;
    const friction = clamp(-((b.vx - a.vx) * tx + (b.vy - a.vy) * ty) / inv,
      -impulse * 0.35, impulse * 0.35);
    a.vx -= friction * tx * a.inv;
    a.vy -= friction * ty * a.inv;
    b.vx += friction * tx * b.inv;
    b.vy += friction * ty * b.inv;
    damage(a, -relative);
    damage(b, -relative);
  }

  function collideFrog(b) {
    if (!frog || b.removed) return;
    const px = clamp(frog.x, b.x - b.w / 2, b.x + b.w / 2);
    const py = clamp(frog.y, b.y - b.h / 2, b.y + b.h / 2);
    let dx = frog.x - px, dy = frog.y - py;
    let distance = Math.hypot(dx, dy);
    if (distance >= frog.r) return;
    if (distance < 0.001) {
      const sides = [
        { distance: frog.x - b.x + b.w / 2, nx: -1, ny: 0 },
        { distance: b.x + b.w / 2 - frog.x, nx: 1, ny: 0 },
        { distance: frog.y - b.y + b.h / 2, nx: 0, ny: -1 },
        { distance: b.y + b.h / 2 - frog.y, nx: 0, ny: 1 },
      ].sort((a, z) => a.distance - z.distance);
      dx = sides[0].nx; dy = sides[0].ny; distance = 0;
    } else { dx /= distance; dy /= distance; }
    const frogInv = 1 / 5;
    const totalInv = frogInv + b.inv;
    const correction = (frog.r - distance + 0.05) / totalInv;
    frog.x += dx * correction * frogInv;
    frog.y += dy * correction * frogInv;
    b.x -= dx * correction * b.inv;
    b.y -= dy * correction * b.inv;
    const relative = (frog.vx - b.vx) * dx + (frog.vy - b.vy) * dy;
    if (relative >= 0) return;
    const impulse = -(1 + 0.46) * relative / totalInv;
    frog.vx += impulse * dx * frogInv;
    frog.vy += impulse * dy * frogInv;
    b.vx -= impulse * dx * b.inv;
    b.vy -= impulse * dy * b.inv;
    b.spin = clamp(-dx * relative / 400, -1.8, 1.8);
    frog.squish = 0.24;
    shake = Math.max(shake, Math.min(7, -relative / 90));
    damage(b, -relative, true);
    if (hitCooldown <= 0) { sound('hit'); hitCooldown = 0.14; }
  }

  function stepPhysics(dt) {
    for (const b of bodies) {
      if (b.removed) continue;
      b.vy += GRAVITY * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.vx *= Math.pow(0.988, dt * 60);
      if (Math.abs(b.vx) > 30 || b.y + b.h / 2 < GROUND - 4) {
        b.angle = clamp(b.angle + b.spin * dt, -0.2, 0.2);
      }
      b.spin *= Math.pow(0.95, dt * 60);
      if (b.x > W + 90 || b.x < -90 || b.y > H + 100) {
        damage(b, 1200);
      }
    }
    if (frog) {
      frog.vy += GRAVITY * dt;
      frog.x += frog.vx * dt;
      frog.y += frog.vy * dt;
      frog.rotation += frog.vx * dt / 150;
      frog.squish = Math.max(0, frog.squish - dt);
      if (frog.y + frog.r >= GROUND) {
        frog.y = GROUND - frog.r;
        if (frog.vy > 70) {
          frog.vy *= -0.42;
          frog.squish = 0.2;
          if (hitCooldown <= 0) { sound('pop'); hitCooldown = 0.2; }
        } else { frog.vy = 0; }
        frog.vx *= Math.pow(0.9, dt * 60);
      }
    }
    for (let iteration = 0; iteration < 5; iteration++) {
      for (const b of bodies) {
        if (b.removed) continue;
        if (b.y + b.h / 2 > GROUND) {
          b.y = GROUND - b.h / 2;
          if (b.vy > 0) {
            damage(b, b.vy);
            b.vy = 0;
            b.vx *= 0.83;
          }
        }
      }
      for (let i = 0; i < bodies.length; i++) {
        for (let j = i + 1; j < bodies.length; j++) collideBodies(bodies[i], bodies[j]);
      }
      for (const b of bodies) collideFrog(b);
    }
  }

  function aimedPosition() {
    const length = MAX_PULL * aimPower;
    return { x: SLING.x - Math.cos(aimAngle) * length,
      y: SLING.y + Math.sin(aimAngle) * length };
  }

  function launch() {
    if (phase !== 'ready' && phase !== 'dragging') return;
    const p = aimedPosition();
    dragStartAim = null;
    phase = 'flying';
    shots--;
    flightTime = 0;
    phaseTime = 0;
    laughTime = 0.32;
    trail = [];
    frog = { x: p.x, y: p.y, vx: (SLING.x - p.x) * POWER,
      vy: (SLING.y - p.y) * POWER, r: 24, rotation: 0, squish: 0 };
    sound('launch');
    status(`蛙哈哈哈哈——！ · 剩余 ${shots} 发 · 还有 ${targetCount()} 个奶盒`);
  }

  function update(dt) {
    if (phase === 'idle' || phase === 'ended') return;
    dt = Math.min(Math.max(dt, 0), 0.05);
    elapsed += dt;
    phaseTime += dt;
    hitCooldown -= dt;
    comboTime -= dt;
    shake *= Math.pow(0.82, dt * 60);
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    for (let i = 0; i < steps; i++) stepPhysics(dt / steps);
    for (const p of particles) {
      p.life -= dt; p.vy += 480 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      p.angle += dt * 3;
    }
    particles = particles.filter(p => p.life > 0);
    if (frog && phase === 'flying') {
      flightTime += dt;
      laughTime -= dt;
      trailTime += dt;
      if (trailTime > 0.075) { trailTime = 0; trail.push({ x: frog.x, y: frog.y }); }
      if (trail.length > 50) trail.shift();
      if (laughTime <= 0 && flightTime < 3.6) { sound('laugh'); laughTime = 0.85; }
      const resting = flightTime > 1 && Math.hypot(frog.vx, frog.vy) < 26;
      const outside = frog.x > W + 100 || frog.x < -100 || frog.y > H + 100;
      if (resting || outside || flightTime > 7) { phase = 'settling'; phaseTime = 0; }
    }
    if (targetCount() === 0 && phase !== 'levelclear') {
      addScore(shots * 100 + 150);
      phase = 'levelclear';
      phaseTime = 0;
      sound('win');
      combo = `第 ${level + 1} 关拆完！剩余弹药奖励 +${shots * 100}`;
      comboTime = 2;
      status(level < 2 ? '拆得漂亮！马上搬去下一个工地…' : '三关全通！奶蛙今天也很努力。');
    }
    if (phase === 'levelclear' && phaseTime > 1.7) {
      if (level < 2) loadLevel(level + 1);
      else finish(true);
    } else if (phase === 'settling' && phaseTime > 1.7) {
      if (shots <= 0) finish(false);
      else {
        phase = 'ready'; frog = null; phaseTime = 0;
        status(`剩余 ${shots} 发 · 还有 ${targetCount()} 个奶盒 · 试试撞木柱，让整座塔倒下来！`);
      }
    }
  }

  function pointerDown(point) {
    if (phase !== 'ready') return;
    const p = aimedPosition();
    if (Math.hypot(point.x - SLING.x, point.y - SLING.y) < 135 ||
      Math.hypot(point.x - p.x, point.y - p.y) < 60) {
      dragStartAim = { angle: aimAngle, power: aimPower };
      phase = 'dragging';
      pointerMove(point);
      sound('pop');
      status('继续向左下拉 · 白点是飞行路线 · 松手，蛙射！');
    }
  }

  function pointerMove(point) {
    if (phase !== 'dragging') return;
    const dx = clamp(SLING.x - point.x, 12, MAX_PULL);
    const dy = clamp(point.y - SLING.y, -12, MAX_PULL);
    aimAngle = clamp(Math.atan2(dy, dx), -0.12, Math.PI * 0.43);
    aimPower = clamp(Math.hypot(dx, dy) / MAX_PULL, 0.16, 1);
  }

  function pointerUp(point) {
    if (phase !== 'dragging') return;
    if (point?.cancelled) {
      if (dragStartAim) {
        aimAngle = dragStartAim.angle;
        aimPower = dragStartAim.power;
      }
      dragStartAim = null;
      keyboardAiming = false;
      phase = 'ready';
      phaseTime = 0;
      status(`奶蛙已收回弹弓 · 剩余 ${shots} 发 · 拉住奶蛙，再试一次！`);
      return;
    }
    launch();
  }

  function keyDown(event) {
    if (phase !== 'ready' && phase !== 'dragging') return;
    const key = event.key;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Spacebar', 'Enter'].includes(key)) {
      event.preventDefault?.();
    }
    if (key === 'ArrowUp') aimAngle = Math.min(Math.PI * 0.43, aimAngle + 0.055);
    if (key === 'ArrowDown') aimAngle = Math.max(-0.1, aimAngle - 0.055);
    if (key === 'ArrowLeft') aimPower = Math.max(0.2, aimPower - 0.04);
    if (key === 'ArrowRight') aimPower = Math.min(1, aimPower + 0.04);
    if (key.startsWith('Arrow')) keyboardAiming = true;
    if (key === ' ' || key === 'Spacebar' || key === 'Enter') {
      if (!event.repeat) launch();
    }
  }

  function cloud(x, y, scale) {
    ctx.fillStyle = '#fff9ea';
    ctx.beginPath();
    ctx.ellipse(x, y, 49 * scale, 17 * scale, 0, 0, Math.PI * 2);
    ctx.ellipse(x - 20 * scale, y - 13 * scale, 24 * scale, 23 * scale, 0, 0, Math.PI * 2);
    ctx.ellipse(x + 10 * scale, y - 19 * scale, 30 * scale, 29 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawBackground(time) {
    ctx.fillStyle = '#f8ead6'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#f2b174'; ctx.beginPath(); ctx.arc(809, 100, 42, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#db9360'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(798, 98, 2, 0, Math.PI * 2); ctx.arc(821, 98, 2, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(809, 105, 8, 0.1, Math.PI - 0.1); ctx.stroke();
    cloud(178 + Math.sin(time * 0.09) * 12, 116, 1);
    cloud(496 + Math.sin(time * 0.12) * 9, 155, 0.72);
    ctx.fillStyle = '#dce0bb';
    ctx.beginPath(); ctx.moveTo(0, 404); ctx.bezierCurveTo(160, 240, 281, 441, 440, 349);
    ctx.bezierCurveTo(625, 219, 757, 427, 960, 312); ctx.lineTo(W, GROUND); ctx.lineTo(0, GROUND); ctx.fill();
    ctx.fillStyle = '#c6cba0';
    ctx.beginPath(); ctx.moveTo(0, 440); ctx.bezierCurveTo(223, 355, 355, 495, 538, 416);
    ctx.bezierCurveTo(695, 365, 818, 454, 960, 395); ctx.lineTo(W, GROUND); ctx.lineTo(0, GROUND); ctx.fill();
    ctx.fillStyle = '#cfab82'; ctx.fillRect(0, GROUND, W, H - GROUND);
    ctx.fillStyle = '#a7b480'; ctx.fillRect(0, GROUND - 4, W, 8);
    ctx.strokeStyle = '#bd956e'; ctx.lineWidth = 2;
    for (let i = 0; i < 26; i++) {
      const x = (i * 137 + 19) % W, y = 488 + ((i * 31) % 55);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 8, y + 2); ctx.stroke();
    }
    ctx.fillStyle = '#4f5840'; ctx.font = '700 17px system-ui, sans-serif';
    ctx.textAlign = 'left'; ctx.fillText(`拆迁进度  ${level + 1} / 3`, 30, 38);
    ctx.fillStyle = '#77755f'; ctx.font = '13px system-ui, sans-serif';
    ctx.fillText(`奶盒剩余 ${targetCount()} 个`, 30, 61);
    ctx.textAlign = 'right'; ctx.fillStyle = '#4f5840'; ctx.font = '700 15px system-ui, sans-serif';
    ctx.fillText(`剩余弹药  ${shots} / 3`, W - 30, 38);
    ctx.textAlign = 'center'; ctx.font = '13px system-ui, sans-serif'; ctx.fillStyle = '#72573d';
    ctx.fillText('拖住奶蛙向左下拉，松手发射  ·  ↑↓ 调角度  ←→ 调力度  空格发射', W / 2, 538);
  }

  function drawBody(b, time) {
    if (b.removed) return;
    ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.angle);
    if (b.target) {
      ctx.fillStyle = 'rgba(65,63,45,.12)'; ctx.beginPath();
      ctx.ellipse(0, b.h / 2 + 2, 20, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffe6d9'; ctx.strokeStyle = '#865e48'; ctx.lineWidth = 2.5;
      rounded(-b.w / 2, -b.h / 2 + 5, b.w, b.h - 5, 5); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#e9917c'; ctx.beginPath();
      ctx.moveTo(-b.w / 2, -b.h / 2 + 6); ctx.lineTo(-8, -b.h / 2 - 4);
      ctx.lineTo(11, -b.h / 2 - 4); ctx.lineTo(b.w / 2, -b.h / 2 + 6); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#604636';
      const blink = Math.sin(time * 2.1 + b.id * 3) > 0.995;
      ctx.beginPath(); ctx.ellipse(-6, -2, 2, blink ? 0.6 : 3, 0, 0, Math.PI * 2);
      ctx.ellipse(6, -2, 2, blink ? 0.6 : 3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(0, 5, 5, 0.1, Math.PI - 0.1); ctx.stroke();
      ctx.fillStyle = '#eeaa96'; ctx.fillRect(-13, 4, 4, 2); ctx.fillRect(9, 4, 4, 2);
      ctx.font = '700 7px system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillStyle = '#aa7660'; ctx.fillText('MILK', 0, 16);
    } else {
      const colors = ['#cc9366', '#dca779', '#c28a60'];
      ctx.fillStyle = colors[b.tint]; ctx.strokeStyle = '#8c6244'; ctx.lineWidth = 2.2;
      rounded(-b.w / 2, -b.h / 2, b.w, b.h, 3); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = 'rgba(125,79,44,.3)'; ctx.lineWidth = 1.2;
      ctx.beginPath();
      if (b.w > b.h) { ctx.moveTo(-b.w / 2 + 9, -2); ctx.lineTo(b.w / 2 - 9, -2); }
      else { ctx.moveTo(-2, -b.h / 2 + 9); ctx.lineTo(-2, b.h / 2 - 9); }
      ctx.stroke();
      ctx.fillStyle = '#846749';
      for (const end of [-1, 1]) {
        ctx.beginPath(); ctx.arc(b.w > b.h ? end * (b.w / 2 - 7) : 0,
          b.h > b.w ? end * (b.h / 2 - 7) : 0, 1.8, 0, Math.PI * 2); ctx.fill();
      }
      if (b.hp < b.maxHp * 0.8) {
        ctx.strokeStyle = '#805538'; ctx.beginPath(); ctx.moveTo(-3, -b.h / 2);
        ctx.lineTo(3, -3); ctx.lineTo(-3, 3); ctx.lineTo(2, b.h / 2); ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawSling(front = false) {
    ctx.lineCap = 'round';
    if (!front) {
      ctx.strokeStyle = '#77563c'; ctx.lineWidth = 18;
      ctx.beginPath(); ctx.moveTo(SLING.x, GROUND - 2); ctx.lineTo(SLING.x, SLING.y + 43);
      ctx.lineTo(SLING.x + 22, SLING.y - 4); ctx.stroke();
      ctx.strokeStyle = '#b38558'; ctx.lineWidth = 9;
      ctx.beginPath(); ctx.moveTo(SLING.x + 2, GROUND - 8); ctx.lineTo(SLING.x + 2, SLING.y + 44);
      ctx.lineTo(SLING.x + 23, SLING.y - 4); ctx.stroke();
    } else {
      ctx.strokeStyle = '#77563c'; ctx.lineWidth = 17;
      ctx.beginPath(); ctx.moveTo(SLING.x, SLING.y + 48); ctx.lineTo(SLING.x - 22, SLING.y - 4); ctx.stroke();
      ctx.strokeStyle = '#bd9061'; ctx.lineWidth = 8;
      ctx.beginPath(); ctx.moveTo(SLING.x - 3, SLING.y + 43); ctx.lineTo(SLING.x - 22, SLING.y - 4); ctx.stroke();
      ctx.strokeStyle = '#eee0b7'; ctx.lineWidth = 3;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath(); ctx.moveTo(SLING.x - 29, SLING.y + i * 5 - 6);
        ctx.lineTo(SLING.x - 14, SLING.y + i * 5 - 6); ctx.stroke();
      }
    }
  }

  function drawBand(point, front) {
    ctx.strokeStyle = front ? '#7d5549' : '#a16e57'; ctx.lineWidth = front ? 7 : 5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(SLING.x + (front ? -22 : 22), SLING.y - 4);
    ctx.lineTo(point.x, point.y + 9); ctx.stroke();
  }

  function drawTrajectory(point) {
    const vx = (SLING.x - point.x) * POWER;
    const vy = (SLING.y - point.y) * POWER;
    for (let i = 1; i <= 23; i++) {
      const t = i * 0.07, x = point.x + vx * t,
        y = point.y + vy * t + GRAVITY * t * t / 2;
      if (y > GROUND - 15 || x > W - 20) break;
      ctx.fillStyle = `rgba(255,253,244,${0.88 - i * 0.026})`;
      ctx.beginPath(); ctx.arc(x, y, Math.max(2, 4.4 - i * 0.08), 0, Math.PI * 2); ctx.fill();
    }
  }

  function render(time = elapsed) {
    ctx.save();
    drawBackground(time);
    if (shake > 0.3) ctx.translate(Math.sin(elapsed * 80) * shake, Math.cos(elapsed * 71) * shake * 0.5);
    for (const p of trail) {
      ctx.fillStyle = 'rgba(255,250,231,.35)'; ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill();
    }
    for (const b of bodies) drawBody(b, time);
    drawSling(false);
    const hasReadyFrog = ['idle', 'ready', 'dragging'].includes(phase);
    if (hasReadyFrog) {
      const pulled = phase === 'dragging' || (phase === 'ready' && keyboardAiming);
      const p = pulled ? aimedPosition() : SLING;
      if (pulled) drawTrajectory(p);
      drawBand(p, false);
      drawFrog(ctx, p.x, p.y, 63, {
        expression: pulled ? 'squish' : 'angry',
        scaleX: pulled ? 1 + aimPower * 0.32 : 1,
        scaleY: pulled ? 1 - aimPower * 0.22 : 1,
        rotation: pulled ? -aimAngle * 0.2 : Math.sin(time * 3) * 0.025,
      });
      drawBand(p, true);
    } else {
      drawBand(SLING, false);
      if (frog) {
        drawFrog(ctx, frog.x, frog.y, 62, {
          expression: frog.squish > 0 ? 'squish' : 'laugh', rotation: frog.rotation,
          scaleX: frog.squish > 0 ? 1.3 : 1, scaleY: frog.squish > 0 ? 0.74 : 1,
        });
        if (phase === 'flying' && flightTime < 3.6) {
          ctx.font = '800 20px system-ui, sans-serif'; ctx.fillStyle = '#806349';
          ctx.textAlign = 'center'; ctx.fillText('蛙哈哈', frog.x, frog.y - 49);
        }
      }
    }
    drawSling(true);
    for (let i = 0; i < Math.max(0, shots - (hasReadyFrog ? 1 : 0)); i++) {
      drawFrog(ctx, 61 + i * 50, GROUND - 23, 40, { expression: 'smug', rotation: Math.sin(time * 2 + i) * 0.04 });
    }
    for (const p of particles) {
      ctx.save(); ctx.globalAlpha = Math.min(1, p.life * 2); ctx.translate(p.x, p.y); ctx.rotate(p.angle);
      ctx.fillStyle = p.color; ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size); ctx.restore();
    }
    if (phase === 'ready' || phase === 'dragging') {
      ctx.font = '700 13px system-ui, sans-serif'; ctx.fillStyle = '#725d42'; ctx.textAlign = 'left';
      ctx.fillText(`角度 ${Math.round(aimAngle * 180 / Math.PI)}°  ·  力度 ${Math.round(aimPower * 100)}%`, 36, 224);
      ctx.font = '13px system-ui, sans-serif'; ctx.fillStyle = '#857158';
      ctx.fillText(phase === 'dragging' ? '松手！让肚子先飞一会儿' : '← 拉我，肚子已经准备好了', 62, 255);
    }
    if (comboTime > 0) {
      ctx.font = '700 18px system-ui, sans-serif';
      const width = ctx.measureText(combo).width + 38;
      ctx.fillStyle = '#fff8e9'; ctx.strokeStyle = '#d9b792'; ctx.lineWidth = 1.5;
      rounded(W / 2 - width / 2, 82, width, 44, 22); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#79563a'; ctx.textAlign = 'center'; ctx.fillText(combo, W / 2, 110);
    }
    ctx.restore();
  }

  function getState() {
    return { phase, score, shots, level: level + 1, targets: targetCount(),
      aimAngle: Math.round(aimAngle * 180 / Math.PI), aimPower,
      frog: frog ? { x: frog.x, y: frog.y, vx: frog.vx, vy: frog.vy } : null,
      bodies: bodies.filter(b => !b.removed).map(b => ({ x: b.x, y: b.y, w: b.w, h: b.h, target: b.target, hp: b.hp })) };
  }

  loadLevel(0);
  phase = 'idle';
  return { start, update, render, pointerDown, pointerMove, pointerUp, keyDown,
    destroy() { phase = 'ended'; particles = []; trail = []; }, getState };
}
