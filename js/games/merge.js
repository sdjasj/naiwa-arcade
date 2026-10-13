export const FORMS = [
  { value: 2, name: '发呆蛙', pose: 'idle', color: '#f6f1dc' },
  { value: 4, name: '招手蛙', pose: 'wave', color: '#e5efcf' },
  { value: 8, name: '小跑蛙', pose: 'run', color: '#d8ece5' },
  { value: 16, name: '害羞蛙', pose: 'shy', color: '#f4dfdd' },
  { value: 32, name: '思考蛙', pose: 'think', color: '#e1e1f3' },
  { value: 64, name: '不服蛙', pose: 'angry', color: '#f7d8b5' },
  { value: 128, name: '飞天蛙', pose: 'idle', wings: true, color: '#cfe7ee' },
  { value: 256, name: '犯困蛙', pose: 'sleep', color: '#d5dded' },
  { value: 512, name: '挺肚蛙', pose: 'smug', color: '#ecd2e1' },
  { value: 1024, name: '捧腹蛙', pose: 'belly', color: '#efd293' },
  { value: 2048, name: '狂笑蛙', pose: 'laugh', color: '#e9c55c' },
  { value: 4096, name: '奶蛙之王', pose: 'laugh', crown: true, color: '#c7d995' },
];
export const formFor = value => FORMS[Math.min(FORMS.length - 1, Math.max(0, Math.log2(value) - 1))];

function boardSize(board, requested) {
  if (!Array.isArray(board)) return 0;
  const size = requested ?? Math.sqrt(board.length);
  return (size === 4 || size === 6) && board.length === size * size ? size : 0;
}

export function slideBoard(board, direction, requestedSize) {
  const size = boardSize(board, requestedSize);
  const result = Array(size * size).fill(0), motions = [], merges = [];
  let score = 0;
  if (!size || !['left', 'right', 'up', 'down'].includes(direction)) return { board: Array.isArray(board) ? [...board] : [], score, moved: false, motions, merges };
  for (let line = 0; line < size; line++) {
    const indices = Array.from({ length: size }, (_, n) => {
      if (direction === 'left') return line * size + n;
      if (direction === 'right') return line * size + size - 1 - n;
      if (direction === 'up') return n * size + line;
      return (size - 1 - n) * size + line;
    });
    const cells = indices.filter(i => board[i]).map(i => ({ index: i, value: board[i] }));
    for (let i = 0, destination = 0; i < cells.length; destination++) {
      const first = cells[i++], second = cells[i], to = indices[destination];
      motions.push({ from: first.index, to, value: first.value });
      if (second?.value === first.value) {
        result[to] = first.value * 2; score += result[to];
        motions.push({ from: second.index, to, value: second.value });
        merges.push({ index: to, value: result[to] }); i++;
      } else result[to] = first.value;
    }
  }
  return { board: result, score, moved: result.some((v, i) => v !== board[i]), motions, merges };
}

export function canMove(board, requestedSize) {
  const size = boardSize(board, requestedSize);
  return Boolean(size && board.some((value, i) => !value || (i % size < size - 1 && value === board[i + 1]) || (i < size * (size - 1) && value === board[i + size])));
}

export function validSave(save, expectedSize = 4) {
  return Boolean((expectedSize === 4 || expectedSize === 6)
    && save && typeof save === 'object' && !Array.isArray(save) && Array.isArray(save.board) && save.board.length === expectedSize * expectedSize
    && (save.gridSize === expectedSize || (expectedSize === 4 && save.gridSize === undefined))
    && save.board.some(Boolean) && Array.from(save.board).every(v => Number.isSafeInteger(v) && (v === 0 || (v >= 2 && v <= 2 ** 30 && Number.isInteger(Math.log2(v)))))
    && Number.isSafeInteger(save.score) && save.score >= 0 && save.score < 2 ** 40
    && Number.isSafeInteger(save.moves) && save.moves >= 0 && save.moves < 1e9
    && (save.won === undefined || typeof save.won === 'boolean')
    && (save.won !== true || save.board.some(v => v >= 2048)));
}

export function createGame(env) {
  const { ctx, drawFrog, audio, onScore, onStatus, onEnd, onSave } = env;
  const width = env.width || 560, height = env.height || 640;
  const gridSize = env.gridSize === 6 ? 6 : 4, count = gridSize * gridSize;
  const side = Math.min(width - 64, height - 144), left = (width - side) / 2, top = 108;
  const gap = gridSize === 6 ? 6 : 9, cell = (side - gap * (gridSize + 1)) / gridSize;
  let board = Array(count).fill(0), score = 0, moves = 0, phase = 'idle';
  let previous = null, transition = null, queued = null, pointer = null, won = false, resultSent = false, invalidFlash = 0, pendingSettlement = false;
  // A save may have been written just before a move's animation finished. Keep
  // its exact board, even if it needs a milestone or game-over on the next frame.
  const saved = validSave(env.savedGame, gridSize) ? { board: [...env.savedGame.board], score: env.savedGame.score, moves: env.savedGame.moves, won: env.savedGame.won === true } : null;

  function status(message) { onStatus?.(message); }
  function save() { onSave?.({ board: [...board], score, moves, won, gridSize }); }
  function spawn() {
    const empty = board.map((v, i) => v ? -1 : i).filter(i => i >= 0);
    if (!empty.length) return -1;
    const index = empty[Math.min(empty.length - 1, Math.floor(Math.random() * empty.length))];
    board[index] = Math.random() < .9 ? 2 : 4;
    return index;
  }
  function start(options = {}) {
    const resume = phase === 'idle' && !options.fresh && saved;
    board = resume ? [...saved.board] : Array(count).fill(0);
    score = resume ? saved.score : 0; moves = resume ? saved.moves : 0; won = resume ? Boolean(saved.won) : false;
    previous = null; transition = null; queued = null; pointer = null; resultSent = false; invalidFlash = 0; phase = 'playing';
    pendingSettlement = Boolean(resume);
    if (!resume) { spawn(); spawn(); }
    onScore?.(score); save();
    status(resume ? `${gridSize}×${gridSize} · 接着上次继续合成吧！方向键 / 滑动，同形奶蛙会升级。` : `${gridSize}×${gridSize} · 方向键 / WASD / 滑动 · 相同数字合并 · 可撤销一步`);
  }
  function settle() {
    if (!won && board.some(v => v >= 2048)) {
      won = true; phase = 'won'; queued = null; save(); audio?.play('laugh'); audio?.play('win');
      onEnd?.({ score, gridSize, title: '狂笑奶蛙，合成成功！', message: `${gridSize}×${gridSize} · 2048 达成！奶蛙笑到停不下来，继续冲击 4096 蛙王吧。`, won: true, canContinue: true });
    } else if (!canMove(board, gridSize) && !resultSent) {
      phase = 'ended'; resultSent = true; queued = null; onSave?.(null); audio?.play('laugh');
      onEnd?.({ score, gridSize, title: '蛙满为患，挤不下啦。', message: `${gridSize}×${gridSize} · 用 ${moves} 步合成了 ${Math.max(...board)}！留一个空位给下一只奶蛙，再来一次。`, won: false });
    }
  }
  function move(direction) {
    if (phase !== 'playing') return false;
    if (transition) { queued = direction; return true; }
    const next = slideBoard(board, direction, gridSize);
    if (!next.moved) { invalidFlash = .15; settle(); return false; }
    previous = { board: [...board], score, moves, won };
    board = next.board; score += next.score; moves++;
    const spawned = spawn();
    transition = { age: 0, duration: .13, motions: next.motions, spawned, merges: next.merges };
    onScore?.(score); save(); audio?.play(next.score ? 'score' : 'pop');
    if (next.score) {
      const max = Math.max(...next.merges.map(item => item.value));
      status(`${formFor(max).name} ${max} 登场！+${next.score} 分 · 已走 ${moves} 步`);
      if (max >= 128) audio?.play('laugh');
    }
    return true;
  }
  function undo() {
    if (!previous || phase === 'idle') return false;
    ({ score, moves, won } = previous); board = [...previous.board]; previous = null;
    transition = null; queued = null; pointer = null; resultSent = false; phase = 'playing';
    pendingSettlement = true;
    onScore?.(score); save(); audio?.play('pop'); status('时间倒流了一步，奶蛙假装什么都没发生。'); return true;
  }
  function update(dt) {
    dt = Number.isFinite(dt) ? Math.max(0, Math.min(dt, .1)) : 0;
    invalidFlash = Math.max(0, invalidFlash - dt);
    if (phase !== 'playing') return;
    if (pendingSettlement && !transition) { pendingSettlement = false; settle(); }
    if (phase !== 'playing' || !transition) return;
    transition.age += dt;
    if (transition.age >= transition.duration) {
      transition = null; pendingSettlement = false; settle();
      if (queued && phase === 'playing') { const next = queued; queued = null; move(next); }
    }
  }
  function box(x, y, w, h, r, color) { ctx.fillStyle = color; ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill(); }
  function label(text, x, y, size, color, align = 'left', weight = 600) {
    ctx.font = `${weight} ${size}px "Noto Sans CJK SC", "Microsoft YaHei", sans-serif`; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillStyle = color; ctx.fillText(text, x, y);
  }
  function cellPoint(index) { return { x: left + gap + (index % gridSize) * (cell + gap), y: top + gap + Math.floor(index / gridSize) * (cell + gap) }; }
  function tile(value, x, y, scale = 1) {
    const form = formFor(value);
    const compact = gridSize === 6;
    ctx.save(); ctx.translate(x + cell / 2, y + cell / 2); ctx.scale(scale, scale); ctx.translate(-cell / 2, -cell / 2);
    box(0, 0, cell, cell, compact ? 8 : 10, form.color);
    if (!compact) label(form.name, cell / 2, 13, 11, '#697650', 'center');
    const frogY = compact ? (form.crown ? .44 : .43) : (form.crown ? .52 : .49);
    const frogSize = compact ? (form.crown ? .35 : .42) : (form.crown ? .32 : .37);
    drawFrog(ctx, cell / 2, cell * frogY, cell * frogSize, { pose: form.pose, wings: form.wings, crown: form.crown, wingPhase: 0 });
    const number = String(value);
    const fontSize = Math.min(compact ? (value >= 1000 ? 18 : 21) : 23, (cell - 12) / (number.length * .65));
    label(number, cell / 2, cell - (compact ? 12 : 15), fontSize, '#34442b', 'center', 900);
    ctx.restore();
  }
  function render(time = 0) {
    ctx.save(); ctx.fillStyle = '#f2f3e9'; ctx.fillRect(0, 0, width, height);
    label('合成一只狂笑奶蛙', left, 33, 25, '#34442b', 'left', 800);
    label(`${gridSize} × ${gridSize} · 同形相遇，就会变得更抽象。`, left, 64, 13, '#819171');
    label(`${phase === 'idle' && saved ? saved.moves : moves} 步`, left + side, 33, 16, '#607447', 'right');
    label(`最高 ${Math.max(2, ...(phase === 'idle' && saved ? saved.board : board))}`, left + side, 64, 14, '#819171', 'right');
    box(left, top, side, side, 17, invalidFlash > 0 ? '#b5bda8' : '#c8d1b8');
    for (let i = 0; i < count; i++) { const p = cellPoint(i); box(p.x, p.y, cell, cell, gridSize === 6 ? 8 : 10, '#e4e9d8'); }
    if (phase === 'idle') {
      const demo = gridSize === 4 ? [2, 4, 8, 0, 16, 32, 0, 0, 64, 128, 256, 0, 512, 1024, 2048, 0] : Array(count).fill(0);
      if (gridSize === 6) FORMS.forEach((form, i) => { const row = Math.floor(i / 3) + 1; demo[row * gridSize + (i % 3) * 2 + row % 2] = form.value; });
      const preview = saved?.board || demo;
      preview.forEach((v, i) => { if (v) { const p = cellPoint(i); tile(v, p.x, p.y); } });
    } else if (transition) {
      const progress = Math.min(1, transition.age / transition.duration), ease = 1 - (1 - progress) ** 3;
      for (const item of transition.motions) {
        const from = cellPoint(item.from), to = cellPoint(item.to);
        tile(item.value, from.x + (to.x - from.x) * ease, from.y + (to.y - from.y) * ease);
      }
      if (transition.spawned >= 0) { const p = cellPoint(transition.spawned); tile(board[transition.spawned], p.x, p.y, .65 + progress * .35); }
    } else board.forEach((v, i) => { if (v) { const p = cellPoint(i); tile(v, p.x, p.y); } });
    label('2 → 4 → 8 → … → 2048 · 每一步都有新蛙', width / 2, top + side + 20, 12, '#7e8d6c', 'center');
    ctx.restore();
  }
  const keyDirections = { ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right', ArrowUp: 'up', w: 'up', W: 'up', ArrowDown: 'down', s: 'down', S: 'down' };
  return {
    start, update, render, undo,
    continueGame() { if (phase !== 'won') return false; phase = 'playing'; status('2048 已达成，向 4096 奶蛙之王进发！'); settle(); return true; },
    pointerDown(p) { if (phase === 'playing' && Number.isFinite(p?.x) && Number.isFinite(p?.y) && p.x >= left && p.x <= left + side && p.y >= top && p.y <= top + side) pointer = { ...p }; },
    pointerMove() {},
    pointerUp(p) {
      const from = pointer; pointer = null;
      if (!from || p?.cancelled || !Number.isFinite(p?.x) || !Number.isFinite(p?.y)) return;
      const dx = p.x - from.x, dy = p.y - from.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 22) return;
      move(Math.abs(dx) > Math.abs(dy) ? dx > 0 ? 'right' : 'left' : dy > 0 ? 'down' : 'up');
    },
    keyDown(event) { const direction = keyDirections[event.key]; if (!direction) return false; if (!event.repeat) move(direction); return true; },
    keyUp() {},
    cancelInput() { pointer = null; queued = null; },
    destroy() { phase = 'idle'; pointer = null; transition = null; queued = null; pendingSettlement = false; },
    getState() { return { phase, gridSize, board: [...board], score, moves, canUndo: Boolean(previous), won, maxTile: Math.max(2, ...board), transitioning: Boolean(transition), savedAvailable: Boolean(saved), boardRect: { x: left, y: top, side, cell, gap } }; },
  };
}
