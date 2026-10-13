import { createGame as createFlappy } from './games/flappy.js';
import { createGame as createAngry } from './games/angry.js';
import { createGame as createWhack } from './games/whack.js';
import { drawFrog, setFrogTime, frogReady, drawHero, drawCard } from './frog.js';
import { GameAudio } from './audio.js';

const $ = id => document.getElementById(id);
const definitions = {
  flappy: { factory: createFlappy, name: '奶蛙飞不动', number: '01', title: '肚子有点大，问题不大。', message: '点击屏幕或按空格，帮奶蛙躲过水管。', start: '开始扑腾', instruction: '翅膀很小，别放弃。', summary: '连续拍翅，穿过水管。每过一组得 1 分，撞到就会被挤成奶蛙饼。', keyboard: '空格 / ↑', keyboardDetail: '轻按一下，向上扑腾', touch: '点击 / 轻触', touchDetail: '点一下游戏画面，拍一下翅膀', quote: '“飞得不高没关系，笑得够大声就行。”', status: '小翅膀已就位，大肚子还没准备好。' },
  angry: { factory: createAngry, name: '愤怒的奶蛙', number: '02', title: '退一步，弹得更远。', message: '向后拖动弹弓上的奶蛙，松手撞碎目标。', start: '开始发疯', instruction: '把烦恼一口气弹走。', summary: '击碎全部目标，挑战 3 个关卡。每关 3 发，瞄准木架，让建筑一起倒下！', keyboard: '方向键 + 空格', keyboardDetail: '↑↓ 调角度，←→ 调力度，空格发射', touch: '按住 → 后拉 → 松手', touchDetail: '拖动弹弓上的奶蛙，蓄力发射', quote: '“我的情绪很稳定，只是偶尔飞出去。”', status: '每关 3 发 · 拖动奶蛙蓄力 · 击碎全部目标过关' },
  whack: { factory: createWhack, name: '暴打奶蛙', number: '03', title: '手速跟上，奶蛙很嚣张。', message: '30 秒倒计时，点击冒出来的奶蛙！', start: '开始暴打', instruction: '别让它笑到最后。', summary: '奶蛙从九个洞里随机冒头，打中加分，连续命中有奖励。打空会中断连击。', keyboard: '数字键 1 – 9', keyboardDetail: '从左到右、从上到下对应九个洞', touch: '点击 / 轻触奶蛙', touchDetail: '奶蛙一冒头，就给它一下', quote: '“你打的是奶蛙，奶蛙笑的是你。”', status: '30 秒挑战 · 打中加分 · 连击有奖励' },
};

const read = (key, fallback) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
const write = (key, value) => { try { localStorage.setItem(key, String(value)); } catch { /* Private mode still allows play. */ } };
let soundEnabled = read('naiwa:sound', 'on') !== 'off';
const audio = new GameAudio(soundEnabled);
const canvas = $('game-canvas');
const ctx = canvas.getContext('2d');
let activeId = 'flappy', game = null, state = 'ready', score = 0, gameTime = 0;
let lastFrame = 0, activePointer = null;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const bestFor = id => Math.max(0, Number(read(`naiwa:best:${id}`, 0)) || 0);

function setSoundUI() {
  $('sound-toggle').setAttribute('aria-pressed', String(soundEnabled));
  $('sound-toggle').setAttribute('aria-label', soundEnabled ? '关闭音效' : '开启音效');
  $('sound-text').textContent = soundEnabled ? '音效开' : '音效关';
  $('sound-icon').textContent = soundEnabled ? '♫' : '♪';
}

function refreshBest() { $('best-score').replaceChildren(document.createTextNode(`${bestFor(activeId)} `), Object.assign(document.createElement('small'), { textContent: '分' })); }
function setScore(value) {
  score = Math.max(0, Math.floor(value));
  $('live-score').textContent = String(score);
  if (score > bestFor(activeId)) { write(`naiwa:best:${activeId}`, score); refreshBest(); }
}

function showOverlay(kind, result) {
  const data = definitions[activeId];
  $('game-overlay').hidden = false;
  $('result-score').hidden = kind !== 'ended';
  $('overlay-kicker').textContent = { ready: 'READY, FROGGY?', paused: 'TAKE YOUR TIME', ended: 'WELL PLAYED, FROGGY!' }[kind];
  $('overlay-title').textContent = result?.title ?? (kind === 'paused' ? '奶蛙也要歇一会儿。' : data.title);
  $('overlay-message').textContent = result?.message ?? (kind === 'paused' ? '准备好了就继续，你的这局还在。' : data.message);
  $('start-button').replaceChildren(document.createTextNode(kind === 'paused' ? '继续游戏 ' : kind === 'ended' ? '再来一局 ' : `${data.start} `), Object.assign(document.createElement('span'), { textContent: '→' }));
  $('overlay-hint').textContent = kind === 'ended' ? '没关系，奶蛙的快乐没有次数限制' : '准备好迎接奶蛙的魔性笑声';
  if (kind === 'ended') { $('result-value').textContent = String(result.score); $('start-button').focus({ preventScroll: true }); }
}

function endGame(result) {
  if (state === 'ended') return;
  setScore(result.score);
  state = 'ended';
  $('pause-button').disabled = true;
  showOverlay('ended', result);
}

function selectGame(id, scroll = false) {
  if (!definitions[id]) return;
  audio.stopAll();
  if (activePointer !== null) { try { canvas.releasePointerCapture(activePointer); } catch {} activePointer = null; }
  game?.destroy();
  activeId = id; state = 'ready'; gameTime = 0;
  const data = definitions[id];
  $('current-name').textContent = data.name;
  $('game-number').textContent = `${data.number} / 03`;
  $('instruction-title').textContent = data.instruction;
  $('instruction-summary').textContent = data.summary;
  $('keyboard-control').textContent = data.keyboard;
  $('keyboard-detail').textContent = data.keyboardDetail;
  $('touch-control').textContent = data.touch;
  $('touch-detail').textContent = data.touchDetail;
  $('frog-quote').textContent = data.quote;
  $('game-status').textContent = data.status;
  $('pause-button').disabled = true;
  $('pause-button').textContent = 'Ⅱ';
  $('pause-button').setAttribute('aria-label', '暂停游戏');
  canvas.setAttribute('aria-label', `${data.name}游戏区域。${data.message}`);
  document.querySelectorAll('[data-game]').forEach(button => {
    const selected = button.dataset.game === id;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  game = data.factory({ canvas, ctx, width: 960, height: 560, drawFrog, audio, onScore: setScore, onStatus: text => { $('game-status').textContent = text; }, onEnd: endGame });
  setScore(0); refreshBest(); showOverlay('ready');
  if (scroll) $('arcade').scrollIntoView({ behavior: reducedMotion ? 'instant' : 'smooth', block: 'start' });
}

function startGame() {
  audio.unlock(); audio.stopAll();
  if (state !== 'paused') { gameTime = 0; state = 'playing'; game.start(); }
  else state = 'playing';
  $('game-overlay').hidden = true;
  $('pause-button').disabled = false;
  $('pause-button').textContent = 'Ⅱ';
  $('pause-button').setAttribute('aria-label', '暂停游戏');
  lastFrame = performance.now();
  canvas.focus({ preventScroll: true });
}

function pause() {
  if (state !== 'playing') return;
  state = 'paused'; audio.stopAll();
  // Cancel an in-progress drag before hiding the board.
  if (activePointer !== null) { game.pointerUp?.({ x: -1, y: -1, cancelled: true }); try { canvas.releasePointerCapture(activePointer); } catch {} activePointer = null; }
  $('pause-button').textContent = '▶';
  $('pause-button').setAttribute('aria-label', '继续游戏');
  showOverlay('paused');
}

function point(event) {
  const rect = canvas.getBoundingClientRect();
  const scale = Math.min(rect.width / 960, rect.height / 560);
  return { x: (event.clientX - rect.left - (rect.width - 960 * scale) / 2) / scale, y: (event.clientY - rect.top - (rect.height - 560 * scale) / 2) / scale };
}

canvas.addEventListener('pointerdown', event => {
  if (state !== 'playing' || activePointer !== null || (event.pointerType === 'mouse' && event.button !== 0)) return;
  event.preventDefault(); audio.unlock(); canvas.focus({ preventScroll: true });
  const p = point(event); if (p.x < 0 || p.x > 960 || p.y < 0 || p.y > 560) return;
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
    if (state === 'playing') { event.preventDefault(); pause(); }
    else if (state === 'paused' && event.code === 'KeyP') { event.preventDefault(); startGame(); }
    return;
  }
  if (state === 'playing' && event.target === canvas && game.keyDown?.(event)) event.preventDefault();
});
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
window.addEventListener('blur', pause);
document.querySelectorAll('[data-game]').forEach(button => button.addEventListener('click', () => selectGame(button.dataset.game, true)));
$('start-button').addEventListener('click', startGame);
$('pause-button').addEventListener('click', () => state === 'paused' ? startGame() : pause());
$('restart-button').addEventListener('click', () => { selectGame(activeId); startGame(); });
$('sound-toggle').addEventListener('click', () => { soundEnabled = !soundEnabled; write('naiwa:sound', soundEnabled ? 'on' : 'off'); audio.setEnabled(soundEnabled); if (soundEnabled) { audio.unlock(); audio.play('pop'); } setSoundUI(); });

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

function resize() {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = 960 * ratio; canvas.height = 560 * ratio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}
window.addEventListener('resize', resize);
resize(); setSoundUI(); selectGame('flappy');
const heroCtx = $('hero-canvas').getContext('2d');
frogReady.then(() => { document.querySelectorAll('[data-art]').forEach(c => drawCard(c.getContext('2d'), c.dataset.art)); });
function frame(now) {
  const dt = Math.min(Math.max((now - lastFrame) / 1000, 0), 1 / 30); lastFrame = now;
  if (state === 'playing') { gameTime += dt; game.update(dt); }
  else if (state === 'ready' && !reducedMotion) gameTime += dt;
  setFrogTime(gameTime); game.render(gameTime);
  if (!document.hidden) { setFrogTime(reducedMotion ? .3 : now / 1000); drawHero(heroCtx, reducedMotion ? .3 : now / 1000); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Read-only state inspection for automated gameplay checks; absent in normal visits.
if (new URLSearchParams(location.search).has('debug')) {
  Object.defineProperty(window, '__arcade', { value: { getState: () => ({ id: activeId, state, score, soundEnabled, game: game.getState() }) } });
}
