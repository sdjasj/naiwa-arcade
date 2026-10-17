import test from 'node:test';
import assert from 'node:assert/strict';
import { FROG_SKINS, normalizeSkin, resolveSkin, castPose, CAST_CLIPS, sampleCastAnimation } from '../js/cast.js';
import { CAST_ATLASES } from '../js/cast-atlas.js';

test('cosmetic seats always contain the four distinct identities with the selected player first', () => {
  for (const { id } of FROG_SKINS) {
    const seats = [0, 1, 2, 3].map(skinSlot => resolveSkin(id, { skinSlot }));
    assert.equal(seats[0], id);
    assert.equal(new Set(seats).size, 4);
    assert.deepEqual(new Set(seats), new Set(FROG_SKINS.map(skin => skin.id)));
    assert.equal(resolveSkin(id, { skinSlot: 4 }), id);
    assert.equal(resolveSkin(id, { skin: 'naigou', skinSlot: 1 }), 'naigou');
  }
  assert.equal(normalizeSkin('constructor'), 'naiwa');
  assert.equal(normalizeSkin(null), 'naiwa');
  assert.equal(resolveSkin('naidan', { skin: 'bad', skinSlot: NaN }), 'naidan');
});

test('all fighter action names have a bounded six-row cast animation', () => {
  for (const name of ['idle', 'run', 'walk', 'backwalk', 'dash', 'light', 'heavy', 'hurt', 'guard', 'jump', 'airLight', 'airHeavy', 'kick', 'laugh']) {
    assert.ok(CAST_CLIPS[name]);
    for (const time of [0, .01, .5, 1, 1000, -1, Infinity, NaN]) {
      const pose = sampleCastAnimation(name, time);
      assert.ok(pose.row >= 0 && pose.row < 6);
      assert.ok(pose.frame >= 0 && pose.frame < 6);
      assert.ok(pose.next >= 0 && pose.next < 6);
      assert.ok(pose.blend >= 0 && pose.blend <= 1);
      assert.deepEqual(sampleCastAnimation(name, time), pose, 'A paused clock must hold the same frame');
    }
  }
});

test('retreat reverses the movement cycle and attack progress holds its recovery frame', () => {
  assert.equal(sampleCastAnimation('backwalk', 0).frame, 5);
  assert.equal(sampleCastAnimation('backwalk', 1 / 9).frame, 4);
  assert.equal(sampleCastAnimation('run', .5).frame, 0);
  assert.equal(sampleCastAnimation('heavy', 0, 2).frame, 5);
  assert.equal(sampleCastAnimation('heavy', 0, -1).frame, 0);
  assert.equal(sampleCastAnimation('airLight', 999).frame, 5);
});

test('hurt and held guard never cross into each other in the shared reaction row', () => {
  for (let t = 0; t < 10; t += .01) {
    const hurt = sampleCastAnimation('hurt', t), guard = sampleCastAnimation('guard', t);
    assert.ok(hurt.frame <= 2 && hurt.next <= 2);
    assert.ok(guard.frame >= 3 && guard.next >= 3);
  }
  assert.equal(sampleCastAnimation('hurt', 10).frame, 2);
  assert.equal(sampleCastAnimation('guard', 10).frame, 4);
});

test('existing game expressions select recognizable cast reactions and unknown values are safe', () => {
  assert.equal(castPose({ expression: 'laugh' }), 'laugh');
  assert.equal(castPose({ expression: 'squish' }), 'hurt');
  assert.equal(castPose({ pose: 'run' }), 'run');
  assert.equal(castPose({ animation: 'airHeavy', expression: 'angry' }), 'airHeavy');
  assert.equal(castPose({ pose: 'angry' }), 'guard');
  assert.equal(castPose({ pose: 'constructor' }), 'idle');
  assert.deepEqual(sampleCastAnimation('__proto__'), sampleCastAnimation('idle'));
});

test('all 108 cast crops preserve their cells and fit the shared transition surface', () => {
  let count = 0;
  assert.deepEqual(Object.keys(CAST_ATLASES).sort(), ['naidan', 'naigou', 'naishu']);
  for (const atlas of Object.values(CAST_ATLASES)) {
    assert.equal(atlas.frames.length, 6);
    assert.equal(atlas.width, atlas.cellWidth * 6);
    assert.equal(atlas.height, atlas.cellHeight * 6);
    for (const [row, frames] of atlas.frames.entries()) {
      assert.equal(frames.length, 6);
      for (const [column, frame] of frames.entries()) {
        assert.ok(frame.x >= column * atlas.cellWidth && frame.x + frame.width <= (column + 1) * atlas.cellWidth);
        assert.ok(frame.y >= row * atlas.cellHeight && frame.y + frame.height <= (row + 1) * atlas.cellHeight);
        assert.ok(frame.foot > 0 && frame.foot <= frame.height);
        const scale = atlas.scales[row];
        const x = 160 + (frame.left - atlas.cellWidth / 2) * scale;
        const y = 288 - frame.foot * scale;
        assert.ok(x >= 0 && x + frame.width * scale <= 320);
        assert.ok(y >= 0 && y + frame.height * scale <= 320);
        count++;
      }
    }
  }
  assert.equal(count, 108);
});
