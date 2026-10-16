const TAU = Math.PI * 2;
const SESSION_SECONDS = 60;
const COUNTDOWN_SECONDS = 3;
const SHOT_INTERVAL = 0.08;
const TRACK_POINTS_PER_SECOND = 120;
const LOOK_RADIANS = 0.0018;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const DRILLS = ['grid', 'precision', 'track'];
const INPUTS = ['fps', 'cursor'];
const DIFFICULTIES = ['easy', 'normal', 'hard'];
const DRILL_NAMES = { grid: '三球速点', precision: '精准甩枪', track: '跟枪追踪' };
const DIFFICULTY = {
  easy: { grid: 0.49, precision: 0.28, track: 0.52, speed: 0.68 },
  normal: { grid: 0.37, precision: 0.20, track: 0.38, speed: 1 },
  hard: { grid: 0.27, precision: 0.145, track: 0.27, speed: 1.34 },
};
const GRID = Array.from({ length: 15 }, (_, index) => ({
  x: (index % 5 - 2) * 1.3, y: (Math.floor(index / 5) - 1) * 1.25, z: 11.8,
}));

export function createGame(env) {
  const { ctx, width = 960, height = 560, drawFrog, audio, onScore, onStatus, onEnd } = env;
  const focal = height * 1.18;
  const fov = 2 * Math.atan(height / (2 * focal));
  const center = { x: width / 2, y: height / 2 };
  let aimDrill = DRILLS.includes(env.aimDrill) ? env.aimDrill : 'grid';
  let aimInput = INPUTS.includes(env.aimInput) ? env.aimInput : 'cursor';
  let difficulty = DIFFICULTIES.includes(env.difficulty) ? env.difficulty : 'normal';
  let endless = env.endless === true;
  let sensitivity = Number.isFinite(env.sensitivity) ? clamp(env.sensitivity, 0.2, 3) : 1;
  let phase = 'idle', destroyed = false, endSent = false;
  let elapsed = 0, countdown = COUNTDOWN_SECONDS, score = 0;
  let view = { yaw: 0, pitch: 0 };
  let crosshair = { ...center };
  let targets = [], particles = [], rings = [];
  let nextId = 1, sequence = 0, lastShot = -Infinity, lastHitAt = 0;
  let firing = false, triggerHit = false;
  let shots = 0, hits = 0, misses = 0, combo = 0, bestCombo = 0;
  let reactionTotal = 0, trackingHitTime = 0, trackingFireTime = 0;
  let trackingStreak = 0, bestTrackingStreak = 0;
  let lastLaugh = -Infinity, lastTrackSound = -Infinity, hitFlash = 0;

  const sound = name => audio?.play?.(name);
  const status = text => onStatus?.(text);
  const settings = () => DIFFICULTY[difficulty];
  const accuracy = () => aimDrill === 'track'
    ? (trackingFireTime > 0 ? 100 * trackingHitTime / trackingFireTime : 0)
    : (shots > 0 ? 100 * hits / shots : 0);
  const averageReaction = () => aimDrill !== 'track' && hits ? reactionTotal * 1000 / hits : 0;

  // Camera looks along +Z. Positive yaw turns right; positive pitch looks up.
  // World targets never change position when the camera turns.
  function cameraPoint(point) {
    const cy = Math.cos(view.yaw), sy = Math.sin(view.yaw);
    const cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
    const forward = point.x * sy + point.z * cy;
    return { x: point.x * cy - point.z * sy, y: point.y * cp - forward * sp, z: point.y * sp + forward * cp };
  }
  function project(point, radius = 0) {
    const p = cameraPoint(point);
    if (p.z <= 0.1) return { x: center.x, y: center.y, r: 0, visible: false, depth: p.z };
    const x = center.x + focal * p.x / p.z, y = center.y - focal * p.y / p.z;
    const r = focal * radius / Math.sqrt(Math.max(0.01, p.z * p.z - radius * radius));
    return { x, y, r, visible: x + r >= 0 && x - r <= width && y + r >= 0 && y - r <= height, depth: p.z };
  }
  function rayDirection() {
    const cp = Math.cos(view.pitch);
    return { x: Math.sin(view.yaw) * cp, y: Math.sin(view.pitch), z: Math.cos(view.yaw) * cp };
  }
  function targetUnderAim() {
    const ray = aimInput === 'fps' ? rayDirection() : null;
    let picked = null, nearest = Infinity;
    for (const target of targets) {
      const p = project(target, target.r);
      if (!p.visible) continue;
      let distance;
      if (ray) {
        const along = target.x * ray.x + target.y * ray.y + target.z * ray.z;
        const perpendicularSq = target.x ** 2 + target.y ** 2 + target.z ** 2 - along * along;
        if (along <= 0 || perpendicularSq > target.r ** 2) continue;
        distance = along - Math.sqrt(Math.max(0, target.r ** 2 - perpendicularSq));
      } else {
        if ((crosshair.x - p.x) ** 2 + (crosshair.y - p.y) ** 2 > p.r ** 2) continue;
        distance = p.depth;
      }
      if (distance < nearest) { nearest = distance; picked = target; }
    }
    return picked;
  }
  function makeTarget(position, extra = {}) {
    return { id: nextId++, ...position, r: settings()[aimDrill], bornAt: elapsed, ...extra };
  }
  function replaceGrid(oldTarget) {
    const occupied = new Set(targets.filter(target => target !== oldTarget).map(target => target.slot));
    const choices = GRID.map((_, slot) => slot).filter(slot => !occupied.has(slot) && slot !== oldTarget?.slot);
    const slot = choices[Math.floor(Math.random() * choices.length)];
    return makeTarget(GRID[slot], { slot });
  }
  function makePrecision() {
    const z = [9.5, 16.8, 12.6][sequence++ % 3];
    const previous = targets[0];
    let x = (Math.random() * 2 - 1) * 2.35;
    const y = (Math.random() * 2 - 1) * 0.95;
    // A fresh target must require a visible acquisition, even with repeated RNG.
    if (previous && Math.abs(x / z - previous.x / previous.z) < 0.07) x = previous.x >= 0 ? -1.9 : 1.9;
    return makeTarget({ x, y, z }, { gold: sequence % 2 === 1 });
  }
  function moveTrackingTarget(time) {
    const target = targets[0];
    if (!target) return;
    const t = time * settings().speed;
    target.x = 2.4 * Math.sin(t * 1.13 + 0.38);
    target.y = 0.95 * Math.sin(t * 1.67 + 0.7);
    target.z = 12.1 + 1.15 * Math.sin(t * 0.51);
  }
  function resetTargets() {
    nextId = 1; sequence = 0;
    if (aimDrill === 'grid') targets = [6, 8, 12].map(slot => makeTarget(GRID[slot], { slot }));
    else if (aimDrill === 'precision') { targets = []; targets = [makePrecision()]; }
    else { targets = [makeTarget({ x: 0, y: 0, z: 12.1 })]; moveTrackingTarget(0); }
  }
  function setSensitivity(value) {
    if (Number.isFinite(value)) sensitivity = clamp(value, 0.2, 3);
    return sensitivity;
  }
  function cancelInput() {
    if (firing && aimDrill === 'track' && !triggerHit) misses++;
    firing = false; triggerHit = false; trackingStreak = 0;
  }
  function start(options = {}) {
    if (destroyed) return false;
    if (DRILLS.includes(options.aimDrill)) aimDrill = options.aimDrill;
    if (INPUTS.includes(options.aimInput)) aimInput = options.aimInput;
    if (DIFFICULTIES.includes(options.difficulty)) difficulty = options.difficulty;
    if (options.endless !== undefined) endless = options.endless === true;
    if (options.sensitivity !== undefined) setSensitivity(options.sensitivity);
    phase = 'countdown'; endSent = false;
    elapsed = 0; countdown = COUNTDOWN_SECONDS; score = 0;
    view = { yaw: 0, pitch: 0 }; crosshair = { ...center };
    particles = []; rings = [];
    firing = false; triggerHit = false;
    shots = 0; hits = 0; misses = 0; combo = 0; bestCombo = 0;
    reactionTotal = 0; trackingHitTime = 0; trackingFireTime = 0;
    trackingStreak = 0; bestTrackingStreak = 0;
    lastShot = -Infinity; lastHitAt = 0; lastLaugh = -Infinity; lastTrackSound = -Infinity; hitFlash = 0;
    resetTargets(); onScore?.(0);
    status(`${DRILL_NAMES[aimDrill]} · 准备 3 秒，${endless ? '无限训练，可随时结算' : '正式训练 60 秒'}。`);
    return true;
  }
  function addScore(value) {
    const next = Math.min(2 ** 40 - 1, value);
    if (next !== score) { score = next; onScore?.(score); }
  }
  function burst(target) {
    const p = project(target, target.r);
    rings.push({ x: p.x, y: p.y, r: p.r, age: 0, gold: target.gold });
    if (rings.length > 8) rings.shift();
    for (let i = 0; i < 7; i++) {
      const angle = i * TAU / 7;
      particles.push({ x: p.x, y: p.y, vx: Math.cos(angle) * 52, vy: Math.sin(angle) * 52, age: 0, gold: target.gold });
    }
    if (particles.length > 96) particles.splice(0, particles.length - 96);
  }
  function shoot() {
    if (elapsed - lastShot < SHOT_INTERVAL - 1e-9) return;
    lastShot = elapsed; shots++;
    const target = targetUnderAim();
    if (!target) { misses++; combo = 0; sound('miss'); return; }
    hits++; combo++; bestCombo = Math.max(bestCombo, combo); hitFlash = 0.12;
    // Grid measures time since the previous successful switch, not the age of
    // whichever of the three static targets the player happened to choose.
    reactionTotal += elapsed - (aimDrill === 'grid' ? lastHitAt : target.bornAt);
    lastHitAt = elapsed;
    addScore(score + (aimDrill === 'precision' ? 150 : 100) + Math.min(50, Math.floor(combo / 5) * 10));
    burst(target); sound('pop');
    if (combo % 5 === 0 && elapsed - lastLaugh >= 2.5) {
      sound('laugh:combo'); lastLaugh = elapsed;
    }
    if (aimDrill === 'grid') targets[targets.indexOf(target)] = replaceGrid(target);
    else targets = [makePrecision()];
  }
  function pointerMove(point) {
    if (destroyed || aimInput !== 'cursor' || !Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return;
    crosshair = { x: point.x, y: point.y };
  }
  function pointerDown(point) {
    if (point?.cancelled) { cancelInput(); return; }
    pointerMove(point);
    if (phase !== 'playing' || destroyed || firing) return;
    firing = true; triggerHit = false;
    if (aimDrill === 'track') shots++;
    else shoot();
  }
  function pointerUp(point) {
    if (!point?.cancelled) pointerMove(point);
    cancelInput();
  }
  function look(dx, dy) {
    if (destroyed || aimInput !== 'fps' || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
    view.yaw = clamp(view.yaw + dx * LOOK_RADIANS * sensitivity, -0.32, 0.32);
    view.pitch = clamp(view.pitch - dy * LOOK_RADIANS * sensitivity, -0.15, 0.15);
  }
  function statistics() {
    return { shots, hits, misses, accuracy: accuracy(), averageReactionMs: averageReaction(),
      trackingHitTime, trackingFireTime, elapsed, bestCombo, bestTrackingStreak };
  }
  function finish() {
    if (destroyed || endSent || !['countdown', 'playing'].includes(phase)) return false;
    cancelInput(); phase = 'ended'; endSent = true;
    const time = elapsed.toFixed(1), percent = accuracy().toFixed(1);
    const message = aimDrill === 'track'
      ? `${time} 秒 · 跟枪覆盖 ${percent}% · 命中 ${trackingHitTime.toFixed(1)} / 开火 ${trackingFireTime.toFixed(1)} 秒 · 最长跟住 ${bestTrackingStreak.toFixed(1)} 秒。奶蛙说：别松手，它还想笑。`
      : `${time} 秒 · 命中 ${hits} / ${shots} · 准确率 ${percent}% · 平均${aimDrill === 'grid' ? '切换' : '反应'} ${Math.round(averageReaction())} ms · 最高 ${bestCombo} 连击。奶蛙：这下真笑到点上了。`;
    sound('win'); sound('laugh:victory'); status('训练已结算，再来一局看看手感。');
    onEnd?.({ score, won: true, title: endless ? '无限训练，收工！' : '今日手感，已存档。', message, stats: statistics() });
    return true;
  }
  function updateEffects(dt) {
    hitFlash = Math.max(0, hitFlash - dt);
    for (const p of particles) { p.age += dt; p.x += p.vx * dt; p.y += p.vy * dt; }
    particles = particles.filter(p => p.age < 0.42);
    for (const ring of rings) ring.age += dt;
    rings = rings.filter(ring => ring.age < 0.32);
  }
  function updateTracking(dt) {
    // Integrate motion and hit coverage at 120 Hz even when the host gives a
    // slower frame. All points derive from accumulated hit seconds, not FPS.
    let remaining = dt;
    while (remaining > 1e-10) {
      const step = Math.min(remaining, 1 / 120);
      moveTrackingTarget(elapsed + step / 2);
      if (firing) {
        trackingFireTime += step;
        if (targetUnderAim()) {
          trackingHitTime += step; trackingStreak += step;
          bestTrackingStreak = Math.max(bestTrackingStreak, trackingStreak);
          if (!triggerHit) { hits++; triggerHit = true; }
          hitFlash = 0.06;
          if (elapsed - lastTrackSound > 0.7) { sound('pop'); lastTrackSound = elapsed; }
          if (trackingStreak >= 2 && elapsed - lastLaugh > 5) { sound('laugh:combo'); lastLaugh = elapsed; }
        } else trackingStreak = 0;
      }
      elapsed += step; remaining -= step;
    }
    moveTrackingTarget(elapsed);
    addScore(Math.floor(trackingHitTime * TRACK_POINTS_PER_SECOND + 1e-7));
  }
  function update(dt) {
    if (destroyed || !Number.isFinite(dt) || dt <= 0 || !['countdown', 'playing'].includes(phase)) return;
    if (phase === 'countdown') {
      const used = Math.min(countdown, dt); countdown -= used; dt -= used;
      if (countdown > 1e-9) return;
      countdown = 0; phase = 'playing';
      // Holding during the ready overlay never turns into an unintentional shot.
      firing = false; triggerHit = false;
      status(`${DRILL_NAMES[aimDrill]} · ${aimDrill === 'track' ? '按住开火，让准星留在球上。' : '瞄准后单击，空枪会打断连击。'}`);
      sound('launch');
    }
    if (dt <= 0) return;
    const step = endless ? dt : Math.min(dt, Math.max(0, SESSION_SECONDS - elapsed));
    updateEffects(step);
    if (aimDrill === 'track') updateTracking(step);
    else elapsed += step;
    if (!endless && elapsed >= SESSION_SECONDS - 1e-8) { elapsed = SESSION_SECONDS; finish(); }
  }
  function line3D(a, b, color, lineWidth = 1) {
    const first = project(a), second = project(b);
    if (first.depth <= 0 || second.depth <= 0) return;
    ctx.strokeStyle = color; ctx.lineWidth = lineWidth;
    ctx.beginPath(); ctx.moveTo(first.x, first.y); ctx.lineTo(second.x, second.y); ctx.stroke();
  }
  function renderRoom() {
    const background = ctx.createLinearGradient(0, 0, 0, height);
    background.addColorStop(0, '#111e27'); background.addColorStop(1, '#071217');
    ctx.fillStyle = background; ctx.fillRect(0, 0, width, height);
    const color = '#24404a';
    for (const z of [7, 10, 14, 20, 28]) line3D({ x: -9, y: -3, z }, { x: 9, y: -3, z }, color);
    for (let x = -9; x <= 9; x += 1.5) line3D({ x, y: -3, z: 5 }, { x, y: -3, z: 28 }, color);
    for (const x of [-7, 0, 7]) line3D({ x, y: -3, z: 20 }, { x, y: 4, z: 20 }, '#203740');
    line3D({ x: -7, y: 4, z: 20 }, { x: 7, y: 4, z: 20 }, '#355963');
    line3D({ x: -7, y: -3, z: 20 }, { x: 7, y: -3, z: 20 }, '#3c7779', 2);
    for (const x of [-5.6, 5.6]) line3D({ x, y: -2.5, z: 19.8 }, { x, y: 2.8, z: 19.8 }, '#3d7e7d', 3);
    ctx.fillStyle = '#4a6770'; ctx.textAlign = 'center'; ctx.font = '11px system-ui, sans-serif';
    ctx.fillText('NAIWA / AIM TRAINING', width / 2, height - 73);
    // The mascot stays below the shooting lane and is never a scoring target.
    drawFrog?.(ctx, width - 82, height - 112, 34, { expression: hitFlash ? 'laugh' : 'smug',
      animation: hitFlash ? 'laugh' : 'idle', animationTime: elapsed, scaleX: -1 });
    ctx.fillStyle = '#87a5a5'; ctx.font = '11px system-ui, sans-serif';
    ctx.fillText('我只负责笑。', width - 84, height - 60);
  }
  function renderTarget(target, hovered) {
    const p = project(target, target.r);
    if (!p.visible) return;
    const gold = target.gold || (aimDrill === 'grid' && target.id % 3 === 0);
    const light = gold ? '#fff1b2' : '#bdffdc', mid = gold ? '#ead36e' : '#64d9b6', dark = gold ? '#8d7043' : '#237e77';
    ctx.save();
    ctx.shadowColor = gold ? '#edda7160' : '#51dcad55'; ctx.shadowBlur = hovered ? 24 : 13;
    const gradient = ctx.createRadialGradient(p.x - p.r * 0.32, p.y - p.r * 0.38, p.r * 0.08, p.x, p.y, p.r);
    gradient.addColorStop(0, light); gradient.addColorStop(0.56, mid); gradient.addColorStop(1, dark);
    ctx.fillStyle = gradient; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
    ctx.shadowBlur = 0; ctx.strokeStyle = hovered ? '#f5fff4' : '#c2f5df88'; ctx.lineWidth = hovered ? 2 : 1;
    ctx.stroke();
    ctx.globalAlpha = 0.4; ctx.strokeStyle = '#efffef'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 0.45, 0, TAU); ctx.stroke();
    ctx.restore();
  }
  function renderHUD() {
    ctx.fillStyle = '#0a151de8'; ctx.fillRect(0, 0, width, 87);
    ctx.strokeStyle = '#29434b'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(24, 86); ctx.lineTo(width - 24, 86); ctx.stroke();
    ctx.textAlign = 'left'; ctx.fillStyle = '#85b7b3'; ctx.font = '10px system-ui, sans-serif';
    ctx.fillText('NAIWA AIM / 奶蛙瞄准室', 28, 24);
    ctx.fillStyle = '#f0f5e9'; ctx.font = 'bold 19px system-ui, sans-serif';
    ctx.fillText(DRILL_NAMES[aimDrill], 28, 53);
    ctx.fillStyle = '#7c9c9e'; ctx.font = '11px system-ui, sans-serif';
    ctx.fillText(`${aimInput === 'fps' ? '第一人称' : '光标直瞄'} · ${{ easy: '轻松', normal: '标准', hard: '挑战' }[difficulty]}`, 28, 73);
    const metrics = [
      [endless ? '已训练' : '剩余时间', `${(endless ? elapsed : Math.max(0, SESSION_SECONDS - elapsed)).toFixed(1)}s`],
      ['得分', String(score)],
      [aimDrill === 'track' ? '跟枪覆盖' : '准确率', `${accuracy().toFixed(1)}%`],
      [aimDrill === 'track' ? '最长跟住' : '当前连击', aimDrill === 'track' ? `${bestTrackingStreak.toFixed(1)}s` : `${combo}×`],
    ];
    metrics.forEach(([label, value], index) => {
      const x = width * (0.35 + index * 0.19);
      ctx.textAlign = 'center'; ctx.fillStyle = '#8da9a9'; ctx.font = '11px system-ui, sans-serif'; ctx.fillText(label, x, 27);
      ctx.fillStyle = index === 1 ? '#f1e6ab' : '#e2f5ee'; ctx.font = 'bold 24px system-ui, sans-serif'; ctx.fillText(value, x, 59);
    });
    ctx.fillStyle = '#08151be8'; ctx.fillRect(0, height - 43, width, 43);
    ctx.textAlign = 'left'; ctx.fillStyle = '#99b8b4'; ctx.font = '12px system-ui, sans-serif';
    const detail = aimDrill === 'track'
      ? `命中 ${trackingHitTime.toFixed(1)}s / 开火 ${trackingFireTime.toFixed(1)}s · 按住左键持续跟枪`
      : `命中 ${hits} / ${shots} · 平均${aimDrill === 'grid' ? '切换' : '反应'} ${hits ? Math.round(averageReaction()) : '—'} ms`;
    ctx.fillText(detail, 28, height - 17);
    ctx.textAlign = 'right'; ctx.fillStyle = '#6d9293';
    ctx.fillText(endless ? '∞ 自由训练 · 可随时结算' : '60 秒 · 稳一点，再快一点', width - 28, height - 17);
  }
  function render() {
    if (destroyed || !ctx) return;
    ctx.save(); renderRoom();
    const hovered = targetUnderAim();
    for (const target of [...targets].sort((a, b) => b.z - a.z)) renderTarget(target, target === hovered);
    for (const ring of rings) {
      ctx.strokeStyle = ring.gold ? '#f7e5a9' : '#89ebcb'; ctx.globalAlpha = Math.max(0, 1 - ring.age / 0.32);
      ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(ring.x, ring.y, ring.r + ring.age * 70, 0, TAU); ctx.stroke();
    }
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, 1 - p.age / 0.42); ctx.fillStyle = p.gold ? '#f7e5a9' : '#a5efcf'; ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
    }
    ctx.globalAlpha = 1;
    const aim = aimInput === 'fps' ? center : crosshair;
    ctx.strokeStyle = hitFlash > 0 ? '#f9edaf' : '#e4f6ed'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      ctx.moveTo(aim.x + dx * 5, aim.y + dy * 5); ctx.lineTo(aim.x + dx * 12, aim.y + dy * 12);
    }
    ctx.stroke(); ctx.fillStyle = '#f6ffed'; ctx.beginPath(); ctx.arc(aim.x, aim.y, 1.5, 0, TAU); ctx.fill();
    renderHUD();
    if (phase === 'countdown') {
      ctx.fillStyle = '#07141ac9'; ctx.fillRect(width / 2 - 100, height / 2 - 82, 200, 164);
      ctx.textAlign = 'center'; ctx.fillStyle = '#e9e8b1'; ctx.font = 'bold 64px system-ui, sans-serif'; ctx.fillText(String(Math.max(1, Math.ceil(countdown))), width / 2, height / 2 + 13);
      ctx.fillStyle = '#a0c5bd'; ctx.font = '13px system-ui, sans-serif'; ctx.fillText('先找准星，手感马上到。', width / 2, height / 2 + 49);
    }
    ctx.restore();
  }
  function getState() {
    return { phase, score, elapsed, countdown, remaining: endless ? null : Math.max(0, SESSION_SECONDS - elapsed),
      aimDrill, aimInput, difficulty, endless, firing, combo, sensitivity,
      targets: targets.map(target => ({ ...target, world: { x: target.x, y: target.y, z: target.z, r: target.r }, screen: project(target, target.r) })),
      crosshair: { ...(aimInput === 'fps' ? center : crosshair) }, view: { ...view, fov, sensitivity },
      stats: statistics(), particles: particles.length, rings: rings.length };
  }
  function destroy() { cancelInput(); destroyed = true; phase = 'idle'; targets = []; particles = []; rings = []; }
  resetTargets();
  return { start, update, render, pointerDown, pointerMove, pointerUp, look, cancelInput, finish, destroy, getState, setSensitivity };
}
