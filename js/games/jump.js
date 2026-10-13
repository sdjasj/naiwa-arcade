const GRAVITY = 1250;
const CHARGE_SECONDS = 1.25;
const FOOT_OFFSET = 31;
const LANDING_MARGIN = 7;
const COURSE_LENGTH = 30;
const ENDLESS_AHEAD = 7;
const ENDLESS_BEHIND = 2;
const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function makeNextPlatform(previous, index, endless) {
  const heights = [404, 390, 410, 370, 402, 360, 398, 382, 416, 372];
  const gaps = [0, 24, -8, 16, 6];
  // At the endless cap, even the highest platform remains reachable at its center.
  const difficulty = Math.min(endless ? 8 : 5, Math.floor((index - 1) / 5));
  const center = previous.x + previous.width / 2 + 300 + difficulty * 6 + gaps[(index - 1) % gaps.length];
  const width = Math.max(96, 150 - difficulty * 7 + [0, 12, -10, 4, -6][index % 5]);
  return { index, x: center - width / 2, width, top: heights[index % heights.length], style: index % 4 };
}

function makeCourse(endless = false) {
  const platforms = [{ index: 0, x: 97, width: 176, top: 404, style: 0 }];
  const length = endless ? ENDLESS_AHEAD : COURSE_LENGTH;
  for (let index = 1; index <= length; index += 1) {
    platforms.push(makeNextPlatform(platforms[platforms.length - 1], index, endless));
  }
  return platforms;
}

export function createGame(env) {
  const { ctx, drawFrog, audio, onScore, onStatus, onEnd } = env;
  const width = env.width || 960;
  const height = env.height || 560;
  let endless = Boolean(env.endless);
  let platforms = makeCourse(endless);
  let phase = 'idle';
  let score = 0;
  let lives = 3;
  let checkpoint = 0;
  let combo = 0;
  let bestCombo = 0;
  let perfects = 0;
  let charge = 0;
  let chargeSource = null;
  let elapsed = 0;
  let phaseTime = 0;
  let camera = 0;
  let effects = [];
  let flight = null;
  let endSent = false;
  let lastLanding = null;
  let player = { x: 185, y: 404 - FOOT_OFFSET, vx: 0, vy: 0 };

  const centerOf = (platform) => platform.x + platform.width / 2;
  const stage = () => endless ? Math.floor(checkpoint / 5) + 1 : Math.min(6, Math.floor(checkpoint / 5) + 1);
  const hasNext = () => endless || checkpoint < COURSE_LENGTH;
  const platformAt = (index) => platforms[index - platforms[0].index];
  const targetPlatform = () => platformAt(endless ? checkpoint + 1 : Math.min(checkpoint + 1, COURSE_LENGTH));
  const sound = (kind) => audio?.play?.(kind);
  const status = (message) => onStatus?.(message);
  const perfectRadius = (platform) => Math.min(17, platform.width * 0.13);

  function maintainPlatformWindow() {
    if (!endless) return;
    while (platforms[platforms.length - 1].index < checkpoint + ENDLESS_AHEAD) {
      const last = platforms[platforms.length - 1];
      platforms.push(makeNextPlatform(last, last.index + 1, true));
    }
    platforms = platforms.filter((platform) => platform.index >= checkpoint - ENDLESS_BEHIND);
  }

  function velocities(power) {
    return { vx: 120 + 400 * power, vy: -(420 + 130 * power) };
  }

  function descentTime(fromY, velocityY, top) {
    const discriminant = velocityY * velocityY + 2 * GRAVITY * (top - fromY - FOOT_OFFSET);
    return discriminant < 0 ? null : (-velocityY + Math.sqrt(discriminant)) / GRAVITY;
  }

  function targetProjection(power) {
    const target = targetPlatform();
    const velocity = velocities(power);
    const time = descentTime(player.y, velocity.vy, target.top);
    return {
      x: player.x + velocity.vx * (time || 0),
      y: target.top,
      time: time || 0,
      ...velocity,
    };
  }

  function prediction(power = charge) {
    const target = targetPlatform();
    const result = targetProjection(power);
    const success = result.x >= target.x - LANDING_MARGIN && result.x <= target.x + target.width + LANDING_MARGIN;
    return {
      ...result,
      platformIndex: target.index,
      success,
      perfect: success && Math.abs(result.x - centerOf(target)) <= perfectRadius(target),
      direction: success ? 'on-target' : result.x < target.x ? 'short' : 'long',
    };
  }

  function chargeForX(targetX) {
    let low = 0;
    let high = 1;
    for (let iteration = 0; iteration < 18; iteration += 1) {
      const middle = (low + high) / 2;
      if (targetProjection(middle).x < targetX) low = middle;
      else high = middle;
    }
    return (low + high) / 2;
  }

  function placeAtCheckpoint() {
    const platform = platformAt(checkpoint);
    player = { x: centerOf(platform), y: platform.top - FOOT_OFFSET, vx: 0, vy: 0 };
    flight = null;
    charge = 0;
    chargeSource = null;
    phase = 'ready';
    phaseTime = 0;
  }

  function start(options = {}) {
    endless = Boolean(options?.endless ?? endless);
    platforms = makeCourse(endless);
    score = 0;
    lives = 3;
    checkpoint = 0;
    combo = 0;
    bestCombo = 0;
    perfects = 0;
    elapsed = 0;
    camera = 0;
    effects = [];
    endSent = false;
    lastLanding = null;
    placeAtCheckpoint();
    onScore?.(0);
    status(endless
      ? '无限跳一跳 · 3 颗心，平台没有终点！按住蓄力、松手起跳，每落地都是复活点。'
      : '按住屏幕 / 空格蓄力，松手起跳！绿区落稳，瞄准中心有奖励。');
  }

  function beginCharge(source) {
    if (phase !== 'ready') return;
    phase = 'charging';
    phaseTime = 0;
    charge = 0;
    chargeSource = source;
  }

  function cancelInput() {
    if (phase !== 'charging') return;
    phase = 'ready';
    charge = 0;
    chargeSource = null;
    phaseTime = 0;
    status('蓄力已收回，奶蛙站稳了。再次按住就能继续。');
  }

  function launch() {
    if (phase !== 'charging') return;
    const velocity = velocities(charge);
    flight = { x: player.x, y: player.y, ...velocity, time: 0, charge };
    player.vx = velocity.vx;
    player.vy = velocity.vy;
    phase = 'airborne';
    phaseTime = 0;
    chargeSource = null;
    sound('launch');
    status('肚子先飞一会儿——！');
  }

  function finish(won) {
    if (endSent) return;
    endSent = true;
    phase = 'ended';
    chargeSource = null;
    onEnd?.({
      score,
      endless,
      completed: checkpoint,
      stage: stage(),
      lives,
      won: won && !endless,
      title: endless ? `无限 ${checkpoint} 跳，肚子尽力了！` : won ? '三十连跳，奶蛙上天了！' : '肚子有点重，下次一定！',
      message: endless
        ? `无限挑战结束 · 第 ${stage()} 阶段 · 跳过 ${checkpoint} 个平台 · ${perfects} 次完美落点 · 最高 ${bestCombo} 连跳。`
        : won
        ? `六关全部通过！${perfects} 次完美落点 · 最高 ${bestCombo} 连跳 · 剩余 ${lives} 颗心。`
        : `走过 ${checkpoint} / 30 个平台 · ${perfects} 次完美落点。看准绿色蓄力区，再跳一次！`,
    });
  }

  function burst(x, y, label, color = '#688c83') {
    effects.push({ type: 'text', x, y: y - 78, label, color, age: 0, life: 1.1 });
    for (let index = 0; index < 10; index += 1) {
      const angle = index / 10 * TAU;
      effects.push({ type: 'spark', x, y: y - 12, vx: Math.cos(angle) * 90,
        vy: Math.sin(angle) * 100 - 60, color: index % 2 ? '#f6c75f' : '#f3a9b1', age: 0, life: 0.65 });
    }
  }

  function land(platform, landingX) {
    player.x = landingX;
    player.y = platform.top - FOOT_OFFSET;
    player.vx = 0;
    player.vy = 0;
    flight = null;
    charge = 0;
    phaseTime = 0;
    if (platform.index === checkpoint) {
      placeAtCheckpoint();
      status('只挪了一小步！再多蓄一点力，让落点进入绿区。');
      sound('pop');
      return;
    }
    const perfect = Math.abs(landingX - centerOf(platform)) <= perfectRadius(platform);
    checkpoint = platform.index;
    combo += 1;
    bestCombo = Math.max(combo, bestCombo);
    if (perfect) perfects += 1;
    const points = 10 + Math.min(combo - 1, 5) * 2 + (perfect ? 20 : 0);
    score += points;
    lastLanding = { platformIndex: checkpoint, x: landingX, perfect, points };
    onScore?.(score);
    sound(perfect ? 'score' : 'pop');
    burst(landingX, platform.top, perfect ? `完美！ +${points}` : `稳稳落地 +${points}`);
    // Every successful platform is a checkpoint, with a centered starting position.
    maintainPlatformWindow();
    placeAtCheckpoint();
    if (!endless && checkpoint === COURSE_LENGTH) {
      phase = 'cleared';
      phaseTime = 0;
      sound('win');
      status('六关全通！奶蛙宣布：肚子重，也能跳得远！');
    } else if (checkpoint % 5 === 0) {
      sound('win');
      status(endless ? `无限第 ${stage()} 阶段 · 已跳 ${checkpoint} 块！站稳，继续向前。` : `第 ${stage()} / 6 关！平台更远了，但奶蛙更自信了。`);
    } else {
      status(perfect ? `完美落在中心！${combo} 连跳，继续保持。` : `第 ${checkpoint} 个平台拿下！下次试试瞄准中心。`);
    }
  }

  function miss() {
    if (phase !== 'airborne') return;
    phase = 'missed';
    phaseTime = 0;
    lives = Math.max(0, lives - 1);
    combo = 0;
    charge = 0;
    flight = null;
    player.vx = 0;
    player.vy = 0;
    player.y = height - 110;
    sound('hit');
    sound('laugh');
    burst(player.x, player.y, lives ? '噗叽！原地复活～' : '肚子：今天先到这', '#aa7282');
    status(lives ? `没关系！还有 ${lives} 颗心，回到上一个平台继续。` : '三颗心都用完啦。奶蛙笑着说：下次一定！');
  }

  function step(dt) {
    elapsed += dt;
    phaseTime += dt;
    effects = effects.filter((effect) => {
      effect.age += dt;
      return effect.age < effect.life;
    });
    if (phase === 'charging') charge = Math.min(1, charge + dt / CHARGE_SECONDS);
    if (phase === 'airborne' && flight) {
      const oldTime = flight.time;
      const newTime = oldTime + dt;
      let firstLanding = null;
      // Analytic swept collision: a platform cannot be tunneled through at low frame rates.
      for (let index = checkpoint; index <= (hasNext() ? checkpoint + 1 : checkpoint); index += 1) {
        const platform = platformAt(index);
        const time = descentTime(flight.y, flight.vy, platform.top);
        if (time === null || time <= oldTime || time > newTime) continue;
        const x = flight.x + flight.vx * time;
        if (x < platform.x - LANDING_MARGIN || x > platform.x + platform.width + LANDING_MARGIN) continue;
        if (!firstLanding || time < firstLanding.time) firstLanding = { platform, x, time };
      }
      if (firstLanding) {
        land(firstLanding.platform, firstLanding.x);
      } else {
        flight.time = newTime;
        player.x = flight.x + flight.vx * newTime;
        player.y = flight.y + flight.vy * newTime + GRAVITY * newTime ** 2 / 2;
        player.vy = flight.vy + GRAVITY * newTime;
        if (player.y + FOOT_OFFSET > height - 16) miss();
      }
    } else if (phase === 'missed' && phaseTime >= 1) {
      if (lives > 0) {
        placeAtCheckpoint();
        status(`回到第 ${checkpoint} 个平台 · 还剩 ${lives} 颗心。按住蓄力，再来！`);
      } else finish(false);
    } else if (phase === 'cleared' && phaseTime >= 1) {
      finish(true);
    }
    const targetCamera = Math.max(0, player.x - width * 0.235);
    camera += (targetCamera - camera) * (1 - Math.exp(-dt * 7));
  }

  function update(dt) {
    if (!Number.isFinite(dt) || dt <= 0 || phase === 'ended' || phase === 'destroyed') return;
    let remaining = Math.min(dt, 0.25);
    while (remaining > 0.000001) {
      const portion = Math.min(remaining, 1 / 120);
      step(portion);
      remaining -= portion;
      if (phase === 'ended') break;
    }
  }

  function rounded(x, y, w, h, radius, fill, stroke) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radius);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); }
  }

  function text(label, x, y, size = 20, color = '#6e667d', align = 'center', weight = 700) {
    ctx.font = `${weight} ${size}px "PingFang SC", "Microsoft YaHei", sans-serif`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x, y);
  }

  function ellipse(x, y, rx, ry, fill) {
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); ctx.fillStyle = fill; ctx.fill();
  }

  function heart(x, y, filled) {
    ctx.save(); ctx.translate(x, y); ctx.scale(0.8, 0.8);
    ctx.beginPath(); ctx.moveTo(0, 11);
    ctx.bezierCurveTo(-30, -7, -14, -24, 0, -10);
    ctx.bezierCurveTo(14, -24, 30, -7, 0, 11);
    ctx.fillStyle = filled ? '#df8999' : '#dedce6'; ctx.fill(); ctx.restore();
  }

  function cloud(x, y, scale = 1, fill = '#fff9fd') {
    ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
    ellipse(0, 0, 60, 18, fill);
    ellipse(-22, -13, 26, 22, fill);
    ellipse(14, -24, 30, 31, fill);
    ellipse(38, -10, 22, 21, fill);
    ctx.restore();
  }

  function background(time) {
    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, '#f9e6eb'); sky.addColorStop(0.54, '#edf0f5'); sky.addColorStop(1, '#dcebf3');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, width, height);
    ellipse(797 - camera * 0.015 % 1100, 131, 46, 46, '#fff1d5');
    for (let index = 0; index < 6; index += 1) {
      const x = ((index * 249 + 118 - camera * 0.16) % 1230 + 1230) % 1230 - 100;
      cloud(x, 155 + (index % 3) * 61 + Math.sin(time * 0.35 + index) * 5, 0.62 + (index % 2) * 0.23);
    }
    ctx.fillStyle = '#d6e4ef'; ctx.beginPath(); ctx.moveTo(0, height);
    for (let x = 0; x <= width + 20; x += 20) ctx.lineTo(x, 454 + Math.sin((x + camera * 0.08) * 0.009) * 30);
    ctx.lineTo(width, height); ctx.fill();
    text('肚子很重，梦想很轻。', width / 2, 113, 17, '#af94a7', 'center', 500);
  }

  function drawPlatform(platform) {
    const x = platform.x - camera;
    if (x + platform.width < -30 || x > width + 40) return;
    const palette = [
      { side: '#b8d3de', top: '#d9e9ec', rim: '#94b6c8' },
      { side: '#e5baca', top: '#f9dce3', rim: '#c993aa' },
      { side: '#c7c2df', top: '#e6e0ef', rim: '#a9a1c9' },
      { side: '#d7ceac', top: '#f2e9ce', rim: '#bab28c' },
    ][platform.style];
    const bodyHeight = Math.max(80, height - platform.top - 35);
    rounded(x + 5, platform.top + 7, platform.width - 10, bodyHeight, [0, 0, 18, 18], palette.side);
    rounded(x + 15, platform.top + 25, 11, bodyHeight - 40, 6, '#ffffff33');
    rounded(x - 4, platform.top, platform.width + 8, 20, 9, palette.top, palette.rim);
    ctx.strokeStyle = palette.rim; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x + 15, platform.top + 11); ctx.lineTo(x + platform.width - 15, platform.top + 11); ctx.stroke();
    const center = centerOf(platform) - camera;
    const isNext = platform.index === checkpoint + 1;
    if (isNext) {
      rounded(center - perfectRadius(platform), platform.top - 2, perfectRadius(platform) * 2, 7, 3, '#eabd58');
      text('下一个', center, platform.top + 53, 18, '#76677f');
      text(`第 ${platform.index} 跳`, center, platform.top + 78, 15, '#917d93', 'center', 500);
    } else {
      text(platform.index === 0 ? '起点' : !endless && platform.index === COURSE_LENGTH ? '终点' : String(platform.index), center, platform.top + 55, 19, '#887b91');
    }
    if (platform.index > 0 && platform.index % 5 === 0) {
      const poleX = x + platform.width - 16;
      ctx.strokeStyle = '#af8c99'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(poleX, platform.top); ctx.lineTo(poleX, platform.top - 48); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(poleX, platform.top - 48); ctx.lineTo(poleX + 29, platform.top - 36); ctx.lineTo(poleX, platform.top - 24);
      ctx.fillStyle = '#e6a0af'; ctx.fill();
    }
  }

  function drawPreview() {
    if (phase !== 'charging') return;
    const preview = prediction();
    const end = preview.time;
    for (let index = 1; index <= 18; index += 1) {
      const t = end * index / 18;
      const x = player.x + preview.vx * t - camera;
      const y = player.y + preview.vy * t + GRAVITY * t * t / 2;
      ellipse(x, y, 3.3, 3.3, preview.success ? '#92b5a6' : '#c7a6b8');
    }
    const x = preview.x - camera;
    const color = preview.perfect ? '#6eab8c' : preview.success ? '#87acaa' : '#cb8e9e';
    ellipse(x, preview.y - 2, 17, 5, '#fffdfb');
    ctx.strokeStyle = color; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x - 10, preview.y - 13); ctx.lineTo(x, preview.y - 4); ctx.lineTo(x + 10, preview.y - 13); ctx.stroke();
    text(preview.perfect ? '完美落点！' : preview.success ? '能落稳！' : preview.direction === 'short' ? '再蓄一点' : '有点远了', x, preview.y - 32, 17, color);
  }

  function drawHud() {
    rounded(24, 18, 912, 67, 18, '#fffcf7d9');
    text(endless ? '奶蛙跳一跳 · 无限' : '奶蛙跳一跳', 45, 43, 23, '#79627b', 'left');
    text(endless ? `已跳 ${checkpoint} 个平台 · 没有终点` : `已跳 ${checkpoint} / ${COURSE_LENGTH} 个平台`, 45, 68, 14, '#ab91a3', 'left', 500);
    text(endless ? `第 ${stage()} 阶段` : `第 ${stage()} / 6 关`, width / 2, 41, 22, '#857398');
    text(combo > 1 ? `${combo} 连跳 · 中心额外 +20` : '按住蓄力 · 松手起跳', width / 2, 65, 14, '#a18b9f', 'center', 500);
    text(`${score} 分`, width - 166, 45, 22, '#8e758d', 'right');
    for (let index = 0; index < 3; index += 1) heart(width - 128 + index * 36, 44, index < lives);
    text(`剩余 ${lives} 次机会`, width - 82, 69, 13, '#ac8ea0', 'center', 500);

    rounded(24, height - 73, 912, 55, 18, '#fffcf7ed', '#eadbe5');
    text(phase === 'charging' ? `蓄力 ${Math.round(charge * 100)}%` : phase === 'airborne' ? '蛙在空中！' : phase === 'missed' ? '肚皮缓冲中…' : '按住屏幕 / 空格', 49, height - 46, 19, '#8f728b', 'left');
    const meterX = 275;
    const meterWidth = 400;
    const meterY = height - 53;
    rounded(meterX, meterY, meterWidth, 16, 8, '#ede2ec');
    if (hasNext() && (phase === 'ready' || phase === 'charging' || phase === 'idle')) {
      const target = targetPlatform();
      const min = chargeForX(target.x + 8);
      const max = chargeForX(target.x + target.width - 8);
      rounded(meterX + min * meterWidth, meterY, Math.max(2, (max - min) * meterWidth), 16, 6, '#c4decf');
      const center = chargeForX(centerOf(target));
      rounded(meterX + center * meterWidth - 3, meterY - 3, 6, 22, 3, '#81ad97');
    }
    if (charge > 0 && phase !== 'missed') {
      rounded(meterX, meterY + 5, charge * meterWidth, 6, 3, '#ce9bad');
      ellipse(meterX + charge * meterWidth, meterY + 8, 7, 11, '#b57895');
    }
    text(phase === 'charging' ? '落点进绿区就松手' : '绿区能落稳 · 中心有奖励', 905, height - 46, 16, '#9b8298', 'right', 500);
  }

  function drawEffects() {
    for (const effect of effects) {
      const ratio = effect.age / effect.life;
      ctx.save(); ctx.globalAlpha = Math.min(1, (1 - ratio) * 2);
      if (effect.type === 'text') {
        text(effect.label, effect.x - camera, effect.y - ratio * 30, 26, effect.color);
      } else {
        const x = effect.x + effect.vx * effect.age - camera;
        const y = effect.y + effect.vy * effect.age + 130 * effect.age ** 2;
        ctx.translate(x, y); ctx.rotate(ratio * 4);
        rounded(-4, -4, 8, 8, 2, effect.color);
      }
      ctx.restore();
    }
  }

  function render(time = elapsed) {
    ctx.save();
    background(time);
    for (const platform of platforms) drawPlatform(platform);
    drawPreview();
    const missed = phase === 'missed';
    const charging = phase === 'charging';
    const inAir = phase === 'airborne';
    const y = player.y + (charging ? charge * 10 : phase === 'idle' ? Math.sin(time * 2.2) * 3 : 0);
    if (!inAir && !missed) ellipse(player.x - camera, player.y + FOOT_OFFSET - 3, 27 + charge * 5, 5, '#846d9130');
    drawFrog(ctx, player.x - camera, y, 60, {
      expression: missed ? (phaseTime < 0.35 ? 'squish' : 'laugh') : charging ? 'squish' : phase === 'cleared' ? 'laugh' : inAir ? 'happy' : 'smug',
      scaleX: missed ? 1.32 : 1 + (charging ? charge * 0.22 : 0),
      scaleY: missed ? 0.55 : 1 - (charging ? charge * 0.26 : 0),
      rotation: missed ? Math.sin(phaseTime * 24) * 0.05 : inAir ? clamp(player.vy / 3500, -0.14, 0.18) : 0,
    });
    drawEffects();
    drawHud();
    ctx.restore();
  }

  function isSpace(event) {
    return event.code === 'Space' || event.key === ' ' || event.key === 'Spacebar';
  }

  return {
    start,
    update,
    render,
    pointerDown() { beginCharge('pointer'); },
    pointerMove() {},
    pointerUp(point) {
      if (point?.cancelled) cancelInput();
      else if (chargeSource === 'pointer') launch();
    },
    keyDown(event) {
      if (!isSpace(event)) return false;
      event.preventDefault?.();
      if (!event.repeat) beginCharge('keyboard');
      return true;
    },
    keyUp(event) {
      if (!isSpace(event)) return false;
      event.preventDefault?.();
      if (chargeSource === 'keyboard') launch();
      return true;
    },
    cancelInput,
    destroy() {
      phase = 'destroyed'; chargeSource = null; flight = null; effects = [];
    },
    getState() {
      return {
        phase, score, lives, combo, bestCombo, perfects, checkpoint,
        completed: checkpoint, totalPlatforms: endless ? null : COURSE_LENGTH, stage: stage(), endless,
        nextPlatform: hasNext() ? checkpoint + 1 : null,
        platformWindowStart: platforms[0].index,
        charge, chargeSource, chargeSeconds: CHARGE_SECONDS, camera,
        player: { ...player, footOffset: FOOT_OFFSET },
        platforms: platforms.map((platform) => ({ ...platform, center: centerOf(platform) })),
        landingPreview: hasNext() && ['idle', 'ready', 'charging'].includes(phase) ? prediction() : null,
        lastLanding: lastLanding ? { ...lastLanding } : null,
      };
    },
  };
}
