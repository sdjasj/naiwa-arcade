import { createGame as createFlappy } from './games/flappy.js';
import { createGame as createAngry, LEVELS } from './games/angry.js';
import { createGame as createWhack } from './games/whack.js';
import { createGame as createCatch } from './games/catch.js';
import { createGame as createJump } from './games/jump.js';
import { createGame as createMerge, FORMS, validSave } from './games/merge.js';
import { drawFrog, setFrogTime, frogReady, drawHero, drawCard } from './frog.js';
import { GameAudio } from './audio.js';

const $ = id => document.getElementById(id);
const definitions = {
  flappy: { factory: createFlappy, name: '奶蛙飞不动', modes: true, title: '肚子有点大，问题不大。', message: '点击屏幕或按空格，帮奶蛙躲过水管。', start: '开始扑腾', instruction: '翅膀很小，别放弃。', summary: '每穿过一组水管得 1 分，每 5 分抵达新景色。先试试轻松模式，再挑战更窄的水管！', keyboard: '空格 / ↑', keyboardDetail: '轻按一下，向上扑腾', touch: '点击 / 轻触', touchDetail: '点一下游戏画面，拍一下翅膀', quote: '“飞得不高没关系，笑得够大声就行。”', status: '小翅膀已就位，大肚子还没准备好。' },
  angry: { factory: createAngry, name: '愤怒的奶蛙', title: '退一步，弹得更远。', message: '向后拖动弹弓上的奶蛙，松手撞碎目标。', start: '开始发疯', instruction: '12 关，承包整片工地。', summary: '每关 3–5 发。击碎所有奶盒过关，剩余弹药越多，星级越高。通关后自动保存进度，可随时重玩已解锁关卡。', keyboard: '方向键 + 空格', keyboardDetail: '↑↓ 调角度，←→ 调力度，空格发射', touch: '按住 → 后拉 → 松手', touchDetail: '拖动弹弓上的奶蛙，蓄力发射', quote: '“我的情绪很稳定，只是偶尔飞出去。”', status: '选一座工地，把不开心全部弹走。' },
  whack: { factory: createWhack, name: '暴打奶蛙', modes: true, title: '手速跟上，奶蛙很嚣张。', message: '30 秒倒计时，点击冒出来的奶蛙！', start: '开始暴打', instruction: '金冠奶蛙，别让它跑了。', summary: '打中加分，连续命中有奖励。每第 7 只金冠奶蛙额外 +30 分。打空或让奶蛙逃走会中断连击。', keyboard: '数字键 1 – 9', keyboardDetail: '从左到右、从上到下对应九个洞', touch: '点击 / 轻触奶蛙', touchDetail: '奶蛙一冒头，就给它一下', quote: '“你打的是奶蛙，奶蛙笑的是你。”', status: '30 秒挑战 · 金冠蛙额外加分 · 连击有奖励' },
  catch: { factory: createCatch, name: '奶蛙接不住', title: '天上掉奶蛙了，接住！', message: '移动篮子接奶蛙，躲开黑色炸弹。', start: '开始接蛙', instruction: '接住快乐，放过炸弹。', summary: '挑战 8 波奶蛙雨，只有 3 条生命。接住金蛙和连续接取都有奖励；漏接奶蛙、接到炸弹会扣命。', keyboard: '← → / A D', keyboardDetail: '按住左右方向键，移动篮子', touch: '移动鼠标 / 触屏拖动', touchDetail: '篮子跟着你的手指或鼠标移动', quote: '“接住我！我肚子里装的全是快乐。”', status: '8 波挑战 · 3 条生命 · 接金蛙，躲炸弹' },
  jump: { factory: createJump, name: '奶蛙跳一跳', title: '蹲一下，跳出舒适圈。', message: '按住蓄力，松手起跳。看准落点再松手！', start: '开始蹦跶', instruction: '跳到中心，快乐加倍。', summary: '6 个阶段、30 座平台、3 条生命。蓄力条与落点预览帮你瞄准，落在中心有额外奖励；掉落后从最近的平台继续。', keyboard: '按住空格 → 松开', keyboardDetail: '蓄力决定距离，松开立即起跳', touch: '长按画面 → 松开', touchDetail: '看准绿色落点，稳稳跳到下一块', quote: '“肚子虽然重，但梦想很轻。”', status: '30 座平台 · 3 条生命 · 完美落点有奖励' },
  merge: { factory: createMerge, name: '奶蛙 2048', title: '从发呆，合到笑出声。', message: '滑动棋盘，将相同数字的奶蛙合成新形态。', start: '开始合成', instruction: '越合越大，越大越抽象。', summary: '从 2 的发呆蛙，一路合出 2048 狂笑蛙！相同数字才能合并，可撤销一步。进度自动保存，合出 2048 后还能继续冲蛙王。', keyboard: '方向键 / WASD', keyboardDetail: '整个棋盘向同一个方向移动', touch: '上下左右滑动', touchDetail: '也可用棋盘下方的方向按钮', quote: '“两个发呆的我，会变得更有精神吗？”', status: '滑动合并 · 撤销一步 · 自动保存 · 随时继续' },
};
const ids = Object.keys(definitions);
const read = (key, fallback) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
const write = (key, value) => { try { value === null ? localStorage.removeItem(key) : localStorage.setItem(key, String(value)); } catch { /* Storage is optional. */ } };
const readJSON = (key, fallback) => { try { return JSON.parse(read(key, 'null')) ?? fallback; } catch { return fallback; } };
const modes = ['easy', 'normal', 'hard'];
const modeNames = { easy: '轻松', normal: '标准', hard: '挑战' };
const difficulty = Object.fromEntries(['flappy', 'whack'].map(id => { const value = read(`naiwa:difficulty:${id}`, 'normal'); return [id, modes.includes(value) ? value : 'normal']; }));
function loadProgress() {
  const stored = readJSON('naiwa:progress:angry', {});
  const unlocked = Math.max(1, Math.min(LEVELS.length, Math.floor(Number(stored?.unlocked) || 1)));
  const stars = {};
  for (let i = 1; i <= LEVELS.length; i++) if ([1, 2, 3].includes(stored?.stars?.[i])) stars[i] = stored.stars[i];
  return { unlocked, stars };
}
let progress = loadProgress(), selectedLevel = progress.unlocked;
let soundEnabled = read('naiwa:sound', 'on') !== 'off';
const audio = new GameAudio(soundEnabled);
const canvas = $('game-canvas'), ctx = canvas.getContext('2d');
let activeId = 'flappy', game = null, state = 'ready', score = 0, gameTime = 0, lastResult = null;
let lastFrame = 0, accumulator = 0, activePointer = null;
let size = { width: 960, height: 560 };
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const bestKey = id => `naiwa:best:${id}${difficulty[id] && difficulty[id] !== 'normal' ? `:${difficulty[id]}` : ''}`;
const bestFor = id => { const value = Number(read(bestKey(id), 0)); return Number.isFinite(value) ? Math.max(0, value) : 0; };

const sidebar = document.querySelector('.game-sidebar');
for (const id of ['forms-panel-template', 'level-panel-template']) sidebar.prepend($(id).content.cloneNode(true));
const levelPanel = document.querySelector('.level-panel'), formsPanel = document.querySelector('.forms-panel');
for (const form of FORMS) {
  const item = document.createElement('div'), badge = document.createElement('b');
  badge.textContent = form.value; badge.style.background = form.color;
  item.append(badge, document.createTextNode(form.name)); $('forms-list').append(item);
}

function setSoundUI() {
  $('sound-toggle').setAttribute('aria-pressed', String(soundEnabled));
  $('sound-toggle').setAttribute('aria-label', soundEnabled ? '关闭音效' : '开启音效');
  $('sound-text').textContent = soundEnabled ? '音效开' : '音效关';
  $('sound-icon').textContent = soundEnabled ? '♫' : '♪';
}
function refreshBest() {
  $('best-score').replaceChildren(document.createTextNode(`${bestFor(activeId)} `), Object.assign(document.createElement('small'), { textContent: '分' }));
  document.querySelector('.best-score div>span').textContent = `${definitions[activeId].modes ? `${modeNames[difficulty[activeId]]} · ` : ''}我的最高纪录`;
}
function refreshPuzzleControls() {
  if (activeId !== 'merge' || !game) return;
  $('undo-button').disabled = state === 'ready' || state === 'paused' || !game.getState().canUndo;
  document.querySelectorAll('[data-direction]').forEach(button => { button.disabled = state !== 'playing'; });
}
function renderLevels() {
  const current = activeId === 'angry' && state !== 'ready' && game ? game.getState().level : selectedLevel;
  $('level-progress').textContent = `已解锁 ${progress.unlocked} / ${LEVELS.length} 关 · 共 ${Object.values(progress.stars).reduce((sum, n) => sum + n, 0)} 颗星`;
  $('level-grid').replaceChildren(...LEVELS.map((level, index) => {
    const number = index + 1, stars = progress.stars[number] || 0;
    const button = document.createElement('button');
    button.dataset.level = number; button.disabled = number > progress.unlocked;
    button.setAttribute('aria-label', `第 ${number} 关 ${level.name}${button.disabled ? '，尚未解锁' : `，${stars} 星`}`);
    button.setAttribute('aria-pressed', String(number === current));
    button.append(document.createTextNode(String(number)), Object.assign(document.createElement('span'), { textContent: button.disabled ? '—' : '★'.repeat(stars) + '☆'.repeat(3 - stars) }));
    button.addEventListener('click', () => selectGame('angry', false, number));
    return button;
  }));
  const chosen = LEVELS[current - 1] || LEVELS[0];
  $('selected-level').textContent = `${String(current).padStart(2, '0')} ${chosen.name} · ${chosen.shots} 发。${chosen.hint}`;
}
function setScore(value) {
  score = Math.max(0, Math.floor(value)); $('live-score').textContent = String(score);
  if (score > bestFor(activeId)) { write(bestKey(activeId), score); refreshBest(); }
  refreshPuzzleControls();
}
function showOverlay(kind, result) {
  const data = definitions[activeId];
  const saved = activeId === 'merge' ? readJSON('naiwa:save:merge', null) : null;
  const resumable = kind === 'ready' && validSave(saved);
  $('game-overlay').hidden = false; $('result-score').hidden = kind !== 'ended';
  $('overlay-kicker').textContent = { ready: resumable ? 'WELCOME BACK, FROGGY' : 'READY, FROGGY?', paused: 'TAKE YOUR TIME', ended: 'WELL PLAYED, FROGGY!' }[kind];
  $('overlay-title').textContent = result?.title ?? (kind === 'paused' ? '奶蛙也要歇一会儿。' : resumable ? '上次的奶蛙，还在等你。' : data.title);
  $('overlay-message').textContent = result?.message ?? (kind === 'paused' ? '准备好了就继续，你的这局还在。' : resumable ? `已经走了 ${saved.moves} 步，合到 ${Math.max(...saved.board)}。继续你的进化之旅。` : activeId === 'angry' ? `第 ${selectedLevel} 关 · ${LEVELS[selectedLevel - 1].name} · ${LEVELS[selectedLevel - 1].shots} 发机会` : data.message);
  const text = kind === 'paused' ? '继续游戏' : result?.canContinue ? '继续冲击 4096' : kind === 'ended' ? (activeId === 'angry' ? '重试这一关' : '再来一局') : resumable ? '继续上局' : data.start;
  $('start-button').replaceChildren(document.createTextNode(`${text} `), Object.assign(document.createElement('span'), { textContent: '→' }));
  $('overlay-hint').textContent = kind === 'ended' ? '没关系，奶蛙的快乐没有次数限制' : '准备好迎接奶蛙的魔性笑声';
  if (kind === 'ended') { $('result-value').textContent = String(result.score); $('start-button').focus({ preventScroll: true }); }
  refreshPuzzleControls();
}
function endGame(result) {
  if (state === 'ended') return;
  setScore(result.score); state = 'ended'; lastResult = result;
  if (activeId === 'angry' && result.level) selectedLevel = result.level;
  $('pause-button').disabled = true; showOverlay('ended', result);
  if (activeId === 'angry') renderLevels();
}
function clearInput() {
  game?.cancelInput?.();
  if (activePointer !== null) {
    game?.pointerUp?.({ x: -1, y: -1, cancelled: true });
    try { canvas.releasePointerCapture(activePointer); } catch { /* The pointer may already have ended. */ }
    activePointer = null;
  }
}
function resize() {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = size.width * ratio; canvas.height = size.height * ratio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}
function selectGame(id, scroll = false, levelOverride) {
  if (!definitions[id]) return;
  audio.stopAll(); clearInput(); game?.destroy(); game = null;
  activeId = id; state = 'ready'; gameTime = 0; accumulator = 0; lastResult = null;
  if (id === 'angry') { progress = loadProgress(); selectedLevel = Math.max(1, Math.min(progress.unlocked, levelOverride || progress.unlocked)); }
  const data = definitions[id];
  size = id === 'merge' ? { width: 560, height: 640 } : { width: 960, height: 560 };
  resize(); $('player-window').classList.toggle('puzzle-mode', id === 'merge');
  $('current-name').textContent = data.name; $('game-number').textContent = `${String(ids.indexOf(id) + 1).padStart(2, '0')} / 06`;
  $('instruction-title').textContent = data.instruction; $('instruction-summary').textContent = data.summary;
  $('keyboard-control').textContent = data.keyboard; $('keyboard-detail').textContent = data.keyboardDetail;
  $('touch-control').textContent = data.touch; $('touch-detail').textContent = data.touchDetail;
  $('frog-quote').textContent = data.quote; $('game-status').textContent = data.status;
  $('pause-button').disabled = true; $('pause-button').textContent = 'Ⅱ'; $('pause-button').setAttribute('aria-label', '暂停游戏');
  $('game-select').value = id; $('difficulty-setting').hidden = !data.modes;
  $('difficulty-select').value = difficulty[id] || 'normal';
  $('mode-note').textContent = data.modes ? '每种难度独立记录最高分' : id === 'angry' ? '通关保存星级，解锁下一关' : id === 'merge' ? '棋盘自动保存，下次接着玩' : '放轻松，奶蛙替你努力';
  $('puzzle-controls').hidden = id !== 'merge'; levelPanel.hidden = id !== 'angry'; formsPanel.hidden = id !== 'merge';
  canvas.setAttribute('aria-label', `${data.name}游戏区域。${data.message}`);
  document.querySelectorAll('[data-game]').forEach(button => { const selected = button.dataset.game === id; button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected)); });
  game = data.factory({
    canvas, ctx, ...size, drawFrog, audio, difficulty: difficulty[id] || 'normal', progress,
    savedGame: id === 'merge' ? readJSON('naiwa:save:merge', null) : null,
    onScore: setScore,
    onStatus: text => { $('game-status').textContent = text; if (activeId === 'angry' && game) renderLevels(); },
    onEnd: endGame,
    onProgress: value => { progress = value; write('naiwa:progress:angry', JSON.stringify(value)); renderLevels(); },
    onSave: value => { if (id === 'merge') write('naiwa:save:merge', value === null ? null : JSON.stringify(value)); },
  });
  setScore(0); refreshBest(); renderLevels(); showOverlay('ready');
  if (scroll) $('arcade').scrollIntoView({ behavior: reducedMotion ? 'instant' : 'smooth', block: 'start' });
}
function startGame({ restart = false } = {}) {
  audio.unlock(); audio.stopAll(); clearInput();
  const oldState = state;
  if (restart && activeId === 'angry' && oldState !== 'ready') selectedLevel = game.getState().level;
  state = 'playing';
  if (!restart && oldState === 'ended' && lastResult?.canContinue) game.continueGame();
  else if (restart || oldState !== 'paused') { gameTime = 0; game.start({ level: selectedLevel, fresh: restart || oldState === 'ended', difficulty: difficulty[activeId] || 'normal' }); }
  if (state === 'ended') return;
  lastResult = null; $('game-overlay').hidden = true; $('pause-button').disabled = false;
  $('pause-button').textContent = 'Ⅱ'; $('pause-button').setAttribute('aria-label', '暂停游戏');
  lastFrame = performance.now(); accumulator = 0; refreshPuzzleControls();
  if (activeId === 'angry') renderLevels();
  canvas.focus({ preventScroll: true });
}
function pause() {
  if (state !== 'playing') return;
  state = 'paused'; clearInput(); audio.stopAll(); accumulator = 0;
  $('pause-button').textContent = '▶'; $('pause-button').setAttribute('aria-label', '继续游戏'); showOverlay('paused');
}
function point(event) {
  const rect = canvas.getBoundingClientRect();
  const scale = Math.min(rect.width / size.width, rect.height / size.height);
  return { x: (event.clientX - rect.left - (rect.width - size.width * scale) / 2) / scale, y: (event.clientY - rect.top - (rect.height - size.height * scale) / 2) / scale };
}
canvas.addEventListener('pointerdown', event => {
  if (state !== 'playing' || activePointer !== null || (event.pointerType === 'mouse' && event.button !== 0)) return;
  event.preventDefault(); audio.unlock(); canvas.focus({ preventScroll: true });
  const p = point(event); if (p.x < 0 || p.x > size.width || p.y < 0 || p.y > size.height) return;
  activePointer = event.pointerId; canvas.setPointerCapture(event.pointerId); game.pointerDown?.(p);
});
canvas.addEventListener('pointermove', event => { if (state === 'playing' && (activePointer === null || event.pointerId === activePointer)) game.pointerMove?.(point(event)); });
canvas.addEventListener('pointerup', event => {
  if (event.pointerId !== activePointer) return;
  if (state === 'playing') game.pointerUp?.(point(event));
  activePointer = null; try { canvas.releasePointerCapture(event.pointerId); } catch {}
});
canvas.addEventListener('pointercancel', () => { if (activePointer !== null) pause(); });
document.addEventListener('keydown', event => {
  if ($('help-dialog').open || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.code === 'KeyP' || event.code === 'Escape') {
    if (event.repeat) return;
    if (state === 'playing') { event.preventDefault(); pause(); }
    else if (state === 'paused' && event.code === 'KeyP') { event.preventDefault(); startGame(); }
    return;
  }
  if (state === 'playing' && event.target === canvas && game.keyDown?.(event)) event.preventDefault();
});
document.addEventListener('keyup', event => { if (state === 'playing' && !$('help-dialog').open && game.keyUp?.(event)) event.preventDefault(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
window.addEventListener('blur', pause);
window.addEventListener('resize', resize);
document.querySelectorAll('[data-game]').forEach(button => button.addEventListener('click', () => selectGame(button.dataset.game, true)));
$('game-select').addEventListener('change', event => selectGame(event.target.value));
$('difficulty-select').addEventListener('change', event => { difficulty[activeId] = event.target.value; write(`naiwa:difficulty:${activeId}`, event.target.value); selectGame(activeId); });
$('start-button').addEventListener('click', () => startGame());
$('pause-button').addEventListener('click', () => state === 'paused' ? startGame() : pause());
$('restart-button').addEventListener('click', () => startGame({ restart: true }));
$('sound-toggle').addEventListener('click', () => { soundEnabled = !soundEnabled; write('naiwa:sound', soundEnabled ? 'on' : 'off'); audio.setEnabled(soundEnabled); if (soundEnabled) { audio.unlock(); audio.play('pop'); } setSoundUI(); });
document.querySelectorAll('[data-direction]').forEach(button => button.addEventListener('click', () => {
  if (activeId !== 'merge' || state !== 'playing') return;
  audio.unlock(); game.keyDown({ key: button.dataset.direction }); canvas.focus({ preventScroll: true }); refreshPuzzleControls();
}));
$('undo-button').addEventListener('click', () => {
  if (activeId !== 'merge' || !['playing', 'ended'].includes(state)) return;
  if (game.undo()) { state = 'playing'; lastResult = null; $('game-overlay').hidden = true; $('pause-button').disabled = false; $('pause-button').textContent = 'Ⅱ'; refreshPuzzleControls(); canvas.focus({ preventScroll: true }); }
});
let toastTimer;
function toast(message) { clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false; toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3500); }
$('fullscreen-button').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if ($('player-window').requestFullscreen) await $('player-window').requestFullscreen();
    else toast('此浏览器暂不支持全屏，可以横屏游玩。');
  } catch { toast('全屏未开启，可以直接横屏游玩。'); }
});
document.addEventListener('fullscreenchange', () => { $('fullscreen-button').setAttribute('aria-label', document.fullscreenElement ? '退出全屏' : '全屏游戏'); });
$('help-button').addEventListener('click', () => { pause(); $('help-dialog').showModal(); });
for (const id of ['close-help', 'help-done']) $(id).addEventListener('click', () => $('help-dialog').close());
$('help-dialog').addEventListener('click', event => { if (event.target === $('help-dialog')) { const r = event.target.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) event.target.close(); } });

setSoundUI(); selectGame('flappy');
const heroCtx = $('hero-canvas').getContext('2d');
let heroVisible = true;
new IntersectionObserver(entries => { heroVisible = entries[0].isIntersecting; }).observe($('hero-canvas'));
frogReady.then(() => { setFrogTime(.3); document.querySelectorAll('[data-art]').forEach(c => drawCard(c.getContext('2d'), c.dataset.art)); });
function frame(now) {
  const dt = Math.min(Math.max((now - lastFrame) / 1000, 0), .1); lastFrame = now;
  if (state === 'playing') {
    accumulator += dt;
    while (accumulator >= 1 / 120 && state === 'playing') { gameTime += 1 / 120; game.update(1 / 120); accumulator -= 1 / 120; }
  } else if (state === 'ready' && !reducedMotion) gameTime += dt;
  setFrogTime(gameTime); game.render(gameTime);
  if (!document.hidden && heroVisible) { setFrogTime(reducedMotion ? .3 : now / 1000); drawHero(heroCtx, reducedMotion ? .3 : now / 1000); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
if (new URLSearchParams(location.search).has('debug')) {
  Object.defineProperty(window, '__arcade', { value: { getState: () => ({ id: activeId, state, score, soundEnabled, difficulty: difficulty[activeId], selectedLevel, progress, game: game.getState() }) } });
}
