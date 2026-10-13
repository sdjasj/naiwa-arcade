const TAU = Math.PI * 2;
const MODES = {
  easy: { label: '轻松', gap: 248, minGap: 224, shrink: 0.9, speed: 172, maxSpeed: 225, speedGain: 2.2, gravity: 840, terminal: 490, flap: 328, startVelocity: -205, spacing: 350, centerStep: 70 },
  normal: { label: '标准', gap: 204, minGap: 178, shrink: 1.2, speed: 205, maxSpeed: 278, speedGain: 3.2, gravity: 990, terminal: 550, flap: 355, startVelocity: -220, spacing: 335, centerStep: 86 },
  hard: { label: '困难', gap: 178, minGap: 150, shrink: 1.4, speed: 235, maxSpeed: 320, speedGain: 4, gravity: 1120, terminal: 610, flap: 370, startVelocity: -230, spacing: 320, centerStep: 96 },
};
const SCENES = [
  { name: '晴空', sky: ['#dff5f1', '#f6f9dd'], sun: '#fff0ab', rays: '#f5cf78', far: '#d1e8c5', near: '#bdd89f' },
  { name: '晚霞', sky: ['#f5d7d7', '#fff0cf'], sun: '#f6bb80', rays: '#e4a476', far: '#dfc6b1', near: '#c9b99a' },
  { name: '星夜', sky: ['#68768e', '#b4bfd1'], sun: '#fff2c8', rays: '#d6d7bf', far: '#9eaeb6', near: '#879f9f' },
];
const normalizeDifficulty = value => Object.hasOwn(MODES, value) ? value : 'normal';

export function createGame(env) {
  const { ctx, width = 960, height = 560, drawFrog, audio, onScore, onStatus, onEnd } = env;
  const ground = height - 48;
  const frogX = width * 0.265;
  const radius = 26;
  let phase = 'idle';
  let score = 0;
  let elapsed = 0;
  let distance = 0;
  let crashTime = 0;
  let flapTime = 0;
  let playerY = height * 0.43;
  let velocity = 0;
  let pipes = [];
  let particles = [];
  let ended = false;
  let hitGround = false;
  let difficulty = normalizeDifficulty(env.difficulty);
  let mode = MODES[difficulty];
  let flaps = 0;
  let flightSeconds = 0;
  let endless = env.endless === true;
  let lives = endless ? 3 : 1;
  let invulnerabilityTime = 0;

  function chapter() { return Math.floor(score / 5) + 1; }
  function scene() { return SCENES[(chapter() - 1) % SCENES.length]; }
  function stats() { return { flaps, flightSeconds, distance, pipesPassed: score }; }

  function play(kind) {
    audio?.play(kind);
  }

  function roundedRect(x, y, w, h, r, fill, stroke) {
    if (w <= 0 || h <= 0) return;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }

  function makePipe(x, first = false) {
    const gap = Math.max(mode.minGap, mode.gap - score * mode.shrink);
    const previous = pipes[pipes.length - 1];
    let center = first ? height * 0.43 : 175 + Math.random() * 165;
    if (previous) center = Math.max(previous.center - mode.centerStep, Math.min(previous.center + mode.centerStep, center));
    return { x, width: 86, gap, center, passed: false };
  }

  function flap() {
    if (phase !== 'running') return;
    velocity = -mode.flap;
    flaps += 1;
    flapTime = 0.19;
    play('flap');
    for (let i = 0; i < 4; i += 1) {
      particles.push({
        x: frogX - 29,
        y: playerY + 5 + Math.random() * 20,
        vx: -45 - Math.random() * 55,
        vy: 25 + Math.random() * 65,
        life: 0.38,
        maxLife: 0.38,
        size: 3 + Math.random() * 4,
        type: 'puff',
      });
    }
  }

  function crash(floor = false) {
    if (phase !== 'running' || invulnerabilityTime > 0) return;
    lives = Math.max(0, lives - 1);
    phase = 'crashed';
    crashTime = 0;
    hitGround = floor;
    velocity = 0;
    play('hit');
    play('laugh');
    onStatus?.(endless && lives > 0 ? `噗叽！还剩 ${lives} 颗心，奶蛙马上重新起飞。` : '噗叽！肚子先到，翅膀还在路上。');
    for (let i = 0; i < 9; i += 1) {
      const angle = i * TAU / 9;
      particles.push({
        x: frogX,
        y: playerY,
        vx: Math.cos(angle) * (65 + Math.random() * 70),
        vy: Math.sin(angle) * 105 - 35,
        life: 0.8,
        maxLife: 0.8,
        size: 5 + Math.random() * 4,
        type: 'star',
      });
    }
  }

  function circleTouchesRect(x, y, w, h) {
    const closestX = Math.max(x, Math.min(frogX, x + w));
    const closestY = Math.max(y, Math.min(playerY, y + h));
    return (frogX - closestX) ** 2 + (playerY - closestY) ** 2 < radius ** 2;
  }

  function start(options = {}) {
    difficulty = normalizeDifficulty(options?.difficulty ?? difficulty);
    if (typeof options?.endless === 'boolean') endless = options.endless;
    mode = MODES[difficulty];
    phase = 'running';
    score = 0;
    elapsed = 0;
    distance = 0;
    flaps = 0;
    flightSeconds = 0;
    lives = endless ? 3 : 1;
    invulnerabilityTime = 0;
    crashTime = 0;
    flapTime = 0.19;
    playerY = height * 0.43;
    velocity = mode.startVelocity;
    pipes = [];
    particles = [];
    ended = false;
    hitGround = false;
    pipes.push(makePipe(width - 80, true));
    pipes.push(makePipe(width - 80 + mode.spacing));
    onScore?.(0);
    onStatus?.(endless ? `${mode.label} · 无限模式 3 颗心 · 碰撞后安全复位并短暂无敌` : `${mode.label}模式 · 点击 / 空格 / ↑ 拍翅膀 · 每 5 根水管进入新风景`);
  }

  function recover() {
    // Keep future scenery and the earned score, remove the obstacle that hit us,
    // and give the next pipe a fresh approach instead of reviving inside it.
    pipes = pipes.filter(pipe => pipe.x > frogX + radius + 24);
    if (pipes.length) {
      const shift = Math.max(0, width - 80 - pipes[0].x);
      for (const pipe of pipes) pipe.x += shift;
    } else {
      pipes.push(makePipe(width - 80, true));
      pipes.push(makePipe(width - 80 + mode.spacing));
    }
    playerY = pipes[0].center;
    velocity = mode.startVelocity;
    phase = 'running';
    crashTime = 0;
    hitGround = false;
    flapTime = 0.19;
    invulnerabilityTime = 1.8;
    onStatus?.(`无限模式 · 剩余 ${lives} 颗心 · 护盾 1.8 秒，轻点继续飞！`);
  }

  function update(dt) {
    if (phase === 'idle' || phase === 'ended') return;
    dt = Math.max(0, Math.min(Number.isFinite(dt) ? dt : 0, 0.05));
    elapsed += dt;
    flapTime = Math.max(0, flapTime - dt);
    for (const particle of particles) {
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vy += (particle.type === 'star' ? 150 : 30) * dt;
      particle.life -= dt;
    }
    particles = particles.filter(particle => particle.life > 0);

    if (phase === 'crashed') {
      crashTime += dt;
      if (crashTime >= 0.85 && !ended) {
        if (endless && lives > 0) { recover(); return; }
        ended = true;
        phase = 'ended';
        onEnd?.({
          score,
          endless,
          lives,
          difficulty,
          chapter: chapter(),
          chapterName: scene().name,
          stats: stats(),
          title: endless ? '三颗心飞完，奶蛙还在笑。' : score >= 10 ? '奶蛙竟然飞起来了！' : '翅膀下班，肚子着陆。',
          message: endless ? `无限模式穿过 ${score} 根水管，抵达第 ${chapter()} 段${scene().name}。再来一局，挑战飞得更远！` : score === 0
            ? '奶蛙：刚刚那是热身！轻轻连点，让肚子从水管中间钻过去。'
            : `穿过了 ${score} 根水管！奶蛙笑得很大声，假装一点也不疼。`,
        });
      }
      return;
    }

    const speed = Math.min(mode.maxSpeed, mode.speed + score * mode.speedGain);
    invulnerabilityTime = Math.max(0, invulnerabilityTime - dt);
    flightSeconds += dt;
    distance += speed * dt;
    velocity = Math.min(mode.terminal, velocity + mode.gravity * dt);
    playerY += velocity * dt;
    if (playerY < radius + 6) {
      playerY = radius + 6;
      velocity = Math.max(0, velocity);
    }
    for (const pipe of pipes) {
      pipe.x -= speed * dt;
      const top = pipe.center - pipe.gap / 2;
      const bottom = pipe.center + pipe.gap / 2;
      const hitsTop = circleTouchesRect(pipe.x - 6, 0, pipe.width + 12, top);
      const hitsBottom = circleTouchesRect(pipe.x - 6, bottom, pipe.width + 12, ground - bottom);
      if ((hitsTop || hitsBottom) && invulnerabilityTime <= 0) {
        crash();
        return;
      }
      if (!pipe.passed && pipe.x + pipe.width + radius < frogX) {
        pipe.passed = true;
        score += 1;
        onScore?.(score);
        play('score');
        if (score === 3) onStatus?.('有点东西！奶蛙开始相信自己的翅膀了。');
        if (score === 10) onStatus?.('两栖动物，正式申请加入航空业。');
        if (score % 5 === 0) onStatus?.(`第 ${chapter()} 段 · ${scene().name}！奶蛙又飞过一片新风景。`);
      }
    }
    pipes = pipes.filter(pipe => pipe.x + pipe.width > -30);
    const lastPipe = pipes[pipes.length - 1];
    if (!lastPipe || lastPipe.x < width - 255) {
      pipes.push(makePipe(lastPipe ? lastPipe.x + mode.spacing : width + 80));
    }
    if (playerY + radius >= ground) {
      playerY = ground - radius;
      if (invulnerabilityTime > 0) velocity = -mode.flap * 0.75;
      else crash(true);
    }
  }

  function cloud(x, y, scale = 1) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.fillStyle = 'rgba(255,255,255,0.82)';
    ctx.beginPath();
    ctx.ellipse(0, 0, 43, 15, 0, 0, TAU);
    ctx.ellipse(-15, -10, 20, 19, 0, 0, TAU);
    ctx.ellipse(14, -17, 24, 25, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function background(time) {
    const colors = scene();
    const sky = ctx.createLinearGradient(0, 0, 0, ground);
    sky.addColorStop(0, colors.sky[0]);
    sky.addColorStop(1, colors.sky[1]);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = colors.sun;
    ctx.beginPath();
    ctx.arc(width - 124, 95, 37, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = colors.rays;
    ctx.lineWidth = 3;
    for (let i = 0; i < (colors.name === '星夜' ? 0 : 8); i += 1) {
      const angle = i * TAU / 8;
      ctx.beginPath();
      ctx.moveTo(width - 124 + Math.cos(angle) * 47, 95 + Math.sin(angle) * 47);
      ctx.lineTo(width - 124 + Math.cos(angle) * 54, 95 + Math.sin(angle) * 54);
      ctx.stroke();
    }
    if (colors.name === '星夜') {
      ctx.fillStyle = colors.sky[0];
      ctx.beginPath(); ctx.arc(width - 109, 81, 34, 0, TAU); ctx.fill();
      for (let i = 0; i < 19; i++) {
        ctx.globalAlpha = 0.35 + (Math.sin(time * 1.4 + i) + 1) * 0.25;
        ctx.fillStyle = '#fff9dd';
        star(28 + (i * 173) % (width - 55), 40 + (i * 47) % 255, i % 3 === 0 ? 4 : 2.5, 0);
      }
      ctx.globalAlpha = 1;
    }
    const drift = phase === 'idle' ? time * 6 : distance * 0.16;
    for (let i = 0; i < 6; i += 1) {
      const x = ((i * 219 + 110 - drift) % (width + 160) + width + 160) % (width + 160) - 80;
      cloud(x, 91 + (i % 3) * 83, 0.7 + (i % 2) * 0.3);
    }

    ctx.fillStyle = colors.far;
    ctx.beginPath();
    ctx.moveTo(0, ground);
    for (let x = 0; x <= width + 15; x += 15) {
      ctx.lineTo(x, ground - 30 - Math.sin(x * 0.006 + 1) * 27 - Math.sin(x * 0.019) * 10);
    }
    ctx.lineTo(width, ground);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = colors.near;
    ctx.beginPath();
    ctx.moveTo(0, ground);
    for (let x = 0; x <= width + 15; x += 15) {
      ctx.lineTo(x, ground - 7 - Math.sin(x * 0.012 + 2) * 16);
    }
    ctx.lineTo(width, ground);
    ctx.closePath();
    ctx.fill();
  }

  function pipeBody(pipe) {
    const top = pipe.center - pipe.gap / 2;
    const bottom = pipe.center + pipe.gap / 2;
    const x = pipe.x;
    const w = pipe.width;
    for (const [y, h] of [[-10, top + 10], [bottom, ground - bottom + 5]]) {
      roundedRect(x, y, w, h, 9, '#84b66d', '#446d4b');
      roundedRect(x + 9, y + 4, 13, h - 8, 5, 'rgba(236,255,196,0.48)');
      roundedRect(x + w - 15, y + 4, 9, h - 8, 4, 'rgba(50,89,49,0.12)');
    }
    roundedRect(x - 6, top - 25, w + 12, 25, 7, '#a7ce88', '#446d4b');
    roundedRect(x - 6, bottom, w + 12, 25, 7, '#a7ce88', '#446d4b');
    ctx.fillStyle = '#e7f4c5';
    ctx.fillRect(x + 3, top - 20, w - 8, 4);
    ctx.fillRect(x + 3, bottom + 5, w - 8, 4);
    if (!pipe.passed) {
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = '#b2c995';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 8]);
      ctx.beginPath();
      ctx.moveTo(x + w / 2, top + 32);
      ctx.lineTo(x + w / 2, bottom - 32);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawGround() {
    ctx.fillStyle = '#8cac68';
    ctx.fillRect(0, ground, width, 7);
    ctx.fillStyle = '#e6d8b7';
    ctx.fillRect(0, ground + 7, width, height - ground);
    ctx.fillStyle = '#f5ebd2';
    ctx.fillRect(0, ground + 7, width, 8);
    ctx.strokeStyle = '#c4b48e';
    ctx.lineWidth = 2;
    for (let i = -1; i < width / 40 + 2; i += 1) {
      const x = i * 40 - distance % 40;
      ctx.beginPath();
      ctx.moveTo(x, ground + 26);
      ctx.lineTo(x + 9, ground + 26);
      ctx.moveTo(x + 21, ground + 39);
      ctx.lineTo(x + 25, ground + 39);
      ctx.stroke();
    }
  }

  function star(x, y, size, rotation) {
    ctx.beginPath();
    for (let i = 0; i < 10; i += 1) {
      const angle = rotation + i * Math.PI / 5;
      const r = i % 2 === 0 ? size : size * 0.45;
      const px = x + Math.cos(angle) * r;
      const py = y + Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  }

  function render(time = 0) {
    ctx.save();
    background(time);
    for (const pipe of pipes) pipeBody(pipe);
    drawGround();

    const idle = phase === 'idle';
    const crashed = phase === 'crashed' || phase === 'ended';
    const y = idle ? height * 0.43 + Math.sin(time * 2.7) * 13 : playerY;
    const rotation = crashed ? (hitGround ? -0.12 : 0.12) : idle ? -0.08 : Math.max(-0.38, Math.min(0.85, velocity / 720));

    ctx.fillStyle = 'rgba(70,102,65,0.13)';
    ctx.beginPath();
    ctx.ellipse(frogX, ground + 3, 29, 5, 0, 0, TAU);
    ctx.fill();

    for (const particle of particles) {
      ctx.globalAlpha = particle.life / particle.maxLife;
      if (particle.type === 'star') {
        ctx.fillStyle = '#f8c75d';
        star(particle.x, particle.y, particle.size, elapsed * 4);
      } else {
        ctx.fillStyle = '#fffefa';
        ctx.beginPath();
        ctx.ellipse(particle.x, particle.y, particle.size * 1.5, particle.size, -0.3, 0, TAU);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    if (invulnerabilityTime > 0) {
      ctx.strokeStyle = '#fff4ab'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.ellipse(frogX, y - 6, 58, 69, 0, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 0.78 + Math.sin(time * 8) * 0.12;
    }
    drawFrog(ctx, frogX, y, 83, {
      expression: crashed ? (crashTime < 0.43 ? 'squish' : 'laugh') : velocity > 250 ? 'hurt' : 'happy',
      rotation,
      scaleX: crashed ? 1.26 - Math.min(crashTime, 0.8) * 0.18 : 1 + Math.sin(time * 3) * 0.015,
      scaleY: crashed ? 0.62 + Math.min(crashTime, 0.8) * 0.26 : flapTime > 0 ? 0.93 : 1,
      wings: true,
      wingPhase: crashed ? 0 : time * (flapTime > 0 ? 43 : 17),
    });
    ctx.globalAlpha = 1;

    if (crashed) {
      const bubbleX = Math.min(width - 190, frogX + 57);
      roundedRect(bubbleX, Math.max(25, y - 87), 141, 42, 16, '#fffdf4', '#53784e');
      ctx.font = '800 19px "Noto Sans SC", system-ui, sans-serif';
      ctx.fillStyle = '#36543b';
      ctx.textAlign = 'center';
      ctx.fillText(crashTime < 0.43 ? '噗——叽！' : endless && lives > 0 ? `还有${lives}颗心！` : '哈哈哈哈哈！', bubbleX + 70, Math.max(25, y - 87) + 27);
    }

    ctx.textAlign = 'left';
    ctx.fillStyle = '#5e8066';
    ctx.font = '600 15px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillText('小翅膀，也有大梦想。', 24, ground + 34);

    roundedRect(20, 18, 197, 49, 15, 'rgba(255,253,244,0.90)');
    ctx.textAlign = 'left';
    ctx.fillStyle = '#4e6856';
    ctx.font = '700 15px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillText(`${mode.label} · 第 ${chapter()} 段 ${scene().name}`, 33, 39);
    ctx.fillStyle = '#7a8972';
    ctx.font = '12px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillText(`再过 ${5 - score % 5} 根水管，下一片风景`, 33, 56);

    if (endless) {
      roundedRect(width - 257, 18, 237, 66, 15, 'rgba(255,253,244,0.94)');
      ctx.fillStyle = '#4e6856'; ctx.font = '700 17px "Noto Sans SC", system-ui, sans-serif';
      ctx.fillText('∞ 无限飞行', width - 241, 43);
      for (let i = 0; i < 3; i += 1) {
        const x = width - 117 + i * 32, y = 39;
        ctx.fillStyle = i < lives ? '#da8c7c' : '#dddccd';
        ctx.beginPath(); ctx.moveTo(x, y + 12);
        ctx.bezierCurveTo(x - 21, y - 2, x - 12, y - 16, x, y - 6);
        ctx.bezierCurveTo(x + 12, y - 16, x + 21, y - 2, x, y + 12); ctx.fill();
      }
      ctx.fillStyle = '#7a8972'; ctx.font = '12px "Noto Sans SC", system-ui, sans-serif';
      ctx.fillText(invulnerabilityTime > 0 ? `护盾保护中 · ${invulnerabilityTime.toFixed(1)} 秒` : '撞击扣 1 心 · 复位后短暂保护', width - 241, 68);
    }

    if (phase === 'running' && elapsed < 3) {
      const alpha = Math.min(1, 3 - elapsed);
      ctx.globalAlpha = alpha;
      roundedRect(frogX - 87, Math.min(ground - 55, y + 75), 174, 35, 17, '#fffdf1');
      ctx.textAlign = 'center';
      ctx.fillStyle = '#53704d';
      ctx.font = '700 15px "Noto Sans SC", system-ui, sans-serif';
      ctx.fillText('轻点一下，努力飞！', frogX, Math.min(ground - 55, y + 75) + 23);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  return {
    start,
    update,
    render,
    pointerDown() { flap(); },
    pointerMove() {},
    pointerUp() {},
    keyDown(event) {
      if (event.code === 'Space' || event.code === 'ArrowUp' || event.key === ' ' || event.key === 'ArrowUp') {
        if (!event.repeat) flap();
        return true;
      }
      return false;
    },
    destroy() {
      phase = 'idle';
      particles = [];
      pipes = [];
      invulnerabilityTime = 0;
    },
    getState() {
      return {
        phase,
        score,
        endless,
        lives,
        invulnerable: invulnerabilityTime > 0,
        invulnerabilityTime,
        difficulty,
        chapter: chapter(),
        chapterName: scene().name,
        speed: Math.min(mode.maxSpeed, mode.speed + score * mode.speedGain),
        stats: stats(),
        player: { x: frogX, y: playerY, velocity, radius },
        pipes: pipes.map(({ x, width: w, gap, center, passed }) => ({ x, width: w, gap, center, passed })),
      };
    },
  };
}
