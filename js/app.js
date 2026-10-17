import { createGame as createFlappy } from './games/flappy.js?v=5593d280b2fe';
import { createGame as createAngry, LEVELS } from './games/angry.js?v=5593d280b2fe';
import { createGame as createWhack } from './games/whack.js?v=5593d280b2fe';
import { createGame as createCatch } from './games/catch.js?v=5593d280b2fe';
import { createGame as createJump } from './games/jump.js?v=5593d280b2fe';
import { createGame as createMerge, FORMS, validSave } from './games/merge.js?v=5593d280b2fe';
import { createGame as createFighter } from './games/fighter.js?v=5593d280b2fe';
import { createGame as createSurvivor } from './games/survivor.js?v=5593d280b2fe';
import { createGame as createBomber } from './games/bomber.js?v=5593d280b2fe';
import { createGame as createAim } from './games/aim.js?v=5593d280b2fe';
import { createGame as createGuandan } from './games/guandan.js?v=5593d280b2fe';
import { createGuandanUI } from './guandan-ui.js?v=5593d280b2fe';
import { createTouchControls } from './controls.js?v=5593d280b2fe';
import { drawFrog, setFrogTime, frogReady, frogAnimationStatus, drawHero, drawCard } from './frog.js?v=5593d280b2fe';
import { GameAudio } from './audio.js?v=5593d280b2fe';
import { createLeaderboardClient } from './leaderboard-client.js?v=5593d280b2fe';
import { createLeaderboardUI } from './leaderboard-ui.js?v=5593d280b2fe';
import { parseBoard } from './leaderboard-rules.js?v=5593d280b2fe';

const $ = id => document.getElementById(id);
const definitions = {
  flappy: { factory: createFlappy, name: '奶蛙飞不动', modes: true, title: '肚子有点大，问题不大。', message: '点击屏幕或按空格，帮奶蛙躲过水管。', start: '开始扑腾', instruction: '翅膀很小，别放弃。', summary: '每穿过一组水管得 1 分，每 5 分抵达新景色。先试试轻松模式，再挑战更窄的水管！', keyboard: '空格 / ↑', keyboardDetail: '轻按一下，向上扑腾', touch: '点击 / 轻触', touchDetail: '点一下游戏画面，拍一下翅膀', quote: '“飞得不高没关系，笑得够大声就行。”', status: '小翅膀已就位，大肚子还没准备好。' },
  angry: { factory: createAngry, name: '愤怒的奶蛙', title: '退一步，弹得更远。', message: '向后拖动弹弓上的奶蛙，松手撞碎目标。', start: '开始发疯', instruction: '12 关，承包整片工地。', summary: '每关 3–5 发。击碎所有奶盒过关，剩余弹药越多，星级越高。通关后自动保存进度，可随时重玩已解锁关卡。', keyboard: '方向键 + 空格', keyboardDetail: '↑↓ 调角度，←→ 调力度，空格发射', touch: '按住 → 后拉 → 松手', touchDetail: '拖动弹弓上的奶蛙，蓄力发射', quote: '“我的情绪很稳定，只是偶尔飞出去。”', status: '选一座工地，把不开心全部弹走。' },
  whack: { factory: createWhack, name: '暴打奶蛙', modes: true, title: '手速跟上，奶蛙很嚣张。', message: '30 秒倒计时，点击冒出来的奶蛙！', start: '开始暴打', instruction: '金冠奶蛙，别让它跑了。', summary: '打中加分，连续命中有奖励。每第 7 只金冠奶蛙额外 +30 分。打空或让奶蛙逃走会中断连击。', keyboard: '数字键 1 – 9', keyboardDetail: '从左到右、从上到下对应九个洞', touch: '点击 / 轻触奶蛙', touchDetail: '奶蛙一冒头，就给它一下', quote: '“你打的是奶蛙，奶蛙笑的是你。”', status: '30 秒挑战 · 金冠蛙额外加分 · 连击有奖励' },
  catch: { factory: createCatch, name: '奶蛙接不住', title: '天上掉奶蛙了，接住！', message: '移动篮子接奶蛙，躲开黑色炸弹。', start: '开始接蛙', instruction: '接住快乐，放过炸弹。', summary: '挑战 8 波奶蛙雨，只有 3 条生命。接住金蛙和连续接取都有奖励；漏接奶蛙、接到炸弹会扣命。', keyboard: '← → / A D', keyboardDetail: '按住左右方向键，移动篮子', touch: '移动鼠标 / 触屏拖动', touchDetail: '篮子跟着你的手指或鼠标移动', quote: '“接住我！我肚子里装的全是快乐。”', status: '8 波挑战 · 3 条生命 · 接金蛙，躲炸弹' },
  jump: { factory: createJump, name: '奶蛙跳一跳', title: '蹲一下，跳出舒适圈。', message: '按住蓄力，松手起跳。看准落点再松手！', start: '开始蹦跶', instruction: '跳到中心，快乐加倍。', summary: '6 个阶段、30 座平台、3 条生命。蓄力条与落点预览帮你瞄准，落在中心有额外奖励；掉落后从最近的平台继续。', keyboard: '按住空格 → 松开', keyboardDetail: '蓄力决定距离，松开立即起跳', touch: '长按画面 → 松开', touchDetail: '看准绿色落点，稳稳跳到下一块', quote: '“肚子虽然重，但梦想很轻。”', status: '30 座平台 · 3 条生命 · 完美落点有奖励' },
  merge: { factory: createMerge, name: '奶蛙 2048', title: '从发呆，合到笑出声。', message: '滑动棋盘，将相同数字的奶蛙合成新形态。', start: '开始合成', instruction: '越合越大，越大越抽象。', summary: '从 2 的发呆蛙，一路合出 2048 狂笑蛙！相同数字才能合并，可撤销一步。进度自动保存，合出 2048 后还能继续冲蛙王。', keyboard: '方向键 / WASD', keyboardDetail: '整个棋盘向同一个方向移动', touch: '上下左右滑动', touchDetail: '也可用棋盘下方的方向按钮', quote: '“两个发呆的我，会变得更有精神吗？”', status: '滑动合并 · 撤销一步 · 自动保存 · 随时继续' },
  fighter: { factory: createFighter, name: '奶蛙大乱斗', title: '跳起来，也要笑着出拳。', message: '经典格斗规则：四键攻击、跑跳翻滚、方向防御与能量必杀。', start: '上台开打', instruction: '跳攻接地面，连段笑出声。', summary: '参考拳皇 98 ADVANCED：前后步法、四种跳跃、站蹲与空中四键攻击。低段蹲防，跳攻站防，命中后接必杀；积攒能量豆，爆气再放超必杀。闯关、无限、双人或练习室随你选。', keyboard: 'AD / W S · J U K I', keyboardDetail: '移动跳蹲 · 轻拳/轻脚/重拳/重脚；L 防御', touch: '方向 + 九个动作键', touchDetail: '同时按跳跃与攻击，向前后连点两次有不同步法', quote: '“别打脸，我还要负责笑。”', status: '98 风格 · 四键攻击 · 跳攻连段 · 练习室可看判定' },
  survivor: { factory: createSurvivor, name: '奶蛙幸存者', title: '笑到最后的，才是奶蛙。', message: '移动躲开围攻，自动攻击。拾取经验，选择升级，挑战首领！', start: '开始生存', instruction: '越被包围，笑得越大声。', summary: '攻击会自动瞄准敌人，你负责走位和拾取经验。升级时从 3 个强化中选择一个，搭配笑声、震波和旋转奶瓶。坚持 3 分钟并击败首领即可通关。', keyboard: 'WASD / 方向键 · 空格', keyboardDetail: '移动 · 冲刺；数字 1–3 选择升级', touch: '方向键 + 冲刺', touchDetail: '升级时点击画面中的强化卡片', quote: '“这么多人，都是来听我笑的吗？”', status: '自动攻击 · 升级三选一 · 3 分钟首领挑战' },
  bomber: { factory: createBomber, name: '奶蛙炸弹人', title: '放个笑气弹，记得跑。', message: '炸开箱子收集道具，躲开十字爆炸，清场后找到出口。', start: '开始拆箱', instruction: '笑声会传染，炸弹会连锁。', summary: '共 6 关迷宫，炸开木箱获得火力、容量和速度道具。清除对手再进入出口；放弹后及时绕到墙后，十字爆炸也会伤到自己。支持无限迷宫与同键盘双人对战。', keyboard: 'WASD / 方向键 · 空格', keyboardDetail: '移动 · 放置笑气弹', touch: '方向键 + 放炸弹', touchDetail: '可以边走边放弹，留好撤退路线', quote: '“我只是想让整个房间都笑起来。”', status: '6 关迷宫 · 连锁爆炸 · 道具强化 · 支持双人' },
  aim: { factory: createAim, name: '奶蛙瞄准实验室', modes: true, title: '准星稳住，奶蛙忍住笑。', message: '三秒准备后开始。点击小球，或按住射击跟随移动目标。', start: '开始练枪', instruction: '先求准，再求快。', summary: '三球速点练目标切换，精准甩枪练小目标，跟枪追踪练持续控枪。60 秒挑战或无限练习，三档难度。结束后查看命中率、平均耗时和训练得分。', keyboard: '鼠标左键 · Esc / P', keyboardDetail: '射击 · 暂停释放鼠标；Enter 结束训练', touch: '点击球 / 按住跟随', touchDetail: '手机选择点击模式；跟枪需要按住目标移动', quote: '“你瞄的是小球，奶蛙笑的是空枪。”', status: '三种训练 · 60 秒 / 无限 · 命中率与反应统计' },
  guandan: { factory: createGuandan, name: '奶蛙掼蛋', title: '对家是队友，笑声是对手。', message: '单人即可开桌：你和上方 AI 奶蛙组队，对战左右两名 AI。点选手牌后出牌。', start: '入座开打', instruction: '好牌一起打，笑声一起扛。', summary: '你 + 三名 AI，双副 108 张、每人 27 张，对家合作。红桃级牌可百搭，支持顺子、连对、钢板、炸弹和同花顺。提示帮你选牌，托管可随时接回；对手赢了真的会捧腹大笑。', keyboard: 'Enter / H / 空格 / T', keyboardDetail: '出牌 / 提示 / 不要 / 托管；Tab 可聚焦牌面', touch: '点选手牌 → 出牌', touchDetail: '再次点牌可取消；提示会选中合法牌组', quote: '“牌可以输，但笑声不能小。”', status: '四人组队 · 你 + 三名 AI · 两副牌 · 捧腹大笑' },
};
const ids = Object.keys(definitions);
const endlessDescriptions = {
  guandan: { message: '从 2 开始连续升级，每副结束可继续。打过 A 后开启下一轮，也可随时结束牌局结算。', summary: '队伍拿到头游，按对家名次升 3 / 2 / 1 级。下一副自动完成进贡、还贡与抗贡并展示记录；打 A 时头游与对家非末游即可过 A。过 A 后重回 2 继续，积分累计。', status: '无限升级 · 进贡还贡 · 打过 A 继续 · 可随时结算' },
  aim: { message: '无限练习，不设倒计时上限。按 Enter 或结束训练查看报告。', summary: '保持稳定节奏练速点、甩枪或跟枪。无限练习独立记分；按 Enter 或结束训练结算。Esc / P 可暂停，休息时间不计入训练耗时。', status: '无限练习 · 随时暂停 · Enter 结束结算' },
  flappy: { message: '3 颗心，穿过源源不断的水管。碰撞后短暂无敌，继续扑腾！', summary: '无限航线，3 颗心。撞到障碍扣 1 颗心，安全复位后短暂无敌；坚持越久，风景越多。生命耗尽结算得分。', status: '无限航线 · 3 颗心 · 碰撞后短暂无敌' },
  angry: { message: '工地一关接一关，每关补充弹药，挑战你的拆迁纪录！', summary: '工地持续出现，每关补充弹药，分数累计。难度逐步提升，弹药用完仍有目标时结算。无限模式单独记分。', status: '无限工地 · 每关补充弹药 · 累计得分' },
  whack: { message: '5 颗心，没有倒计时。打空或漏蛙扣心，挑战最长连击！', summary: '奶蛙不断冒头，5 颗心。漏蛙或打空扣 1 颗心，金冠蛙额外加分并回复 1 颗心（最多 5 颗），连击照常加分。节奏逐渐加快，生命耗尽结算。', status: '无限蛙田 · 5 颗心 · 打空或漏蛙扣心' },
  catch: { message: '奶蛙雨一直下，3 条生命，接金蛙、躲炸弹！', summary: '波次持续生成，3 条生命。接金蛙、积累连击，漏接或接到炸弹扣命。速度逐渐提高，生命耗尽结算。', status: '无限奶蛙雨 · 3 条生命 · 波次持续生成' },
  jump: { message: '平台不断向前延伸，3 条生命，看看能跳多远！', summary: '平台持续生成，每 5 座进入新阶段。3 条生命，掉落后从检查点继续，跳到中心额外加分。生命耗尽结算。', status: '无限平台 · 3 条生命 · 每 5 座进入新阶段' },
  fighter: { message: '无限擂台开张，击败对手后接着迎战下一位！', summary: '对手持续登场，每赢一擂满血迎战，累计击倒与得分。三种角色轮番登场，难度逐渐提高；你的生命耗尽时结算。', status: '无限擂台 · 胜利满血 · 对手不断登场' },
  survivor: { message: '奶蛙越战越强，敌人也会不断出现。', summary: '持续生存、拾取经验、选择强化。敌潮和首领不断来袭，难度与场上数量都有上限；生命耗尽时结算纪录。', status: '无限生存 · 自动攻击 · 升级三选一' },
  bomber: { message: '奶蛙迷宫没有尽头，清场后沿出口继续前进！', summary: '迷宫持续生成，道具帮你越炸越远。消灭敌人后进入出口挑战下一关，注意连锁爆炸并留下安全退路。生命耗尽时结算。', status: '无限迷宫 · 连锁爆炸 · 清场后寻找出口' },
};
const duelDescriptions = {
  fighter: { message: '同一把键盘，两只奶蛙。99 秒一局，先赢两局！', summary: '玩家 1：WASD，J/U/K/I 四键攻击，L 防御、O 翻滚、H 投技、N 爆气、空格超必杀。玩家 2：方向键，1/4/2/5 四键攻击，3 防御、0 翻滚、6 投技、9 爆气、回车超必杀。', status: '同键盘双人 · 三局两胜 · 99 秒回合 · 四键攻击' },
  bomber: { message: '同键盘双人，互相放弹。先赢两局的一方获胜！', summary: '玩家 1 使用 WASD 移动、空格放弹；玩家 2 使用方向键移动、回车放弹。收集道具、绕开爆炸，三局两胜。', status: '同键盘双人 · 三局两胜 · 记得给自己留退路' },
};
const read = (key, fallback) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
const write = (key, value) => { try { value === null ? localStorage.removeItem(key) : localStorage.setItem(key, String(value)); } catch { /* Storage is optional. */ } };
const readJSON = (key, fallback) => { try { return JSON.parse(read(key, 'null')) ?? fallback; } catch { return fallback; } };
const modes = ['easy', 'normal', 'hard'];
const modeNames = { easy: '轻松', normal: '标准', hard: '挑战' };
const difficulty = Object.fromEntries(['flappy', 'whack', 'aim'].map(id => { const value = read(`naiwa:difficulty:${id}`, 'normal'); return [id, modes.includes(value) ? value : 'normal']; }));
const allowedModes = id => id === 'fighter' ? ['classic', 'endless', 'duel', 'training'] : duelDescriptions[id] ? ['classic', 'endless', 'duel'] : ['classic', 'endless'];
const playModes = Object.fromEntries(ids.filter(id => id !== 'merge').map(id => { const value = read(`naiwa:mode:${id}`, 'classic'); return [id, allowedModes(id).includes(value) ? value : 'classic']; }));
const characters = ['belly', 'speed', 'laugh'];
let fighterCharacter = read('naiwa:character:fighter', 'belly'), opponentCharacter = read('naiwa:opponent:fighter', 'speed');
if (!characters.includes(fighterCharacter)) fighterCharacter = 'belly';
if (!characters.includes(opponentCharacter)) opponentCharacter = 'speed';
let gridSize = read('naiwa:board:merge', '4') === '6' ? 6 : 4;
const aimDrills = ['grid', 'precision', 'track'];
let aimDrill = read('naiwa:aim:drill', 'grid');
if (!aimDrills.includes(aimDrill)) aimDrill = 'grid';
const aimDefaultInput = canvasPointerLockAvailable() && !matchMedia('(pointer: coarse)').matches ? 'fps' : 'cursor';
let aimInput = read('naiwa:aim:input', aimDefaultInput);
if (!['fps', 'cursor'].includes(aimInput)) aimInput = aimDefaultInput;
let aimSensitivity = Number(read('naiwa:aim:sensitivity', 1));
if (!Number.isFinite(aimSensitivity) || aimSensitivity < .25 || aimSensitivity > 3) aimSensitivity = 1;
function canvasPointerLockAvailable() { return typeof HTMLCanvasElement.prototype.requestPointerLock === 'function'; }
let aimLockEpoch = 0, aimLockRequest = null;
const isEndless = id => playModes[id] === 'endless';
const isDuel = id => playModes[id] === 'duel';
const isTraining = id => id === 'fighter' && playModes[id] === 'training';
const trainingDescription = { title: '练一下，下一拳更有把握。', message: '无限生命与能量，试试后退、跳攻、搓招和连段。', start: '开始练习', summary: '木桩不会主动攻击，可选择站防或蹲防。打开判定框，观察起手、有效攻击与收招；无限生命和能量让你放心练习。练习不计入最高分。', status: '练习室 · 无限生命/能量 · 可切木桩防御 · 显示判定' };
const gameData = id => ({ ...definitions[id], ...(isTraining(id) ? trainingDescription : isEndless(id) ? endlessDescriptions[id] : isDuel(id) ? duelDescriptions[id] : {}) });
const mergeSaveKey = () => `naiwa:save:merge${gridSize === 6 ? ':6' : ''}`;
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
let leaderboardRun = null, loadedMergeSave = null;
const leaderboardClient = createLeaderboardClient();
const leaderboardContext = () => ({ game: activeId, mode: activeId === 'merge' ? 'classic' : playModes[activeId],
  difficulty: difficulty[activeId] || 'normal', gridSize, startLevel: selectedLevel, character: fighterCharacter, aimDrill, aimInput });
const leaderboardUI = createLeaderboardUI({ client: leaderboardClient,
  getContext: () => parseBoard(leaderboardRun?.board) || leaderboardContext(), onOpen: () => pause() });
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const bestKey = id => `naiwa:best:${id}${difficulty[id] && difficulty[id] !== 'normal' ? `:${difficulty[id]}` : ''}${isEndless(id) ? ':endless' : isDuel(id) ? ':duel' : ''}${id === 'merge' && gridSize === 6 ? ':6' : ''}${id === 'aim' ? `:${aimDrill}:${aimInput}` : ''}`;
const bestFor = id => { const value = Number(read(bestKey(id), 0)); return Number.isFinite(value) ? Math.max(0, value) : 0; };
const touchControls = createTouchControls($('action-controls'), {
  down: action => { if (state === 'playing') { audio.unlock(); game?.controlDown?.(action); } },
  up: action => game?.controlUp?.(action),
  focus: () => canvas.focus({ preventScroll: true }),
});
const guandanUI = createGuandanUI({ getGame: () => game, getHostState: () => state, unlockAudio: () => audio.unlock() });
let upgradeSignature = '';
let trainingReadout = '';
function renderTraining() {
  if (!isTraining(activeId) || !game || state === 'ready') return;
  const view = game.getState(), player = view.players?.[0];
  if (!player) return;
  if ($('training-boxes').checked) {
    ctx.save(); ctx.lineWidth = 1.5;
    for (const fighter of view.players) for (const [key, color, fill] of [['hurtbox', '#397d9e', '#78bade22'], ['hitbox', '#c45747', '#ed816740']]) {
      const box = fighter[key];
      if (!box || ![box.x, box.y, box.width, box.height].every(Number.isFinite)) continue;
      ctx.strokeStyle = color; ctx.fillStyle = fill;
      ctx.fillRect(box.x, box.y, box.width, box.height); ctx.strokeRect(box.x, box.y, box.width, box.height);
    }
    ctx.restore();
  }
  const labels = { idle: '待机', walk: '前进', backwalk: '后退', run: '跑动', jump: '跳跃', hop: '小跳', high: '高跳', hyper: '快速小跳', normal: '普通跳', landing: '落地收招', startup: '起手', active: '攻击有效', recovery: '收招', light: '轻拳', heavy: '重拳', lightKick: '轻脚', heavyKick: '重脚', 'air-light': '空中轻拳', 'air-heavy': '空中重拳', roll: '翻滚', backstep: '后撤步', throw: '投技', hurt: '受击', guard: '防御', crouch: '蹲下', knockout: '倒地', 'guard-impact': '防住', special: '超必杀', command: '指令必杀', blowback: '吹飞', knockdown: '倒地', super: '高跳', 'running-hop': '快速小跳' };
  const motion = player.animation?.state || player.movement || 'idle';
  const attack = player.attack ? `${labels[player.attack.type] || player.attack.name || '出招'} · ${labels[player.animation?.phase] || ''}` : labels[motion] || motion;
  const arrows = { 1: '↙', 2: '↓', 3: '↘', 4: '←', 5: '·', 6: '→', 7: '↖', 8: '↑', 9: '↗' };
  const log = (view.inputLogs?.[0] || []).filter(entry => entry.pressed !== false).slice(-7).map(entry => entry.label || entry.command || labels[entry.action] || entry.action || arrows[entry.direction] || '').filter(Boolean).join(' ');
  const message = `当前：${attack}${player.airborne ? ' · 空中' : ''} · 连击 ${player.combo || 0} · 命中 ${view.stats?.hits?.[0] || 0}${log ? `\n输入：${log}` : ''}`;
  if (message !== trainingReadout) { $('training-readout').textContent = message; trainingReadout = message; }
}
function refreshActionControls() {
  const choices = activeId === 'survivor' && state === 'playing' ? game?.getUpgrades?.() || [] : [];
  touchControls.setEnabled(state === 'playing' && choices.length === 0);
  $('upgrade-panel').hidden = choices.length === 0;
  const signature = JSON.stringify(choices);
  if (signature === upgradeSignature) return;
  upgradeSignature = signature;
  $('upgrade-options').replaceChildren(...choices.map((choice, index) => {
    const button = document.createElement('button'); button.dataset.upgrade = index;
    button.append(Object.assign(document.createElement('b'), { textContent: `${index + 1}. ${choice.name}` }), Object.assign(document.createElement('span'), { textContent: choice.description }));
    button.addEventListener('click', () => { if (state === 'playing' && game.chooseUpgrade(index)) { refreshActionControls(); canvas.focus({ preventScroll: true }); } });
    return button;
  }));
}

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
  if (isTraining(activeId)) { $('best-score').textContent = '—'; document.querySelector('.best-score div>span').textContent = '练习室 · 不计成绩'; return; }
  $('best-score').replaceChildren(document.createTextNode(`${bestFor(activeId)} `), Object.assign(document.createElement('small'), { textContent: '分' }));
  const label = activeId === 'merge' ? `${gridSize}×${gridSize}` : `${isEndless(activeId) ? '无限' : isDuel(activeId) ? '双人' : '经典'}${definitions[activeId].modes ? ` · ${modeNames[difficulty[activeId]]}` : ''}`;
  document.querySelector('.best-score div>span').textContent = `${label} · 我的最高纪录`;
}
function refreshPuzzleControls() {
  if (activeId !== 'merge' || !game) return;
  $('undo-button').disabled = state === 'ready' || state === 'paused' || !game.getState().canUndo;
  document.querySelectorAll('[data-direction]').forEach(button => { button.disabled = state !== 'playing'; });
}
function renderLevels() {
  if (isEndless('angry') && activeId === 'angry') return;
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
  if (!isTraining(activeId) && score > bestFor(activeId)) { write(bestKey(activeId), score); refreshBest(); }
  refreshPuzzleControls();
}
function showOverlay(kind, result) {
  $('start-button').disabled = false;
  const aimStats = activeId === 'aim' && kind === 'ended' ? game?.getState().stats : null;
  $('aim-results').hidden = !aimStats;
  $('aim-results').replaceChildren();
  if (aimStats) {
    const rows = [ ['命中率', `${Number(aimStats.accuracy || 0).toFixed(1)}%`],
      [aimDrill === 'track' ? '有效跟枪' : aimDrill === 'grid' ? '平均切换' : '平均反应', aimDrill === 'track' ? `${Number(aimStats.trackingHitTime || 0).toFixed(1)} 秒` : aimStats.averageReactionMs > 0 ? `${Math.round(aimStats.averageReactionMs)} ms` : '—'],
      [aimDrill === 'track' ? '开火时长' : '命中 / 射击', aimDrill === 'track' ? `${Number(aimStats.trackingFireTime || 0).toFixed(1)} 秒` : `${aimStats.hits} / ${aimStats.shots}`],
      ['有效训练', `${Number(aimStats.elapsed || 0).toFixed(1)} 秒`] ];
    for (const [label, value] of rows) { const row = document.createElement('div'); row.append(Object.assign(document.createElement('dt'), { textContent: label }), Object.assign(document.createElement('dd'), { textContent: value })); $('aim-results').append(row); }
  }
  const data = gameData(activeId);
  const saved = activeId === 'merge' ? readJSON(mergeSaveKey(), null) : null;
  const resumable = kind === 'ready' && validSave(saved, gridSize);
  $('game-overlay').hidden = false; $('result-score').hidden = kind !== 'ended';
  $('overlay-kicker').textContent = { ready: resumable ? 'WELCOME BACK, FROGGY' : 'READY, FROGGY?', paused: 'TAKE YOUR TIME', ended: 'WELL PLAYED, FROGGY!' }[kind];
  $('overlay-title').textContent = result?.title ?? (kind === 'paused' ? '奶蛙也要歇一会儿。' : resumable ? '上次的奶蛙，还在等你。' : data.title);
  $('overlay-message').textContent = result?.message ?? (kind === 'paused' ? '准备好了就继续，你的这局还在。' : resumable ? `${gridSize}×${gridSize} · 已经走了 ${saved.moves} 步，合到 ${Math.max(...saved.board)}。继续你的进化之旅。` : activeId === 'angry' && !isEndless(activeId) ? `第 ${selectedLevel} 关 · ${LEVELS[selectedLevel - 1].name} · ${LEVELS[selectedLevel - 1].shots} 发机会` : activeId === 'merge' ? `${gridSize}×${gridSize} 棋盘 · ${data.message}` : data.message);
  const text = kind === 'paused' ? '继续游戏' : result?.canContinue ? '继续冲击 4096' : kind === 'ended' ? (activeId === 'angry' && !isEndless(activeId) ? '重试这一关' : '再来一局') : resumable ? '继续上局' : data.start;
  $('start-button').replaceChildren(document.createTextNode(`${text} `), Object.assign(document.createElement('span'), { textContent: '→' }));
  $('overlay-hint').textContent = kind === 'ended' ? '没关系，奶蛙的快乐没有次数限制' : '准备好迎接奶蛙的魔性笑声';
  if (activeId === 'aim' && kind !== 'ended') $('overlay-hint').textContent = aimInput === 'fps' ? '点击开始后锁定鼠标 · Esc 释放 · Enter 结束' : '三秒准备后计时 · 跟枪时请按住目标移动';
  if (activeId === 'guandan') $('overlay-hint').textContent = kind === 'ended' ? '对家还在，下局一起赢回来。' : '红桃级牌是百搭 · 队友在上方 · 想歇会儿可托管';
  if (kind === 'ended') { $('result-value').textContent = String(result.score); $('start-button').focus({ preventScroll: true }); }
  refreshPuzzleControls();
}
function endGame(result) {
  cancelAimLockRequest();
  if (state === 'ended') return;
  setScore(result.score); state = 'ended'; lastResult = result;
  if (activeId === 'aim') { game.cancelInput?.(); releaseAimLock(); $('aim-finish').disabled = true; }
  if (activeId === 'angry' && !isEndless(activeId) && result.level) selectedLevel = result.level;
  $('pause-button').disabled = true; showOverlay('ended', result);
  if (activeId === 'angry') renderLevels();
  const finishedRun = leaderboardRun;
  if (finishedRun) {
    $('leaderboard-result').hidden = false;
    $('leaderboard-result-message').textContent = '正在记录本局成绩…';
    void leaderboardClient.recordResult(finishedRun, result.score).then(outcome => {
      leaderboardUI.notifyResult(outcome);
      if (lastResult === result && state === 'ended') $('leaderboard-result-message').textContent = outcome.message;
    }).catch(() => { if (lastResult === result && state === 'ended') $('leaderboard-result-message').textContent = '成绩暂未上传，打开排行榜可重试。'; });
  }
}
function clearInput() {
  touchControls.clear();
  game?.cancelInput?.();
  if (activePointer !== null) {
    game?.pointerUp?.({ x: -1, y: -1, cancelled: true });
    try { canvas.releasePointerCapture(activePointer); } catch { /* The pointer may already have ended. */ }
    activePointer = null;
  }
}
function updateAimSettings() {
  $('aim-drill').value = aimDrill; $('aim-input').value = aimInput;
  $('aim-sensitivity').value = String(aimSensitivity);
  $('aim-sensitivity-value').textContent = `${aimSensitivity.toFixed(2)}×`;
  $('aim-sensitivity-setting').hidden = aimInput !== 'fps';
  const action = aimDrill === 'track' ? '按住左键跟随移动球，松开停止开火。' : '左键单次射击，打中小球立即刷新目标。';
  $('aim-control-note').textContent = aimInput === 'fps'
    ? `固定中心准星，移动鼠标转动视角。${action}Esc / P 暂停释放鼠标；Enter 结束训练。`
    : `鼠标或手指直接瞄准。${action.replace('左键', '画面')}点击与 FPS 分榜；修改训练或操控会准备新的一局。`;
}
function releaseAimLock() {
  if (document.pointerLockElement === canvas) document.exitPointerLock?.();
  $('player-window').classList.remove('aim-locked');
}
function cancelAimLockRequest() {
  aimLockEpoch++;
  aimLockRequest?.cancel();
}
function requestAimLock(options) {
  if (aimLockRequest) return;
  const epoch = ++aimLockEpoch, originalGame = game, originalState = state;
  let timer, settled = false;
  const cleanup = () => {
    clearTimeout(timer);
    document.removeEventListener('pointerlockchange', changed);
    document.removeEventListener('pointerlockerror', failed);
    if (aimLockRequest?.epoch === epoch) aimLockRequest = null;
    $('start-button').disabled = false;
  };
  const finish = success => {
    if (settled) return;
    settled = true; cleanup();
    if (epoch !== aimLockEpoch || activeId !== 'aim' || game !== originalGame || state !== originalState || document.hidden || !document.hasFocus() || $('help-dialog').open || $('leaderboard-dialog')?.open) {
      releaseAimLock();
      return;
    }
    if (success) { startGame(options); return; }
    if (originalState === 'paused') {
      toast('未能锁定鼠标。可再次继续，或选择点击模式重新开局。');
      return; // A resumed FPS run must never be relabelled as a cursor run.
    }
    aimInput = 'cursor'; write('naiwa:aim:input', aimInput); selectGame('aim');
    toast('鼠标锁定不可用，已切换为点击模式。');
    startGame(options);
  };
  const changed = () => { if (document.pointerLockElement === canvas) finish(true); };
  const failed = () => finish(false);
  aimLockRequest = { epoch, cancel() { settled = true; cleanup(); } };
  $('start-button').disabled = true;
  document.addEventListener('pointerlockchange', changed);
  document.addEventListener('pointerlockerror', failed);
  timer = setTimeout(failed, 4000);
  try {
    if (!canvas.requestPointerLock) { failed(); return; }
    const pending = canvas.requestPointerLock();
    pending?.then?.(changed, failed);
  } catch { failed(); }
}
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  if (locked && (activeId !== 'aim' || aimInput !== 'fps' || (!aimLockRequest && state !== 'playing'))) {
    releaseAimLock(); return;
  }
  $('player-window').classList.toggle('aim-locked', locked);
  if (!locked && activeId === 'aim' && aimInput === 'fps' && state === 'playing') pause();
});
function resize() {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = size.width * ratio; canvas.height = size.height * ratio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}
function selectGame(id, scroll = false, levelOverride) {
  if (!definitions[id]) return;
  cancelAimLockRequest(); releaseAimLock();
  audio.stopAll(); clearInput(); game?.destroy(); game = null;
  activeId = id; state = 'ready'; gameTime = 0; accumulator = 0; lastResult = null;
  leaderboardRun = null; $('leaderboard-result').hidden = true;
  if (id === 'angry') { progress = loadProgress(); selectedLevel = Math.max(1, Math.min(progress.unlocked, levelOverride || progress.unlocked)); }
  const data = gameData(id);
  size = id === 'merge' ? { width: 560, height: 640 } : { width: 960, height: 560 };
  resize(); $('player-window').classList.toggle('puzzle-mode', id === 'merge');
  $('player-window').classList.toggle('aim-mode', id === 'aim');
  $('player-window').classList.toggle('guandan-mode', id === 'guandan');
  $('aim-settings').hidden = id !== 'aim'; $('aim-finish').hidden = id !== 'aim'; $('aim-finish').disabled = true;
  updateAimSettings();
  $('current-name').textContent = data.name; $('game-number').textContent = `${String(ids.indexOf(id) + 1).padStart(2, '0')} / ${String(ids.length).padStart(2, '0')}`;
  $('instruction-title').textContent = data.instruction; $('instruction-summary').textContent = data.summary;
  $('keyboard-control').textContent = data.keyboard; $('keyboard-detail').textContent = data.keyboardDetail;
  $('touch-control').textContent = data.touch; $('touch-detail').textContent = data.touchDetail;
  $('frog-quote').textContent = data.quote; $('game-status').textContent = data.status;
  $('pause-button').disabled = true; $('pause-button').textContent = 'Ⅱ'; $('pause-button').setAttribute('aria-label', '暂停游戏');
  $('game-select').value = id; $('difficulty-setting').hidden = !data.modes;
  $('difficulty-select').value = difficulty[id] || 'normal';
  $('play-mode-setting').hidden = id === 'merge';
  $('play-mode-select').replaceChildren(...allowedModes(id).map(value => Object.assign(document.createElement('option'), { value, textContent: { classic: '经典模式', endless: '∞ 无限模式', duel: '双人（同键盘）', training: '练习室 · 自由出招' }[value] })));
  $('play-mode-select').value = playModes[id] || 'classic';
  if (id === 'aim') { $('play-mode-select').options[0].textContent = '60 秒挑战'; $('play-mode-select').options[1].textContent = '∞ 无限练习'; }
  if (id === 'guandan') { $('play-mode-select').options[0].textContent = '单局对战'; $('play-mode-select').options[1].textContent = '∞ 连续升级'; }
  $('fighter-setting').hidden = id !== 'fighter'; $('opponent-setting').hidden = id !== 'fighter' || (!isDuel(id) && !isTraining(id));
  $('opponent-setting').firstChild.nodeValue = isTraining(id) ? '木桩角色 ' : '玩家二 ';
  $('player-window').classList.toggle('fighter-mode', id === 'fighter');
  $('fighter-guide').hidden = id !== 'fighter'; $('fighter-training').hidden = !isTraining(id);
  trainingReadout = ''; $('training-readout').textContent = '准备试试：向前跳 → 重脚 → 落地轻拳。';
  $('fighter-character').value = fighterCharacter; $('opponent-character').value = opponentCharacter;
  $('duel-guide').hidden = !isDuel(id); $('duel-guide').textContent = isDuel(id) ? duelDescriptions[id].summary : '';
  $('board-setting').hidden = id !== 'merge'; $('board-size-select').value = String(gridSize);
  $('mode-note').textContent = id === 'merge' ? '两种棋盘分别存档、分别记录最高分' : isDuel(id) ? '两人共用一把键盘，三局两胜' : isEndless(id) ? '无限续关，挑战生存纪录 · 独立记分' : data.modes ? '每种难度独立记录最高分' : id === 'angry' ? '通关保存星级，解锁下一关' : '放轻松，奶蛙替你努力';
  if (id === 'aim') $('mode-note').textContent = '训练项目、难度、操控分别记分';
  if (id === 'guandan') $('mode-note').textContent = '单人游玩 · 三名 AI 陪玩 · 两种玩法分榜';
  if (isTraining(id)) $('mode-note').textContent = '无限生命与能量 · 自由练习 · 不计成绩';
  $('puzzle-controls').hidden = id !== 'merge'; levelPanel.hidden = id !== 'angry' || isEndless(id); formsPanel.hidden = id !== 'merge';
  canvas.setAttribute('aria-label', `${data.name}游戏区域。${data.message}`);
  document.querySelectorAll('[data-game]').forEach(button => { const selected = button.dataset.game === id; button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected)); });
  const saveKey = mergeSaveKey();
  loadedMergeSave = id === 'merge' ? readJSON(saveKey, null) : null;
  game = data.factory({
    canvas, ctx, ...size, drawFrog, audio, difficulty: difficulty[id] || 'normal', progress, endless: isEndless(id), multiplayer: isDuel(id), training: isTraining(id), character: fighterCharacter, opponentCharacter: isDuel(id) || isTraining(id) ? opponentCharacter : undefined, gridSize,
    savedGame: loadedMergeSave, aimDrill, aimInput, sensitivity: aimSensitivity,
    onScore: setScore,
    onStatus: text => { $('game-status').textContent = text; if (activeId === 'angry' && game) renderLevels(); },
    onEnd: endGame,
    onProgress: value => { if (isEndless(id)) return; progress = value; write('naiwa:progress:angry', JSON.stringify(value)); renderLevels(); },
    onSave: value => { if (id === 'merge') write(saveKey, value === null ? null : JSON.stringify({ ...value,
      ...(leaderboardRun?.runId ? { leaderboardRun: leaderboardRun.runId } : {}) })); },
  });
  touchControls.setEnabled(false); touchControls.configure(id); refreshActionControls();
  setScore(0); refreshBest(); renderLevels(); showOverlay('ready');
  if (scroll) $('arcade').scrollIntoView({ behavior: reducedMotion ? 'instant' : 'smooth', block: 'start' });
}
function startGame({ restart = false } = {}) {
  if (activeId === 'aim' && aimInput === 'fps' && document.pointerLockElement !== canvas) { requestAimLock({ restart }); return; }
  audio.unlock(); audio.stopAll(); clearInput();
  const oldState = state;
  if (restart && activeId === 'angry' && !isEndless(activeId) && oldState !== 'ready') selectedLevel = game.getState().level;
  const continuing = !restart && oldState === 'ended' && lastResult?.canContinue;
  if (!continuing && (restart || oldState !== 'paused')) {
    const saved = activeId === 'merge' && !restart && oldState === 'ready' ? loadedMergeSave : null;
    leaderboardRun = leaderboardClient.beginRun(leaderboardContext(), { resume: activeId === 'merge' && validSave(saved, gridSize), runId: saved?.leaderboardRun });
  }
  $('leaderboard-result').hidden = true;
  state = 'playing';
  if (!restart && oldState === 'ended' && lastResult?.canContinue) game.continueGame();
  else if (restart || oldState !== 'paused') { gameTime = 0; game.start({ level: activeId === 'angry' && !isEndless(activeId) ? selectedLevel : 1, fresh: restart || oldState === 'ended', difficulty: difficulty[activeId] || 'normal', endless: isEndless(activeId), multiplayer: isDuel(activeId), training: isTraining(activeId), character: fighterCharacter, opponentCharacter: isDuel(activeId) || isTraining(activeId) ? opponentCharacter : undefined, aimDrill, aimInput, sensitivity: aimSensitivity }); }
  if (isTraining(activeId)) game.setTrainingGuard?.($('training-guard').value);
  if (state === 'ended') return;
  if (activeId === 'aim') $('aim-finish').disabled = false;
  $('aim-results').hidden = true;
  lastResult = null; $('game-overlay').hidden = true; $('pause-button').disabled = false;
  $('pause-button').textContent = 'Ⅱ'; $('pause-button').setAttribute('aria-label', '暂停游戏');
  lastFrame = performance.now(); accumulator = 0; refreshPuzzleControls();
  if (activeId === 'angry') renderLevels();
  canvas.focus({ preventScroll: true });
}
function pause() {
  cancelAimLockRequest();
  if (state !== 'playing') return;
  state = 'paused'; clearInput(); audio.stopAll(); accumulator = 0; releaseAimLock();
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
  const p = activeId === 'aim' && aimInput === 'fps' ? { x: size.width / 2, y: size.height / 2 } : point(event); if (p.x < 0 || p.x > size.width || p.y < 0 || p.y > size.height) return;
  activePointer = event.pointerId; try { if (document.pointerLockElement !== canvas) canvas.setPointerCapture(event.pointerId); } catch {} game.pointerDown?.(p);
});
canvas.addEventListener('pointermove', event => { if (state === 'playing' && !(activeId === 'aim' && aimInput === 'fps') && (activePointer === null || event.pointerId === activePointer)) game.pointerMove?.(point(event)); });
canvas.addEventListener('pointerup', event => {
  if (event.pointerId !== activePointer) return;
  if (state === 'playing') game.pointerUp?.(point(event));
  activePointer = null; try { canvas.releasePointerCapture(event.pointerId); } catch {}
});
document.addEventListener('mousemove', event => { if (state === 'playing' && activeId === 'aim' && aimInput === 'fps' && document.pointerLockElement === canvas) game.look?.(event.movementX, event.movementY); });
canvas.addEventListener('pointerleave', () => { if (activeId === 'aim' && aimInput === 'cursor' && activePointer === null) game?.cancelInput?.(); });
canvas.addEventListener('pointercancel', () => { if (activePointer !== null) pause(); });
document.addEventListener('keydown', event => {
  if ($('help-dialog').open || $('leaderboard-dialog')?.open || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.code === 'KeyP' || event.code === 'Escape') {
    if (event.repeat) return;
    if (state === 'playing') { event.preventDefault(); pause(); }
    else if (state === 'paused' && event.code === 'KeyP') { event.preventDefault(); startGame(); }
    return;
  }
  if (activeId === 'aim' && event.code === 'Enter' && !event.repeat && ['playing', 'paused'].includes(state) && !['INPUT', 'SELECT', 'BUTTON'].includes(event.target.tagName)) { event.preventDefault(); game.finish?.(); return; }
  if (activeId === 'guandan' && guandanUI.keyDown(event)) { event.preventDefault(); return; }
  if (state === 'playing' && event.target === canvas && game.keyDown?.(event)) event.preventDefault();
});
document.addEventListener('keyup', event => { if (state === 'playing' && !$('help-dialog').open && game.keyUp?.(event)) event.preventDefault(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
window.addEventListener('blur', pause);
window.addEventListener('resize', resize);
document.querySelectorAll('[data-game]').forEach(button => button.addEventListener('click', () => selectGame(button.dataset.game, true)));
document.querySelectorAll('[data-open-game]').forEach(button => button.addEventListener('click', () => selectGame(button.dataset.openGame, true)));
$('game-select').addEventListener('change', event => selectGame(event.target.value));
$('difficulty-select').addEventListener('change', event => { difficulty[activeId] = event.target.value; write(`naiwa:difficulty:${activeId}`, event.target.value); selectGame(activeId); });
$('play-mode-select').addEventListener('change', event => { playModes[activeId] = allowedModes(activeId).includes(event.target.value) ? event.target.value : 'classic'; write(`naiwa:mode:${activeId}`, playModes[activeId]); selectGame(activeId); });
$('fighter-character').addEventListener('change', event => { if (characters.includes(event.target.value)) { fighterCharacter = event.target.value; write('naiwa:character:fighter', fighterCharacter); selectGame('fighter'); } });
$('opponent-character').addEventListener('change', event => { if (characters.includes(event.target.value)) { opponentCharacter = event.target.value; write('naiwa:opponent:fighter', opponentCharacter); selectGame('fighter'); } });
$('training-guard').addEventListener('change', () => { if (isTraining(activeId)) game?.setTrainingGuard?.($('training-guard').value); canvas.focus({ preventScroll: true }); });
$('training-boxes').addEventListener('change', () => canvas.focus({ preventScroll: true }));
$('training-reset').addEventListener('click', () => { if (isTraining(activeId)) startGame({ restart: true }); });
$('board-size-select').addEventListener('change', event => { gridSize = event.target.value === '6' ? 6 : 4; write('naiwa:board:merge', gridSize); selectGame('merge'); });
$('aim-drill').addEventListener('change', event => { aimDrill = aimDrills.includes(event.target.value) ? event.target.value : 'grid'; write('naiwa:aim:drill', aimDrill); selectGame('aim'); });
$('aim-input').addEventListener('change', event => { aimInput = event.target.value === 'fps' ? 'fps' : 'cursor'; write('naiwa:aim:input', aimInput); selectGame('aim'); });
$('aim-sensitivity').addEventListener('input', event => { aimSensitivity = Math.max(.25, Math.min(3, Number(event.target.value) || 1)); write('naiwa:aim:sensitivity', aimSensitivity); game?.setSensitivity?.(aimSensitivity); updateAimSettings(); });
$('aim-finish').addEventListener('click', () => { if (activeId === 'aim' && ['playing', 'paused'].includes(state)) game.finish?.(); });
$('start-button').addEventListener('click', () => startGame());
$('leaderboard-button').addEventListener('click', () => leaderboardUI.open());
$('leaderboard-result-open').addEventListener('click', () => leaderboardUI.open());
$('pause-button').addEventListener('click', () => state === 'paused' ? startGame() : pause());
$('restart-button').addEventListener('click', () => startGame({ restart: true }));
$('sound-toggle').addEventListener('click', () => { soundEnabled = !soundEnabled; write('naiwa:sound', soundEnabled ? 'on' : 'off'); audio.setEnabled(soundEnabled); if (soundEnabled) { audio.unlock(); audio.play('pop'); } setSoundUI(); });
document.querySelectorAll('[data-direction]').forEach(button => button.addEventListener('click', () => {
  if (activeId !== 'merge' || state !== 'playing') return;
  audio.unlock(); game.keyDown({ key: button.dataset.direction }); canvas.focus({ preventScroll: true }); refreshPuzzleControls();
}));
$('undo-button').addEventListener('click', () => {
  if (activeId !== 'merge' || !['playing', 'ended'].includes(state)) return;
  if (game.undo()) { state = 'playing'; lastResult = null; $('leaderboard-result').hidden = true; $('game-overlay').hidden = true; $('pause-button').disabled = false; $('pause-button').textContent = 'Ⅱ'; refreshPuzzleControls(); canvas.focus({ preventScroll: true }); }
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
  renderTraining();
  guandanUI.update(activeId === 'guandan');
  refreshActionControls();
  if (!document.hidden && heroVisible) { setFrogTime(reducedMotion ? .3 : now / 1000); drawHero(heroCtx, reducedMotion ? .3 : now / 1000); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
if (new URLSearchParams(location.search).has('debug')) {
  Object.defineProperty(window, '__arcade', { value: { getState: (options = {}) => ({ id: activeId, state, score, soundEnabled, animations: frogAnimationStatus(), difficulty: difficulty[activeId], playMode: playModes[activeId], fighterCharacter, opponentCharacter, gridSize, selectedLevel, progress, aimDrill, aimInput, aimSensitivity, aimLocked: document.pointerLockElement === canvas, game: game.getState(options) }) } });
}
