const TAU = Math.PI * 2;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const TOTAL_WAVES = 8;

export function createGame(env) {
  const { ctx, width = 960, height = 560, drawFrog, audio, onScore, onStatus, onEnd } = env;
  const floorY = height - 34;
  const basketY = height - 92;
  const basketWidth = 160;
  const moveSpeed = 790;
  let phase = 'idle';
  let endless = env.endless === true;
  let basketX = width / 2;
  let lives = 3;
  let score = 0;
  let wave = 1;
  let waveSpawned = 0;
  let waveResolved = 0;
  let spawnTimer = 0.65;
  let elapsed = 0;
  let phaseTime = 0;
  let objects = [];
  let particles = [];
  let labels = [];
  let ghosts = [];
  let caughtFrog = null;
  let combo = 0;
  let bestCombo = 0;
  let caught = 0;
  let missed = 0;
  let bombsHit = 0;
  let bombsDodged = 0;
  let nextId = 1;
  let previousX = width / 2;
  let previousKind = 'frog';
  let shake = 0;
  let won = false;
  let endSent = false;
  const held = { left: false, right: false };

  const waveCount = () => Math.min(18, 5 + wave);
  const interval = () => Math.max(0.76, 1.3 - (wave - 1) * 0.076);
  const fallSpeed = () => Math.min(340, 137 + (wave - 1) * 17);
  const driftLimit = () => Math.min(28, 14 + wave);
  const sound = kind => audio?.play?.(kind);
  const status = message => onStatus?.(message);

  function cancelInput() {
    held.left = false;
    held.right = false;
  }

  function start(options = {}) {
    if (options?.endless !== undefined) endless = options.endless === true;
    phase = 'playing';
    basketX = width / 2;
    lives = 3;
    score = 0;
    wave = 1;
    waveSpawned = 0;
    waveResolved = 0;
    spawnTimer = 0.65;
    elapsed = 0;
    phaseTime = 0;
    objects = [];
    particles = [];
    labels = [];
    ghosts = [];
    caughtFrog = null;
    combo = 0;
    bestCombo = 0;
    caught = 0;
    missed = 0;
    bombsHit = 0;
    bombsDodged = 0;
    nextId = 1;
    previousX = width / 2;
    previousKind = 'frog';
    shake = 0;
    won = false;
    endSent = false;
    cancelInput();
    onScore?.(0);
    status(`${endless ? '无限模式 · 第 1 波' : '第 1 / 8 波'} · 移动篮子接奶蛙，漏接会扣 1 颗心。`);
  }

  function spawn() {
    const index = waveSpawned;
    const kind = wave >= 2 && (index === 2 || (wave >= 5 && index === 6))
      ? 'bomb' : wave >= 2 && index === waveCount() - 2 ? 'gold' : 'frog';
    // Every item in a wave has the same vertical speed. Consecutive arrival
    // times stay separated, and required horizontal travel fits keyboard speed.
    const maximumTravel = Math.min(270, moveSpeed * interval() * 0.46);
    let x;
    if (wave === 1 && index === 0) x = width / 2;
    else if (previousKind === 'bomb') {
      const direction = previousX > width / 2 ? -1 : 1;
      x = previousX + direction * (205 + Math.random() * 45);
    } else {
      x = previousX + (Math.random() * 2 - 1) * maximumTravel;
    }
    x = clamp(x, 105, width - 105);
    const item = {
      id: nextId++, kind, x, baseX: x, y: -67,
      speed: fallSpeed(), checked: false,
      spin: (Math.random() * 2 - 1) * 0.15,
      drift: wave >= 4 && kind !== 'bomb' ? driftLimit() : 0,
      age: 0,
    };
    objects.push(item);
    previousX = x;
    previousKind = kind;
    waveSpawned += 1;
    if (kind === 'bomb' && wave === 2) status('黑色炸弹别接！让它从篮子旁边掉下去。');
  }

  function burst(x, y, color, count = 10) {
    for (let i = 0; i < count; i += 1) {
      const angle = i * TAU / count;
      const speed = 45 + Math.random() * 105;
      particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 55, age: 0, life: 0.65, color, size: 3 + Math.random() * 4 });
    }
  }

  function label(text, x, y, color = '#385d45') {
    labels.push({ text, x, y, color, age: 0, life: 0.9 });
  }

  function finish(success) {
    if (phase === 'ending' || phase === 'ended') return;
    phase = 'ending';
    phaseTime = 0;
    won = success;
    cancelInput();
    if (success) {
      const bonus = 200 + lives * 50;
      score += bonus;
      onScore?.(score);
      label(`八波全接完！+${bonus}`, width / 2, 230, '#987026');
      sound('win');
      status('八波挑战完成！奶蛙快递，今日全部送达。');
    } else {
      sound('laugh');
      status('篮子下班了，奶蛙还在笑。');
    }
  }

  function loseLife(item, bomb = false) {
    if (phase !== 'playing') return;
    lives = Math.max(0, lives - 1);
    combo = 0;
    shake = 0.4;
    if (bomb) {
      bombsHit += 1;
      burst(item.x, basketY, '#dd8772', 18);
      label('炸弹不能接！−1 ♥', item.x, basketY - 50, '#a94f43');
      sound('hit');
      status(`炸弹不是奶蛙！还剩 ${lives} 颗心，看到黑球就让开。`);
    } else {
      missed += 1;
      ghosts.push({ x: item.x, y: floorY - 24, age: 0, life: 0.65 });
      burst(item.x, floorY - 10, '#d5b576', 7);
      label('接不住啦！−1 ♥', item.x, floorY - 60, '#a94f43');
      sound('miss');
      sound('laugh');
      status(`漏了一只！还剩 ${lives} 颗心，篮子往奶蛙下面移。`);
    }
    if (lives === 0) finish(false);
  }

  function catchFrog(item) {
    caught += 1;
    combo += 1;
    bestCombo = Math.max(bestCombo, combo);
    const bonus = Math.min(25, Math.floor(combo / 4) * 5);
    const points = (item.kind === 'gold' ? 30 : 10) + bonus;
    score += points;
    onScore?.(score);
    caughtFrog = { age: 0, kind: item.kind };
    burst(basketX, basketY - 30, item.kind === 'gold' ? '#e9b43b' : '#b8cd76');
    label(`${item.kind === 'gold' ? '金蛙 ' : ''}+${points}`, basketX, basketY - 77, item.kind === 'gold' ? '#a3791b' : '#385d45');
    sound(item.kind === 'gold' || combo % 4 === 0 ? 'score' : 'pop');
    if (combo % 4 === 0) status(`${combo} 连接！每只奶蛙额外 +${bonus} 分。`);
  }

  function updateEffects(dt) {
    shake = Math.max(0, shake - dt);
    for (const p of particles) {
      p.age += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 260 * dt;
    }
    for (const p of labels) { p.age += dt; p.y -= 31 * dt; }
    for (const p of ghosts) p.age += dt;
    particles = particles.filter(p => p.age < p.life);
    labels = labels.filter(p => p.age < p.life);
    ghosts = ghosts.filter(p => p.age < p.life);
    if (caughtFrog) {
      caughtFrog.age += dt;
      if (caughtFrog.age > 0.58) caughtFrog = null;
    }
  }

  function update(dt) {
    if (phase === 'idle' || phase === 'ended') return;
    dt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.05);
    elapsed += dt;
    phaseTime += dt;
    updateEffects(dt);
    if (phase === 'ending') {
      if (phaseTime >= 0.85 && !endSent) {
        endSent = true;
        phase = 'ended';
        onEnd?.({ score, won, endless, wave, title: endless ? '无限接蛙，篮子下班！' : won ? '奶蛙快递，全部签收！' : '奶蛙接不住，笑声拦不住。',
          message: `接住 ${caught} 只奶蛙，最高 ${bestCombo} 连接。${endless ? `无限模式坚持到第 ${wave} 波，累计 ${score} 分！` : won ? '八波全部完成，下次争取三颗心带回家！' : `闯到第 ${wave} 波，再来一次，把篮子移到奶蛙下面！`}` });
      }
      return;
    }

    basketX = clamp(basketX + (Number(held.right) - Number(held.left)) * moveSpeed * dt, basketWidth / 2 + 8, width - basketWidth / 2 - 8);
    if (phase === 'intermission') {
      if (phaseTime >= 1.35) {
        wave += 1;
        waveSpawned = 0;
        waveResolved = 0;
        spawnTimer = 0.45;
        previousX = basketX;
        previousKind = 'frog';
        phase = 'playing';
        phaseTime = 0;
        status(`${endless ? `无限第 ${wave} 波` : `第 ${wave} / ${TOTAL_WAVES} 波`} · ${wave >= 4 ? '奶蛙开始左右飘了' : '金色光圈的奶蛙值 30 分'} · 黑色炸弹别接！`);
      }
      return;
    }

    spawnTimer -= dt;
    if (spawnTimer <= 0 && waveSpawned < waveCount()) {
      spawn();
      spawnTimer += interval();
    }

    for (const item of objects) {
      if (item.resolved) continue;
      item.age += dt;
      item.y += item.speed * dt;
      item.x = clamp(item.baseX + Math.sin(item.age * 1.75) * item.drift, 88, width - 88);
      const contactY = basketY - (item.kind === 'bomb' ? 26 : 40);
      if (!item.checked && item.y >= contactY) {
        item.checked = true;
        if (Math.abs(item.x - basketX) < basketWidth / 2 + (item.kind === 'bomb' ? 16 : 12)) {
          item.resolved = true;
          waveResolved += 1;
          if (item.kind === 'bomb') loseLife(item, true);
          else catchFrog(item);
          if (phase === 'ending') break;
        }
      }
      if (!item.resolved && item.y >= floorY - 17) {
        item.resolved = true;
        waveResolved += 1;
        if (item.kind === 'bomb') {
          bombsDodged += 1;
          burst(item.x, floorY - 8, '#a9b2ac', 7);
          label('躲开了', item.x, floorY - 28, '#698173');
        } else loseLife(item);
        if (phase === 'ending') break;
      }
    }
    objects = objects.filter(item => !item.resolved);
    if (phase === 'playing' && waveSpawned === waveCount() && objects.length === 0) {
      if (!endless && wave === TOTAL_WAVES) finish(true);
      else {
        phase = 'intermission'; phaseTime = 0; sound('score');
        status(`第 ${wave} 波接完！稍微喘口气，下一波马上来。`);
      }
    }
  }

  function pointerMove(point) {
    if (!['playing', 'intermission'].includes(phase) || !Number.isFinite(point?.x)) return;
    basketX = clamp(point.x, basketWidth / 2 + 8, width - basketWidth / 2 - 8);
    cancelInput();
  }

  function keySide(event) {
    const key = event.key?.toLowerCase();
    if (event.code === 'ArrowLeft' || event.code === 'KeyA' || key === 'arrowleft' || key === 'a') return 'left';
    if (event.code === 'ArrowRight' || event.code === 'KeyD' || key === 'arrowright' || key === 'd') return 'right';
    return null;
  }

  function keyDown(event) {
    const side = keySide(event);
    if (!side) return false;
    if (phase === 'playing' || phase === 'intermission') held[side] = true;
    return true;
  }

  function keyUp(event) {
    const side = keySide(event);
    if (!side) return false;
    held[side] = false;
    return true;
  }

  function rounded(x, y, w, h, r, fill, stroke) {
    ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); }
  }

  function text(value, x, y, size = 18, color = '#355444', align = 'center') {
    ctx.fillStyle = color; ctx.textAlign = align;
    ctx.font = `700 ${size}px "Noto Sans SC", system-ui, sans-serif`;
    ctx.fillText(value, x, y);
  }

  function heart(x, y, active) {
    ctx.fillStyle = active ? '#df8c79' : '#e4dcd0';
    ctx.beginPath(); ctx.moveTo(x, y + 19);
    ctx.bezierCurveTo(x - 24, y + 3, x - 15, y - 14, x, y - 3);
    ctx.bezierCurveTo(x + 15, y - 14, x + 24, y + 3, x, y + 19);
    ctx.fill();
  }

  function drawBomb(x, y, time, size = 26) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(Math.sin(time * 5) * 0.07);
    ctx.strokeStyle = '#706f60'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(7, -size + 2); ctx.quadraticCurveTo(8, -size - 18, 20, -size - 15); ctx.stroke();
    ctx.fillStyle = '#424c50'; ctx.beginPath(); ctx.arc(0, 0, size, 0, TAU); ctx.fill();
    ctx.fillStyle = '#687476'; ctx.beginPath(); ctx.ellipse(-8, -8, 5, 9, 0.6, 0, TAU); ctx.fill();
    text('!', 0, 10, 29, '#fff9dd');
    ctx.fillStyle = '#edb144'; ctx.beginPath(); ctx.arc(21, -size - 14, 4 + Math.sin(time * 23) * 1.5, 0, TAU); ctx.fill();
    ctx.restore();
  }

  function drawItem(item, time) {
    if (item.kind === 'bomb') { drawBomb(item.x, item.y, time); return; }
    if (item.kind === 'gold') {
      ctx.save(); ctx.globalAlpha = 0.7; ctx.strokeStyle = '#e6b83f'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.ellipse(item.x, item.y - 3, 45, 56, 0, 0, TAU); ctx.stroke();
      ctx.fillStyle = '#f9dc76';
      for (let i = 0; i < 5; i += 1) {
        const a = i * TAU / 5 + time;
        ctx.beginPath(); ctx.arc(item.x + Math.cos(a) * 50, item.y - 3 + Math.sin(a) * 58, 3, 0, TAU); ctx.fill();
      }
      ctx.restore();
      text('+30', item.x, item.y - 67, 15, '#a57b20');
    }
    drawFrog(ctx, item.x, item.y, item.kind === 'gold' ? 70 : 65, {
      expression: 'laugh', rotation: Math.sin(time * 3 + item.id) * 0.07 + (item.spin || 0),
    });
  }

  function drawBasket(time) {
    const x = basketX + (shake > 0 ? Math.sin(time * 67) * shake * 12 : 0);
    ctx.save();
    ctx.fillStyle = '#49604420'; ctx.beginPath(); ctx.ellipse(x, floorY + 3, 88, 8, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#d1af76'; ctx.strokeStyle = '#8f7952'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x - 82, basketY); ctx.lineTo(x - 65, floorY - 7);
    ctx.quadraticCurveTo(x, floorY + 4, x + 65, floorY - 7); ctx.lineTo(x + 82, basketY); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#8d7951'; ctx.beginPath(); ctx.ellipse(x, basketY, 81, 14, 0, 0, TAU); ctx.fill();
    if (caughtFrog) {
      const t = caughtFrog.age;
      drawFrog(ctx, x, basketY - 19 - Math.sin(Math.min(1, t / 0.36) * Math.PI) * 29, 58, {
        expression: t < 0.16 ? 'squish' : 'happy', scaleX: t < 0.16 ? 1.2 : 1, scaleY: t < 0.16 ? 0.64 : 1,
      });
    }
    // The rim and front panel keep a caught frog visibly inside the basket.
    rounded(x - 82, basketY, 164, 13, 6, '#b6c58b', '#6f8056');
    ctx.strokeStyle = '#aa8b5d'; ctx.lineWidth = 2;
    for (let i = -3; i <= 3; i += 1) {
      ctx.beginPath(); ctx.moveTo(x + i * 20, basketY + 15); ctx.lineTo(x + i * 17, floorY - 8); ctx.stroke();
    }
    for (let y = basketY + 21; y < floorY - 8; y += 13) {
      ctx.beginPath(); ctx.moveTo(x - 68, y); ctx.lineTo(x + 68, y); ctx.stroke();
    }
    rounded(x - 40, basketY + 19, 80, 25, 8, '#f8f1da');
    text('接蛙专用', x, basketY + 36, 14, '#716143');
    ctx.restore();
  }

  function render(time = elapsed) {
    ctx.save();
    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, '#f8efe1'); sky.addColorStop(1, '#edf3db');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, width, height);
    for (let i = 0; i < 5; i += 1) {
      const x = 50 + i * 215 + Math.sin(time * 0.15 + i) * 13;
      const y = 127 + (i % 2) * 85;
      ctx.fillStyle = '#fffdf3'; ctx.beginPath();
      ctx.ellipse(x, y, 48, 12, 0, 0, TAU); ctx.ellipse(x - 15, y - 13, 20, 20, 0, 0, TAU); ctx.ellipse(x + 11, y - 19, 24, 26, 0, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = '#dce8c1'; ctx.beginPath(); ctx.moveTo(0, floorY);
    ctx.bezierCurveTo(width * 0.3, floorY - 100, width * 0.7, floorY - 8, width, floorY - 72);
    ctx.lineTo(width, height); ctx.lineTo(0, height); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#c6d8a4'; ctx.fillRect(0, floorY, width, height - floorY);
    ctx.strokeStyle = '#a4bd83'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, floorY); ctx.lineTo(width, floorY); ctx.stroke();

    if (phase === 'idle') {
      drawItem({ id: 1, kind: 'frog', x: 290, y: 218 + Math.sin(time * 2) * 12 }, time);
      drawItem({ id: 2, kind: 'gold', x: 615, y: 298 + Math.sin(time * 2 + 1) * 13 }, time);
      drawBomb(780, 183, time);
      text('天上真的会掉奶蛙。', width / 2, 145, 25, '#758057');
    }
    for (const item of objects) drawItem(item, time);
    for (const ghost of ghosts) {
      ctx.globalAlpha = Math.max(0, 1 - ghost.age / ghost.life);
      drawFrog(ctx, ghost.x, ghost.y, 65, { expression: 'laugh', scaleX: 1.25, scaleY: 0.55, rotation: -0.12 });
    }
    ctx.globalAlpha = 1;
    drawBasket(time);

    for (const p of particles) {
      ctx.globalAlpha = 1 - p.age / p.life; ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU); ctx.fill();
    }
    for (const p of labels) { ctx.globalAlpha = Math.min(1, (p.life - p.age) * 3); text(p.text, clamp(p.x, 120, width - 120), p.y, 21, p.color); }
    ctx.globalAlpha = 1;

    rounded(19, 17, 180, 62, 17, '#fffdf4e8');
    text('剩余机会', 40, 41, 14, '#859077', 'left');
    for (let i = 0; i < 3; i += 1) heart(112 + i * 29, 48, i < lives);
    rounded(width / 2 - 125, 17, 250, 65, 17, '#fffdf4e8');
    text(endless ? `无限 · 第 ${wave} 波` : `第 ${wave} / ${TOTAL_WAVES} 波`, width / 2, 43, 22);
    rounded(width / 2 - 95, 56, 190, 9, 4, '#e6ead6');
    const progress = Math.max(0, Math.min(1, waveResolved / waveCount()));
    if (progress > 0) rounded(width / 2 - 95, 56, 190 * progress, 9, 4, '#a5bd6d');
    rounded(width - 201, 17, 180, 62, 17, '#fffdf4e8');
    text(combo > 1 ? `${combo} 连接！` : '接住 +10', width - 111, 44, 22, combo > 1 ? '#b18228' : '#577348');
    text('金蛙 +30 · 炸弹 −1 心', width - 111, 64, 12, '#8a8c6d');
    text('鼠标 / 手指移动篮子  ·  ← → 或 A D', width / 2, height - 10, 16, '#667b50');

    if (phase === 'playing' && wave === 1 && elapsed < 4.6) {
      rounded(width / 2 - 164, 96, 328, 40, 14, '#fffdf5e8');
      text('先接第一只：把篮子移到它下面 ↓', width / 2, 122, 18, '#6d8056');
    }
    if (phase === 'intermission' || (phase === 'ending' && won)) {
      rounded(width / 2 - 190, 208, 380, 115, 23, '#fffdf2ee', '#c4d5a3');
      text(won ? '全部签收！' : `第 ${wave} 波，稳稳接住！`, width / 2, 252, 27);
      text(won ? '奶蛙快递：五星好评。' : endless ? `无限第 ${wave + 1} 波，分数继续累计。` : `下一波 ${wave + 1} / ${TOTAL_WAVES}，准备接蛙。`, width / 2, 288, 18, '#819164');
    }
    ctx.restore();
  }

  return {
    start, update, render,
    pointerDown: pointerMove,
    pointerMove,
    pointerUp(point) { if (point?.cancelled) cancelInput(); },
    keyDown, keyUp, cancelInput,
    destroy() { phase = 'idle'; cancelInput(); objects = []; particles = []; labels = []; ghosts = []; caughtFrog = null; },
    getState() {
      return {
        phase, score, lives, endless, wave, totalWaves: endless ? null : TOTAL_WAVES, waveSpawned, waveResolved,
        waveCount: waveCount(), elapsed, phaseTime, spawnTimer, combo, bestCombo,
        fallSpeed: fallSpeed(), spawnInterval: interval(), driftLimit: driftLimit(),
        caught, missed, bombsHit, bombsDodged, won,
        basket: { x: basketX, y: basketY, width: basketWidth, speed: moveSpeed },
        held: { ...held },
        objects: objects.map(({ id, kind, x, y, speed, drift, checked }) => ({ id, kind, x, y, speed, drift, checked })),
      };
    },
  };
}
