// Pure shared rules for the browser and the leaderboard service. These checks
// reject malformed / obviously implausible reports; they do not verify gameplay.
export const BOARD_VERSION = 'v1';
export const GAMES = Object.freeze([
  ['flappy', '奶蛙飞不动'], ['angry', '愤怒的奶蛙'], ['whack', '暴打奶蛙'],
  ['catch', '奶蛙接不住'], ['jump', '奶蛙跳一跳'], ['merge', '奶蛙 2048'],
  ['fighter', '奶蛙大乱斗'], ['survivor', '奶蛙幸存者'], ['bomber', '奶蛙炸弹人'],
  ['aim', '奶蛙瞄准实验室'],
].map(([id, name]) => Object.freeze({ id, name })));

const gameNames = new Map(GAMES.map(({ id, name }) => [id, name]));
const modes = ['classic', 'endless'];
const difficulties = ['easy', 'normal', 'hard'];
const difficultyNames = { easy: '轻松', normal: '标准', hard: '挑战' };
const characters = ['belly', 'speed', 'laugh'];
const characterNames = { belly: '大肚奶蛙', speed: '暴躁奶蛙', laugh: '狂笑奶蛙' };
const aimDrills = ['grid', 'precision', 'track'];
const aimInputs = ['fps', 'cursor'];
const aimDrillNames = { grid: '三球速点', precision: '精准甩枪', track: '跟枪追踪' };
const aimInputNames = { fps: '鼠标FPS', cursor: '点击触屏' };

/** Build a canonical board key. Irrelevant dimensions are intentionally ignored:
 * the app passes a common context containing settings for several games. */
export function makeBoard(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) return null;
  const { game, mode = 'classic', difficulty = 'normal', gridSize = 4, startLevel = 1, character = 'belly', aimDrill = 'grid', aimInput = 'cursor' } = options;
  if (!gameNames.has(game) || !modes.includes(mode)) return null;
  const parts = [BOARD_VERSION, game, mode];
  if (game === 'aim') {
    if (!difficulties.includes(difficulty) || !aimDrills.includes(aimDrill) || !aimInputs.includes(aimInput)) return null;
    parts.push(difficulty, aimDrill, aimInput);
  } else if (game === 'flappy' || game === 'whack') {
    if (!difficulties.includes(difficulty)) return null;
    parts.push(difficulty);
  } else if (game === 'angry' && mode === 'classic') {
    if (!Number.isInteger(startLevel) || startLevel < 1 || startLevel > 12) return null;
    parts.push(String(startLevel));
  } else if (game === 'merge') {
    if (mode !== 'classic' || (gridSize !== 4 && gridSize !== 6)) return null;
    parts.push(String(gridSize));
  } else if (game === 'fighter') {
    if (!characters.includes(character)) return null;
    parts.push(character);
  }
  return parts.join(':');
}

/** Strict parser: whitespace, extra segments and alternate numeric spellings
 * cannot create aliases that split a leaderboard or bypass board validation. */
export function parseBoard(key) {
  if (typeof key !== 'string' || key.length > 80) return null;
  const parts = key.split(':');
  if (parts[0] !== BOARD_VERSION || !gameNames.has(parts[1]) || !modes.includes(parts[2])) return null;
  const game = parts[1], mode = parts[2], config = { game, mode };
  if (game === 'aim') {
    if (parts.length !== 6 || !difficulties.includes(parts[3]) || !aimDrills.includes(parts[4]) || !aimInputs.includes(parts[5])) return null;
    config.difficulty = parts[3];
    config.aimDrill = parts[4];
    config.aimInput = parts[5];
  } else if (game === 'flappy' || game === 'whack') {
    if (parts.length !== 4 || !difficulties.includes(parts[3])) return null;
    config.difficulty = parts[3];
  } else if (game === 'angry' && mode === 'classic') {
    if (parts.length !== 4 || !/^(?:[1-9]|1[0-2])$/.test(parts[3])) return null;
    config.startLevel = Number(parts[3]);
  } else if (game === 'merge') {
    if (mode !== 'classic' || parts.length !== 4 || !['4', '6'].includes(parts[3])) return null;
    config.gridSize = Number(parts[3]);
  } else if (game === 'fighter') {
    if (parts.length !== 4 || !characters.includes(parts[3])) return null;
    config.character = parts[3];
  } else if (parts.length !== 3) return null;
  return makeBoard(config) === key ? config : null;
}

export function boardLabel(key) {
  const config = parseBoard(key);
  if (!config) return '';
  const classicLabel = config.game === 'aim' ? '经典60秒' : '经典';
  const parts = [gameNames.get(config.game), config.mode === 'classic' ? classicLabel : '无限'];
  if (config.difficulty) parts.push(difficultyNames[config.difficulty]);
  if (config.startLevel) parts.push(`第 ${config.startLevel} 关起`);
  if (config.gridSize) parts.push(`${config.gridSize}×${config.gridSize} · 可撤销`);
  if (config.character) parts.push(characterNames[config.character]);
  if (config.aimDrill) parts.push(aimDrillNames[config.aimDrill]);
  if (config.aimInput) parts.push(aimInputNames[config.aimInput]);
  return parts.join(' · ');
}

/** UI options and server allowlist share the same finite set (77 boards). */
export function getBoardChoices(game) {
  if (!gameNames.has(game)) return [];
  const configs = [];
  if (game === 'aim') {
    for (const mode of modes) for (const difficulty of difficulties) for (const aimDrill of aimDrills) for (const aimInput of aimInputs) {
      configs.push({ game, mode, difficulty, aimDrill, aimInput });
    }
  } else if (game === 'flappy' || game === 'whack') {
    for (const mode of modes) for (const difficulty of difficulties) configs.push({ game, mode, difficulty });
  } else if (game === 'angry') {
    for (let startLevel = 1; startLevel <= 12; startLevel++) configs.push({ game, mode: 'classic', startLevel });
    configs.push({ game, mode: 'endless' });
  } else if (game === 'merge') {
    for (const gridSize of [4, 6]) configs.push({ game, gridSize });
  } else if (game === 'fighter') {
    for (const mode of modes) for (const character of characters) configs.push({ game, mode, character });
  } else for (const mode of modes) configs.push({ game, mode });
  return configs.map(config => { const value = makeBoard(config); return { value, label: boardLabel(value) }; });
}

// This matches the existing 2048 save's integer range and remains generous for
// long endless sessions. There is deliberately no maximum session duration.
export const MAX_SCORE = 2 ** 40 - 1;
const CLASSIC_LIMITS = Object.freeze({ whack: 20_000, catch: 10_000, jump: 2_000, angry: 100_000, fighter: 100_000, bomber: 100_000, aim: 2_000_000 });
const SCORE_ENVELOPES = Object.freeze({
  flappy: Object.freeze({ headroom: 10, perSecond: 4 }),
  whack: Object.freeze({ headroom: 100, perSecond: 500 }),
  catch: Object.freeze({ headroom: 1000, perSecond: 500 }),
  jump: Object.freeze({ headroom: 100, perSecond: 200 }),
  angry: Object.freeze({ headroom: 10_000, perSecond: 20_000 }),
  fighter: Object.freeze({ headroom: 10_000, perSecond: 20_000 }),
  survivor: Object.freeze({ headroom: 10_000, perSecond: 20_000 }),
  bomber: Object.freeze({ headroom: 10_000, perSecond: 20_000 }),
  aim: Object.freeze({ headroom: 1000, perSecond: 5000 }),
});
const invalid = (code, error) => ({ ok: false, code, error });

/** elapsedMs must be calculated by the service from its stored run start time.
 * Pauses count toward wall time. A browser-provided duration is not evidence.
 * 2048 has no rate cap: the same registered run may resume from a long-lived save.
 * @returns {{ok: true}|{ok: false, code: string, error: string}}
 */
export function validateScore(board, score, duration) {
  const config = parseBoard(board);
  if (!config) return invalid('invalid_board', '这个玩法不参与排行榜，或榜单编号无效。');
  if (!Number.isSafeInteger(score) || score < 0 || score > MAX_SCORE) return invalid('invalid_score', '分数必须是有效范围内的非负整数。');
  const elapsedMs = duration && typeof duration === 'object' && !Array.isArray(duration) ? duration.elapsedMs : duration;
  if (!Number.isSafeInteger(elapsedMs) || elapsedMs < 0) return invalid('invalid_duration', '对局耗时必须是非负整数毫秒。');
  const limit = config.mode === 'classic' ? CLASSIC_LIMITS[config.game] ?? MAX_SCORE : MAX_SCORE;
  if (score > limit) return invalid('score_limit', '分数超过这个玩法的合理范围。');
  const envelope = SCORE_ENVELOPES[config.game];
  if (envelope && score > envelope.headroom + elapsedMs / 1000 * envelope.perSecond) {
    return invalid('score_too_fast', '当前对局耗时与分数不符，请重新确认成绩。');
  }
  return { ok: true };
}
