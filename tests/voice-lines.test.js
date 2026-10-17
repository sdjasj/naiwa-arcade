import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { VOICE_LINES, voiceForEvent } from '../js/voice-lines.js';

test('recorded line manifest gives truthful originals and only local short assets', async () => {
  assert.deepEqual(Object.keys(VOICE_LINES), ['kakatte', 'andy']);
  assert.equal(VOICE_LINES.kakatte.original, 'かかってらっしゃい');
  assert.equal(VOICE_LINES.andy.original, 'アンディ');
  for (const [id, line] of Object.entries(VOICE_LINES)) {
    assert.equal(line.id, id);
    assert.equal(line.file, `../assets/voices/${id}.mp3`);
    const bytes = await readFile(new URL(`../assets/voices/${id}.mp3`, import.meta.url));
    assert.ok(bytes.length > 5000 && bytes.length < 50_000, `${id} must be a small real audio excerpt`);
    assert.equal(bytes.toString('ascii', 0, 3), 'ID3');
    const tagSize = ((bytes[6] & 127) << 21) + ((bytes[7] & 127) << 14) + ((bytes[8] & 127) << 7) + (bytes[9] & 127);
    const frame = 10 + tagSize;
    assert.equal(bytes[frame], 255, 'an MPEG audio frame follows the ID3 metadata');
    assert.equal(bytes[frame + 1] & 224, 224);
  }
});

test('event mappings alternate short lines with laughter and never replace victory', () => {
  for (const event of ['laugh:start', 'laugh:special', 'laugh:combo']) {
    assert.equal(voiceForEvent(event, 0), 'kakatte');
    assert.equal(voiceForEvent(event, 1), null);
    assert.equal(voiceForEvent(event, 2), 'kakatte');
  }
  for (const event of ['laugh', 'laugh:hurt', 'laugh:boss']) assert.equal(voiceForEvent(event, 0), 'andy');
  for (const event of ['laugh:attack', 'laugh:guard', 'laugh:dash', 'laugh:upgrade', 'laugh:victory', 'unknown', 'toString']) {
    for (let variation = 0; variation < 10; variation++) assert.equal(voiceForEvent(event, variation), null);
  }
});
