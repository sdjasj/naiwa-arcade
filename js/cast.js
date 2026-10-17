// Cosmetic identities are separate from fighter classes and leaderboard keys.
export const FROG_SKINS = Object.freeze([
  Object.freeze({ id: 'naiwa', name: '奶蛙' }),
  Object.freeze({ id: 'naidan', name: '奶蛋' }),
  Object.freeze({ id: 'naigou', name: '奶狗' }),
  Object.freeze({ id: 'naishu', name: '奶鼠' }),
]);
const ids = FROG_SKINS.map(skin => skin.id);
export const normalizeSkin = id => ids.includes(id) ? id : 'naiwa';

export function resolveSkin(selected, options = {}) {
  if (ids.includes(options.skin)) return options.skin;
  const base = normalizeSkin(selected);
  const slot = Number.isInteger(options.skinSlot) ? ((options.skinSlot % ids.length) + ids.length) % ids.length : 0;
  return [base, ...ids.filter(id => id !== base)][slot];
}

const sequence = [0, 1, 2, 3, 4, 5];
const clip = (row, fps, loop = false, frames = sequence) => Object.freeze({ row, fps, loop, frames: Object.freeze([...frames]) });
export const CAST_CLIPS = Object.freeze({
  idle: clip(0, 5, true),
  walk: clip(1, 6, true),
  run: clip(1, 12, true),
  backwalk: clip(1, 9, true, [5, 4, 3, 2, 1, 0]),
  dash: clip(1, 18),
  light: clip(2, 15),
  heavy: clip(2, 10),
  airLight: clip(2, 15),
  airHeavy: clip(2, 12),
  kick: clip(2, 12),
  hurt: clip(3, 12, false, [0, 1, 2]),
  // The sixth reaction frame releases guard. Holding the button must keep
  // the fifth frame's defensive pose until the game's transition to idle.
  guard: clip(3, 12, false, [3, 4]),
  jump: clip(4, 10),
  laugh: clip(5, 9, true),
});

export function castPose(options = {}) {
  if (Object.hasOwn(CAST_CLIPS, options.animation)) return options.animation;
  if (options.expression === 'hurt' || options.expression === 'squish') return 'hurt';
  if (options.expression === 'laugh' || options.pose === 'laugh' || options.pose === 'belly') return 'laugh';
  if (Object.hasOwn(CAST_CLIPS, options.pose)) return options.pose;
  if (options.expression === 'angry' || options.pose === 'angry') return 'guard';
  return 'idle';
}

export function sampleCastAnimation(name, time = 0, progress) {
  const data = Object.hasOwn(CAST_CLIPS, name) ? CAST_CLIPS[name] : CAST_CLIPS.idle;
  const last = data.frames.length - 1;
  const position = Number.isFinite(progress)
    ? Math.max(0, Math.min(1, progress)) * last
    : Math.max(0, Number.isFinite(time) ? time : 0) * data.fps;
  const cursor = data.loop && !Number.isFinite(progress) ? position % data.frames.length : Math.min(last, position);
  const index = Math.floor(cursor), next = data.loop ? (index + 1) % data.frames.length : Math.min(last, index + 1);
  return { row: data.row, frame: data.frames[index], next: data.frames[next], blend: Math.max(0, (cursor - index - .65) / .35) };
}
