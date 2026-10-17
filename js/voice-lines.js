// Real recorded, locally bundled excerpts; see docs/voice-sources.md.
// No speech synthesis or imitated voice is used for these lines.
export const VOICE_LINES = Object.freeze({
  kakatte: Object.freeze({ id: 'kakatte', label: '刚刚跌落水', original: 'かかってらっしゃい', meaning: '放马过来', file: '../assets/voices/kakatte.mp3' }),
  andy: Object.freeze({ id: 'andy', label: '安迪', original: 'アンディ', meaning: '安迪（角色名）', file: '../assets/voices/andy-v3.mp3' }),
});

// Alternate accepted repeats with the familiar laugh. Small attacks keep their
// compact laughs; a spoken line is never squeezed into those timings.
export function voiceForEvent(kind, variation = 0) {
  if (variation % 2 !== 0) return null;
  if (['laugh:start', 'laugh:special', 'laugh:combo'].includes(kind)) return 'kakatte';
  if (['laugh', 'laugh:hurt', 'laugh:boss'].includes(kind)) return 'andy';
  return null;
}
