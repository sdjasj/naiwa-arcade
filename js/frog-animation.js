// Game clocks, rather than wall time, drive these clips so pause and hit-stop
// freeze both the pose and the transition. All atlases contain six frames/row.
export const FROG_CLIPS = Object.freeze({
  idle: Object.freeze({ atlas: 'motion', row: 0, fps: 5, loop: true }),
  run: Object.freeze({ atlas: 'motion', row: 1, fps: 12, loop: true }),
  dash: Object.freeze({ atlas: 'motion', row: 2, fps: 18, loop: false }),
  laugh: Object.freeze({ atlas: 'motion', row: 3, fps: 9, loop: true }),
  light: Object.freeze({ atlas: 'combat', row: 0, fps: 15, loop: false }),
  heavy: Object.freeze({ atlas: 'combat', row: 1, fps: 10, loop: false }),
  hurt: Object.freeze({ atlas: 'combat', row: 2, fps: 15, loop: false }),
  guard: Object.freeze({ atlas: 'combat', row: 3, fps: 14, loop: false }),
});

export function sampleFrogAnimation(name, time = 0, progress) {
  const clip = FROG_CLIPS[name];
  if (!clip) return null;
  const position = Number.isFinite(progress)
    ? Math.max(0, Math.min(1, progress)) * 5
    : Math.max(0, Number.isFinite(time) ? time : 0) * clip.fps;
  const cursor = clip.loop && !Number.isFinite(progress) ? position % 6 : Math.min(5, position);
  const frame = Math.floor(cursor);
  // A short dissolve softens the step without blurring the whole action.
  const blend = Math.max(0, (cursor - frame - 0.65) / 0.35);
  return { atlas: clip.atlas, row: clip.row, frame, next: clip.loop ? (frame + 1) % 6 : Math.min(5, frame + 1), blend };
}
