import test from 'node:test';
import assert from 'node:assert/strict';
import { FROG_CLIPS, sampleFrogAnimation } from '../js/frog-animation.js';
import { FROG_ATLASES } from '../js/frog-atlas.js';

test('running wraps smoothly and a stopped game clock samples an identical pose', () => {
  const pose = sampleFrogAnimation('run', 0.495);
  assert.equal(pose.frame, 5); assert.equal(pose.next, 0); assert.ok(pose.blend > .5);
  assert.deepEqual(sampleFrogAnimation('run', 0.495), pose);
  assert.equal(sampleFrogAnimation('run', .5).frame, 0);
});

test('attack progress and held guard never read a frame from the next row', () => {
  for (const name of Object.keys(FROG_CLIPS)) {
    assert.equal(sampleFrogAnimation(name, 100, -1).frame, 0);
    const last = sampleFrogAnimation(name, 100, 1.01);
    assert.equal(last.frame, 5); assert.equal(last.blend, 0);
  }
  assert.equal(sampleFrogAnimation('guard', 500).frame, 5);
  assert.equal(sampleFrogAnimation('hurt', 500).next, 5);
  assert.equal(sampleFrogAnimation('light', 0, .6).frame, 3);
});

test('invalid clocks and unsupported actions have a safe initial frame or fallback', () => {
  for (const time of [-10, Infinity, NaN, undefined]) assert.equal(sampleFrogAnimation('run', time).frame, 0);
  assert.equal(sampleFrogAnimation('missing'), null);
});

test('all 72 alpha crops stay in their cells and inside the compositing surface', () => {
  let count = 0;
  for (const atlas of Object.values(FROG_ATLASES)) atlas.frames.forEach((row, ri) => row.forEach((frame, ci) => {
    assert.ok(frame.x >= ci * 256 && frame.x + frame.width <= (ci + 1) * 256);
    assert.ok(frame.y >= ri * 256 && frame.y + frame.height <= (ri + 1) * 256);
    const scale = atlas.scales[ri], x = 160 + (frame.left - 128) * scale, y = 288 - frame.foot * scale;
    assert.ok(x >= 0 && x + frame.width * scale <= 320);
    assert.ok(y >= 0 && y + frame.height * scale <= 320);
    count++;
  }));
  assert.equal(count, 72);
});
