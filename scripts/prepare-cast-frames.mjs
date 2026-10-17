// Normalize generated 36-pose RGBA sheets into game atlases without repainting
// their pixels. Preserve original foreground alpha and its antialias fringe;
// discard disconnected low-alpha background speckles. One scale per character
// preserves proportions; connected foreground bounds prevent crossed grid lines
// from cutting off a mouse tail, floppy ear, or lunging dog paw.
// Usage: node scripts/prepare-cast-frames.mjs [egg.png dog.png mouse.png]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const names = ['naidan', 'naigou', 'naishu'];
const supplied = process.argv.slice(2);
if (supplied.length && supplied.length !== 3) throw new Error('Provide all three character PNG paths, or no arguments for the generated defaults.');
const inputs = supplied.length ? supplied : names.map(name => `output/imagegen/${name}-cast-v1.png`);
const cached = join(homedir(), '.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell');
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync(cached) ? cached : undefined);
const browser = await chromium.launch({ executablePath });
const atlases = {}, diagnostics = {};
try {
  const page = await browser.newPage();
  await mkdir('assets/cast', { recursive: true });
  await mkdir('output/imagegen', { recursive: true });
  for (const [index, name] of names.entries()) {
    const data = (await readFile(inputs[index])).toString('base64');
    const result = await page.evaluate(async ({ base64, name }) => {
      const source = new Image(); source.src = `data:image/png;base64,${base64}`; await source.decode();
      const sw = source.width, sh = source.height;
      if (sw !== sh || sw < 768) throw new Error(`${name}: expected a square 6×6 sprite sheet of at least 768px.`);
      const input = document.createElement('canvas'); input.width = sw; input.height = sh;
      const inputContext = input.getContext('2d', { willReadFrequently: true }); inputContext.drawImage(source, 0, 0);
      const pixels = inputContext.getImageData(0, 0, sw, sh).data;
      const labels = new Int32Array(sw * sh), queue = new Int32Array(sw * sh), components = [];
      let label = 0, transparent = 0, softAlpha = 0;
      for (let pixel = 0; pixel < labels.length; pixel++) {
        const alpha = pixels[pixel * 4 + 3];
        if (!alpha) transparent++; else if (alpha < 255) softAlpha++;
        if (alpha < 48 || labels[pixel]) continue;
        label++; let head = 0, tail = 0, left = sw, top = sh, right = 0, bottom = 0;
        queue[tail++] = pixel; labels[pixel] = label;
        while (head < tail) {
          const current = queue[head++], x = current % sw, y = Math.floor(current / sw);
          left = Math.min(left, x); right = Math.max(right, x + 1); top = Math.min(top, y); bottom = Math.max(bottom, y + 1);
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            if ((!dx && !dy) || x + dx < 0 || x + dx >= sw || y + dy < 0 || y + dy >= sh) continue;
            const neighbor = current + dy * sw + dx;
            if (!labels[neighbor] && pixels[neighbor * 4 + 3] >= 48) { labels[neighbor] = label; queue[tail++] = neighbor; }
          }
        }
        if (tail >= 1500) components.push({ label, left, top, right, bottom, area: tail });
      }
      if (transparent < sw * sh * 0.2) throw new Error(`${name}: missing genuine transparent background.`);
      if (components.length !== 36) throw new Error(`${name}: expected 36 separate character silhouettes, found ${components.length}.`);
      components.sort((a, b) => (a.top + a.bottom) - (b.top + b.bottom));
      const rows = Array.from({ length: 6 }, (_, row) => components.slice(row * 6, row * 6 + 6)
        .sort((a, b) => (a.left + a.right) - (b.left + b.right)));
      const boxes = rows.flat().map(component => ({ ...component,
        x: Math.max(0, component.left - 3), y: Math.max(0, component.top - 3),
        width: Math.min(sw, component.right + 3) - Math.max(0, component.left - 3),
        height: Math.min(sh, component.bottom + 3) - Math.max(0, component.top - 3) }));
      const scale = Math.min(216 / Math.max(...boxes.map(box => box.width)), 212 / Math.max(...boxes.map(box => box.height)));
      const canvas = document.createElement('canvas'); canvas.width = 1536; canvas.height = 1536;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      let discardedSpeckles = 0;
      for (const [frame, box] of boxes.entries()) {
        // Bounding rectangles can overlap at corners without the actual poses
        // touching. Isolate the identified silhouette, keeping its original
        // RGBA values and up to three pixels of softer antialiased fringe.
        const crop = document.createElement('canvas'); crop.width = box.width; crop.height = box.height;
        const cropContext = crop.getContext('2d'), isolated = cropContext.createImageData(box.width, box.height);
        for (let y = 0; y < box.height; y++) for (let x = 0; x < box.width; x++) {
          const sx = box.x + x, sy = box.y + y, sourceIndex = sy * sw + sx, alpha = pixels[sourceIndex * 4 + 3];
          if (!alpha) continue;
          let keep = labels[sourceIndex] === box.label;
          if (!keep && alpha < 48) {
            for (let dy = -3; dy <= 3 && !keep; dy++) for (let dx = -3; dx <= 3; dx++) {
              if (sx + dx >= 0 && sx + dx < sw && sy + dy >= 0 && sy + dy < sh && labels[(sy + dy) * sw + sx + dx] === box.label) { keep = true; break; }
            }
          }
          if (keep) isolated.data.set(pixels.subarray(sourceIndex * 4, sourceIndex * 4 + 4), (y * box.width + x) * 4);
          else discardedSpeckles++;
        }
        cropContext.putImageData(isolated, 0, 0);
        const col = frame % 6, row = Math.floor(frame / 6), w = Math.round(box.width * scale), h = Math.round(box.height * scale);
        const x = col * 256 + Math.round((256 - w) / 2), y = row * 256 + 233 - h;
        ctx.drawImage(crop, 0, 0, box.width, box.height, x, y, w, h);
      }
      const output = ctx.getImageData(0, 0, 1536, 1536).data, frames = [];
      let minimumMargin = 256;
      for (let row = 0; row < 6; row++) {
        const cells = [];
        for (let col = 0; col < 6; col++) {
          let left = 256, top = 256, right = 0, bottom = 0, solid = 0;
          for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
            if (output[((row * 256 + y) * 1536 + col * 256 + x) * 4 + 3] < 48) continue;
            left = Math.min(left, x); right = Math.max(right, x + 1); top = Math.min(top, y); bottom = Math.max(bottom, y + 1); solid++;
          }
          const margin = Math.min(left, top, 256 - right, 256 - bottom); minimumMargin = Math.min(minimumMargin, margin);
          if (solid < 1200 || solid > 50000 || margin < 12) throw new Error(`${name} ${row},${col}: invalid alpha or clipped sprite.`);
          const x = Math.max(0, left - 3), y = Math.max(0, top - 3);
          cells.push({ x: col * 256 + x, y: row * 256 + y, width: Math.min(256, right + 3) - x,
            height: Math.min(256, bottom + 3) - y, left: x, foot: bottom - y });
        }
        frames.push(cells);
      }
      const encoded = canvas.toDataURL('image/webp', 0.93).split(',')[1];
      return { frames, encoded, sourceWidth: sw, sourceHeight: sh, sourceBounds: boxes, rescale: scale,
        transparentPixels: transparent, softAlphaPixels: softAlpha, discardedSpeckles, minimumMargin };
    }, { base64: data, name });
    const file = `${name}-v1.webp`, bytes = Buffer.from(result.encoded, 'base64');
    await writeFile(`assets/cast/${file}`, bytes);
    atlases[name] = { file, width: 1536, height: 1536, cellWidth: 256, cellHeight: 256, frames: result.frames, scales: [1, 1, 1, 1, 1, 1] };
    const { encoded, frames, ...metadata } = result;
    diagnostics[name] = { input: inputs[index], file, bytes: bytes.length, ...metadata };
    console.log(`${name}: 36 RGBA poses, 1536×1536, ${Math.round(bytes.length / 1024)} KiB, minimum silhouette margin ${result.minimumMargin}px`);
  }
  await writeFile('js/cast-atlas.js', `// Generated by scripts/prepare-cast-frames.mjs. Each row has six full alpha-preserved poses.\n// Rows: idle, move, attack, hurt/guard (3+3), jump, laugh. Foot is relative to each crop.\nexport const CAST_ATLASES = ${JSON.stringify(atlases, null, 2)};\n`);
  await writeFile('output/imagegen/cast-frame-validation.json', `${JSON.stringify(diagnostics, null, 2)}\n`);
} finally { await browser.close(); }
