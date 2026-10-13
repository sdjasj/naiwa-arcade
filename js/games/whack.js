const ROUND_SECONDS = 30;
const TAUNTS = ['略略略～', '就这？呱哈哈！', '没打着吧！', '手速跟上呀～'];
const EXPRESSIONS = ['happy', 'smug', 'angry', 'laugh'];

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const easeOut = (n) => 1 - (1 - n) ** 3;

export function createGame(env) {
  const { ctx, drawFrog, audio, onScore, onStatus, onEnd } = env;
  const width = env.width || 960;
  const height = env.height || 560;
  const holes = Array.from({ length: 9 }, (_, index) => ({
    x: 212 + (index % 3) * 268,
    y: 228 + Math.floor(index / 3) * 134,
    state: 'hidden',
    age: 0,
    duration: 1.2,
    expression: 'happy',
    key: index + 1,
    taunt: '',
  }));
  let phase = 'idle';
  let score = 0;
  let combo = 0;
  let bestCombo = 0;
  let hits = 0;
  let escaped = 0;
  let timeLeft = ROUND_SECONDS;
  let elapsed = 0;
  let spawnIn = 0.15;
  let effects = [];
  let hammer = null;
  let cursor = null;
  let clockSound = -1;

  function play(kind) {
    audio?.play(kind);
  }

  function text(label, x, y, size = 22, color = '#365642', align = 'center', weight = 800) {
    ctx.font = `${weight} ${size}px "PingFang SC", "Microsoft YaHei", sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.fillText(label, x, y);
  }

  function rounded(x, y, w, h, r, fill, stroke) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  function ellipse(x, y, rx, ry, fill) {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
  }

  function reset() {
    score = 0;
    combo = 0;
    bestCombo = 0;
    hits = 0;
    escaped = 0;
    timeLeft = ROUND_SECONDS;
    elapsed = 0;
    spawnIn = 0.1;
    effects = [];
    hammer = null;
    clockSound = -1;
    for (const hole of holes) {
      hole.state = 'hidden';
      hole.age = 0;
    }
  }

  function start() {
    reset();
    phase = 'playing';
    onScore?.(0);
    onStatus?.('奶蛙冒头就敲！连续命中有加分。');
  }

  function addText(label, x, y, color = '#336747', large = false) {
    effects.push({ type: 'text', label, x, y, color, age: 0, life: 0.9, large });
  }

  function spawn() {
    const free = holes.filter((hole) => hole.state === 'hidden');
    if (!free.length) return;
    const hole = free[Math.floor(Math.random() * free.length)];
    const difficulty = 1 - timeLeft / ROUND_SECONDS;
    hole.state = 'rising';
    hole.age = 0;
    hole.duration = 1.1 - difficulty * 0.4 + Math.random() * 0.35;
    hole.expression = EXPRESSIONS[Math.floor(Math.random() * EXPRESSIONS.length)];
    hole.taunt = TAUNTS[Math.floor(Math.random() * TAUNTS.length)];
    play('pop');
  }

  function finish() {
    if (phase !== 'playing') return;
    phase = 'ended';
    timeLeft = 0;
    for (const hole of holes) hole.state = 'hidden';
    play('win');
    onStatus?.(`时间到！命中 ${hits} 只，最高 ${bestCombo} 连击。`);
    onEnd?.({
      score,
      title: hits >= 35 ? '奶蛙克星！' : hits >= 18 ? '这手速，蛙服了！' : '奶蛙还在偷笑',
      message: `命中 ${hits} 只 · 最高 ${bestCombo} 连击 · ${escaped} 只逃走。再来一局，手感会更好！`,
    });
  }

  function update(dt) {
    const step = clamp(dt, 0, 0.1);
    elapsed += step;
    effects = effects.filter((effect) => {
      effect.age += step;
      return effect.age < effect.life;
    });
    if (hammer) {
      hammer.age += step;
      if (hammer.age > 0.3) hammer = null;
    }
    if (phase !== 'playing') return;
    timeLeft = Math.max(0, timeLeft - step);
    if (timeLeft <= 0) {
      finish();
      return;
    }
    if (timeLeft <= 5 && clockSound !== Math.ceil(timeLeft)) {
      clockSound = Math.ceil(timeLeft);
      onStatus?.(`最后 ${clockSound} 秒！奶蛙开始慌了！`);
    }
    spawnIn -= step;
    if (spawnIn <= 0) {
      spawn();
      const difficulty = 1 - timeLeft / ROUND_SECONDS;
      spawnIn = 0.65 - difficulty * 0.35 + Math.random() * 0.1;
    }
    for (const hole of holes) {
      hole.age += step;
      if (hole.state === 'rising' && hole.age >= 0.16) {
        hole.state = 'up';
        hole.age = 0;
      } else if (hole.state === 'up' && hole.age >= hole.duration) {
        hole.state = 'laugh';
        hole.age = 0;
        combo = 0;
        escaped += 1;
        play('laugh');
        addText(hole.taunt, hole.x, hole.y - 134, '#88654d');
      } else if (hole.state === 'laugh' && hole.age >= 0.55) {
        hole.state = 'falling';
        hole.age = 0;
      } else if (hole.state === 'falling' && hole.age >= 0.18) {
        hole.state = 'hidden';
        hole.age = 0;
      } else if (hole.state === 'hit' && hole.age >= 0.3) {
        hole.state = 'hidden';
        hole.age = 0;
      }
    }
  }

  function strike(point, keyboardHole) {
    if (phase !== 'playing') return;
    hammer = { x: point.x, y: point.y, age: 0 };
    const hole = keyboardHole || [...holes].reverse().find((candidate) => {
      const dx = (point.x - candidate.x) / 110;
      const dy = (point.y - (candidate.y - 51)) / 76;
      return dx * dx + dy * dy <= 1;
    });
    if (hole && (hole.state === 'up' || hole.state === 'rising')) {
      hole.state = 'hit';
      hole.age = 0;
      combo += 1;
      hits += 1;
      bestCombo = Math.max(bestCombo, combo);
      const points = 10 + Math.min(30, Math.floor(combo / 3) * 5);
      score += points;
      onScore?.(score);
      play('hit');
      if (combo > 1) onStatus?.(`${combo} 连击！奶蛙的笑容逐渐消失。`);
      else onStatus?.('敲中了！保持节奏，连击加分。');
      addText(`+${points}`, hole.x, hole.y - 106, '#2b7750', true);
      for (let i = 0; i < 9; i += 1) {
        const angle = (i / 9) * Math.PI * 2;
        effects.push({
          type: 'spark', x: hole.x, y: hole.y - 67,
          vx: Math.cos(angle) * (100 + Math.random() * 100),
          vy: Math.sin(angle) * 130 - 45,
          age: 0, life: 0.42,
          color: ['#ffd35c', '#fff9e7', '#ef988c'][i % 3],
        });
      }
    } else {
      combo = 0;
      play('miss');
      addText('敲了个寂寞', point.x, point.y - 36, '#ab7668');
      onStatus?.('空锤！奶蛙在洞里偷笑。');
    }
  }

  function background(time) {
    ctx.fillStyle = '#e6efd9';
    ctx.fillRect(0, 0, width, height);
    rounded(32, 82, 896, 450, 30, '#d5e4bf');
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(32, 82, 896, 450, 30);
    ctx.clip();
    for (let row = 0; row < 7; row += 1) {
      for (let col = 0; col < 14; col += 1) {
        if ((row + col) % 2 === 0) {
          ctx.fillStyle = '#deebcd';
          ctx.fillRect(32 + col * 70, 82 + row * 70, 70, 70);
        }
      }
    }
    ctx.restore();
    for (let i = 0; i < 12; i += 1) {
      const x = 60 + ((i * 181) % 840);
      const y = 111 + ((i * 73) % 395);
      ctx.strokeStyle = '#aac18c';
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x - 5, y - 5);
      ctx.lineTo(x, y + 2);
      ctx.lineTo(x + 5, y - 7);
      ctx.stroke();
    }
    for (const [x, y] of [[64, 178], [900, 430], [68, 453], [886, 112]]) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.sin(time * 1.6 + x) * 0.12);
      for (let j = 0; j < 5; j += 1) {
        const angle = (j / 5) * Math.PI * 2;
        ellipse(Math.cos(angle) * 7, Math.sin(angle) * 7, 5, 5, '#fff5df');
      }
      ellipse(0, 0, 4, 4, '#e9bb58');
      ctx.restore();
    }
    text('九宫格蛙田', 48, 38, 23, '#3f5f40', 'left');
    text('鼠标 / 触屏敲击 · 键盘 1–9', 48, 64, 15, '#758766', 'left', 600);
    const timerColor = timeLeft <= 5 ? '#bb6558' : '#3f654d';
    rounded(365, 22, 286, 40, 20, '#f7faef');
    rounded(374, 31, Math.max(0, 219 * (timeLeft / ROUND_SECONDS)), 22, 11, timeLeft <= 5 ? '#eab39a' : '#a7c885');
    text(`${Math.ceil(timeLeft)}s`, 620, 43, 20, timerColor);
    text(combo > 1 ? `${combo} 连击` : '逮住那只蛙！', 902, 39, 23, combo > 1 ? '#ad714b' : '#4b6845', 'right');
    text(combo >= 3 ? `每只 +${10 + Math.min(30, Math.floor(combo / 3) * 5)} 分` : '连续命中 · 分数翻起来', 902, 65, 15, '#7a8966', 'right', 600);
  }

  function renderHole(hole, time, index) {
    const { x, y } = hole;
    ellipse(x, y + 12, 108, 27, 'rgba(83,103,54,0.10)');
    ellipse(x, y + 2, 104, 30, '#a3b786');
    ellipse(x, y, 93, 25, '#8a7456');
    ellipse(x, y - 3, 85, 19, '#5a5140');
    ellipse(x, y - 5, 69, 13, '#484536');
    let emergence = 0;
    let expression = hole.expression;
    let scaleX = 1;
    let scaleY = 1;
    let rotation = 0;
    if (phase === 'idle') {
      emergence = index === 4 ? 1 : index === 0 || index === 8 ? 0.5 + Math.sin(time * 1.7 + index) * 0.12 : 0;
      expression = index === 4 ? 'smug' : 'happy';
      rotation = Math.sin(time * 2 + index) * 0.055;
    } else if (hole.state === 'rising') {
      emergence = easeOut(clamp(hole.age / 0.16, 0, 1));
    } else if (hole.state === 'up') {
      emergence = 1;
      rotation = Math.sin(time * 4 + index) * 0.05;
    } else if (hole.state === 'laugh') {
      emergence = 1 - hole.age * 0.15;
      expression = 'laugh';
      rotation = Math.sin(time * 27) * 0.075;
      scaleY = 1 + Math.sin(time * 32) * 0.035;
    } else if (hole.state === 'falling') {
      emergence = 1 - easeOut(clamp(hole.age / 0.18, 0, 1));
      expression = 'smug';
    } else if (hole.state === 'hit') {
      emergence = 1 - easeOut(clamp((hole.age - 0.07) / 0.23, 0, 1));
      expression = 'squish';
      scaleX = 1.27;
      scaleY = 0.58;
      rotation = Math.sin(hole.age * 90) * 0.12;
    }
    if (emergence > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x - 130, y - 161, 260, 164);
      ctx.clip();
      const bodyY = y + 79 - emergence * 126;
      drawFrog(ctx, x, bodyY, 120, { expression, scaleX, scaleY, rotation });
      ctx.restore();
    }
    ctx.beginPath();
    ctx.ellipse(x, y + 1, 98, 27, 0, 0, Math.PI);
    ctx.strokeStyle = '#b1c68e';
    ctx.lineWidth = 9;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(x, y + 3, 85, 21, 0, 0.13, Math.PI - 0.13);
    ctx.strokeStyle = '#c4d5a6';
    ctx.lineWidth = 3;
    ctx.stroke();
    rounded(x - 109, y - 51, 27, 27, 9, '#f0f4df', '#c2d2a6');
    text(String(hole.key), x - 95, y - 37, 17, '#72865a');
  }

  function renderEffects() {
    for (const effect of effects) {
      const ratio = effect.age / effect.life;
      ctx.save();
      ctx.globalAlpha = Math.min(1, (1 - ratio) * 2);
      if (effect.type === 'text') {
        const y = effect.y - ratio * 39;
        ctx.font = `800 ${effect.large ? 34 : 21}px "PingFang SC", "Microsoft YaHei", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = effect.large ? 6 : 5;
        ctx.strokeStyle = '#f9fae9';
        ctx.strokeText(effect.label, effect.x, y);
        ctx.fillStyle = effect.color;
        ctx.fillText(effect.label, effect.x, y);
      } else {
        const x = effect.x + effect.vx * effect.age;
        const y = effect.y + effect.vy * effect.age + effect.age ** 2 * 180;
        ctx.translate(x, y);
        ctx.rotate(ratio * 4);
        rounded(-5, -5, 10, 10, 2, effect.color);
      }
      ctx.restore();
    }
  }

  function renderHammer() {
    if (!hammer) return;
    const progress = hammer.age / 0.3;
    ctx.save();
    ctx.globalAlpha = Math.min(1, (1 - progress) * 3);
    ctx.translate(hammer.x + 23, hammer.y - 9);
    ctx.rotate(-0.55 + Math.sin(progress * Math.PI) * 0.75);
    rounded(-8, 0, 16, 75, 7, '#bc9460', '#856b48');
    rounded(-41, -29, 83, 42, 13, '#f0a098', '#b56c65');
    rounded(-34, -23, 67, 11, 5, '#ffd0bc');
    text('呱', 0, -7, 18, '#8c514d');
    ctx.restore();
  }

  function render(time = elapsed) {
    ctx.save();
    background(time);
    holes.forEach((hole, index) => renderHole(hole, time, index));
    renderEffects();
    if (phase === 'playing' && cursor && !hammer) {
      ctx.beginPath();
      ctx.arc(cursor.x, cursor.y, 16, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(65,92,51,0.3)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    renderHammer();
    ctx.restore();
  }

  function pointerDown(point) {
    cursor = point;
    strike(point);
  }

  function pointerMove(point) {
    cursor = point;
  }

  function keyDown(event) {
    const key = event.key || event.code?.replace(/^(?:Digit|Numpad)/, '');
    if (phase !== 'playing' || event.repeat || !/^[1-9]$/.test(key)) return;
    event.preventDefault?.();
    const hole = holes[Number(key) - 1];
    strike({ x: hole.x, y: hole.y - 54 }, hole);
  }

  return {
    start,
    update,
    render,
    pointerDown,
    pointerMove,
    pointerUp() {},
    keyDown,
    destroy() {
      phase = 'destroyed';
      effects = [];
      hammer = null;
      cursor = null;
    },
    getState() {
      return {
        phase, score, timeLeft, combo, bestCombo, hits, escaped,
        holes: holes.map(({ key, x, y, state, age, duration, expression }) => ({ key, x, y, state, age, duration, expression })),
      };
    },
  };
}
