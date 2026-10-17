import { FROG_ATLASES } from './frog-atlas.js?v=a6800964d112';
import { sampleFrogAnimation } from './frog-animation.js?v=a6800964d112';
import { CAST_ATLASES } from './cast-atlas.js?v=a6800964d112';
import { FROG_SKINS, normalizeSkin, resolveSkin, castPose, sampleCastAnimation } from './cast.js?v=a6800964d112';
export { FROG_SKINS } from './cast.js?v=a6800964d112';

// Meme sprite provided by NaiLoong / linalg. New action frames are generated
// from that identity reference; see assets/ATTRIBUTION.md.
const sheet = new Image();
sheet.src = new URL('../assets/naifrog-sheet.webp', import.meta.url).href;
const actionSheets = Object.fromEntries(Object.entries(FROG_ATLASES).map(([name, atlas]) => {
  const image = new Image();
  image.src = new URL(`../assets/animation/${atlas.file}`, import.meta.url).href;
  return [name, image];
}));
export const frogReady = Promise.all([sheet, ...Object.values(actionSheets)].map(image => image.decode().catch(() => undefined)));
const actionSheetReady = name => actionSheets[name]?.complete && actionSheets[name].naturalWidth === 1536 && actionSheets[name].naturalHeight === 1024;
let selectedSkin = 'naiwa';
const castSheets = {}, castLoads = new Map();
const castSheetReady = id => Boolean(castSheets[id]?.complete && castSheets[id].naturalWidth === CAST_ATLASES[id]?.width && castSheets[id].naturalHeight === CAST_ATLASES[id]?.height);
export const getFrogSkin = () => selectedSkin;
export function setFrogSkin(id) {
  selectedSkin = normalizeSkin(id);
  ensureSkinReady(selectedSkin);
  return selectedSkin;
}
export function ensureSkinReady(id) {
  id = normalizeSkin(id);
  if (id === 'naiwa') return frogReady.then(() => Boolean(sheet.naturalWidth));
  if (castSheetReady(id)) return Promise.resolve(true);
  if (castLoads.has(id)) return castLoads.get(id);
  const atlas = CAST_ATLASES[id];
  if (!atlas) return Promise.resolve(false);
  const image = new Image(); castSheets[id] = image;
  image.src = new URL(`../assets/cast/${atlas.file}`, import.meta.url).href;
  const pending = image.decode().then(() => castSheetReady(id)).catch(() => false).finally(() => castLoads.delete(id));
  castLoads.set(id, pending);
  return pending;
}
export const getFrogSkinName = options => FROG_SKINS.find(skin => skin.id === resolveSkin(selectedSkin, options))?.name || '奶蛙';
export function frogAnimationStatus() {
  return Object.fromEntries(Object.keys(actionSheets).map(name => [name, actionSheetReady(name)]));
}
// Composite frame dissolves offscreen. Additive alpha here preserves opacity
// without adding the sprite's color to the game background or drawing ghosts.
const animationCanvas = document.createElement('canvas');
animationCanvas.width = animationCanvas.height = 320;
const animationContext = animationCanvas.getContext('2d');
function drawActionFrame(ctx, size, options, skin) {
  const isCast = skin !== 'naiwa';
  if (isCast && !castSheetReady(skin)) return false;
  function sample(name, time, progress) {
    if (isCast) return { ...sampleCastAnimation(name, time, progress), atlas: skin };
    const pose = sampleFrogAnimation(name, time, progress);
    return pose && actionSheetReady(pose.atlas) ? pose : null;
  }
  const current = sample(isCast ? castPose(options) : options.animation, isCast ? options.animationTime ?? animationTime : options.animationTime, options.animationProgress);
  if (!current) return false;
  const atlasFor = pose => isCast ? CAST_ATLASES[pose.atlas] : FROG_ATLASES[pose.atlas];
  const sheetFor = pose => isCast ? castSheets[pose.atlas] : actionSheets[pose.atlas];
  const from = options.animationFrom;
  const previous = from && sample(from.name, from.time, from.progress);
  const mix = previous && Number.isFinite(options.animationMix) ? Math.max(0, Math.min(1, options.animationMix)) : 1;
  const unit = size * 1.6 / 256;
  // Most frames need no dissolve. Draw directly from the atlas in that case,
  // avoiding an offscreen surface copy for every spectator on mobile devices.
  if (mix === 1 && current.blend === 0) {
    const atlas = atlasFor(current), frame = atlas.frames[current.row][current.frame];
    const scale = atlas.scales[current.row] * unit;
    ctx.drawImage(sheetFor(current), frame.x, frame.y, frame.width, frame.height,
      (frame.left - (atlas.cellWidth || 256) / 2) * scale, size * .64 - frame.foot * scale, frame.width * scale, frame.height * scale);
    return true;
  }
  animationContext.clearRect(0, 0, 320, 320);
  animationContext.globalCompositeOperation = 'lighter';
  function layer(sample, opacity) {
    if (!sample || opacity <= 0) return;
    const atlas = atlasFor(sample), image = sheetFor(sample);
    if (!image.complete || !image.naturalWidth) return;
    const scale = atlas.scales[sample.row];
    for (const [index, weight] of [[sample.frame, 1 - sample.blend], [sample.next, sample.blend]]) {
      if (weight <= 0) continue;
      const frame = atlas.frames[sample.row][index];
      animationContext.globalAlpha = weight * opacity;
      animationContext.drawImage(image, frame.x, frame.y, frame.width, frame.height,
        160 + (frame.left - (atlas.cellWidth || 256) / 2) * scale, 288 - frame.foot * scale, frame.width * scale, frame.height * scale);
    }
  }
  layer(previous, 1 - mix); layer(current, mix);
  animationContext.globalAlpha = 1;
  ctx.drawImage(animationCanvas, -160 * unit, size * .64 - 288 * unit, 320 * unit, 320 * unit);
  return true;
}
let animationTime = 0;
export function setFrogTime(time) { animationTime = time; }

export function drawFrog(ctx, x, y, size, options = {}) {
  const { expression = 'happy', rotation = 0, scaleX = 1, scaleY = 1, wings = false, wingPhase = animationTime * 12 } = options;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.scale(scaleX, scaleY);
  if (wings) {
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(side * size * .25, -size * .08);
      ctx.rotate(side * (.3 + Math.sin(wingPhase) * .5));
      ctx.scale(-side, 1);
      ctx.fillStyle = '#fffef3'; ctx.strokeStyle = '#bbbba3'; ctx.lineWidth = Math.max(1, size * .012);
      ctx.beginPath(); ctx.moveTo(0, 0);
      ctx.bezierCurveTo(-size * .17, -size * .15, -size * .47, -size * .47, -size * .49, -size * .22);
      ctx.bezierCurveTo(-size * .55, -size * .21, -size * .56, -size * .12, -size * .43, -size * .06);
      ctx.bezierCurveTo(-size * .49, size * .04, -size * .2, size * .15, 0, 0);
      ctx.fill(); ctx.stroke(); ctx.restore();
    }
  }
  const animated = drawActionFrame(ctx, size, options, resolveSkin(selectedSkin, options));
  if (!animated && sheet.complete && sheet.naturalWidth) {
    let row = 0, col = Math.floor(animationTime * 2) % 6;
    if (expression === 'laugh') { row = 4; col = 1 + Math.floor(animationTime * 9) % 4; }
    else if (expression === 'angry') { row = 8; col = 2; }
    else if (expression === 'hurt' || expression === 'squish') { row = 5; col = 3; }
    else if (expression === 'smug') { row = 8; col = 5; }
    const poses = { idle: [0, 0], wave: [3, 1], run: [1, 3], shy: [7, 0], think: [6, 3], angry: [8, 2], sleep: [5, 4], smug: [8, 5], belly: [4, 0], laugh: [4, 1 + Math.floor(animationTime * 7) % 4] };
    if (poses[options.pose]) [row, col] = poses[options.pose];
    const stretch = expression === 'laugh' ? Math.sin(animationTime * 22) * .025 : 0;
    ctx.scale(1 + stretch, 1 - stretch);
    ctx.drawImage(sheet, col * 192, row * 208, 192, 208, -size * .7, -size * .88, size * 1.4, size * 1.52);
  } else if (!animated) {
    // Lightweight fallback only used if the local image cannot load.
    const grad = ctx.createRadialGradient(-size * .15, -size * .2, 1, 0, 0, size * .65);
    grad.addColorStop(0, '#fff090'); grad.addColorStop(1, '#e8b94c');
    ctx.fillStyle = grad; ctx.beginPath(); ctx.ellipse(0, 0, size * .43, size * .55, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff2cc'; ctx.beginPath(); ctx.ellipse(0, size * .08, size * .31, size * .32, 0, 0, Math.PI * 2); ctx.fill();
    for (const side of [-1, 1]) {
      ctx.fillStyle = '#a5c974'; ctx.beginPath(); ctx.arc(side * size * .19, -size * .36, size * .11, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#26341d'; ctx.beginPath(); ctx.arc(side * size * .19, -size * .36, size * .055, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = '#766133'; ctx.lineWidth = size * .018; ctx.beginPath(); ctx.arc(0, -size * .25, size * .13, .15, Math.PI - .15); ctx.stroke();
  }
  if (options.crown) {
    ctx.fillStyle = '#edb52f'; ctx.strokeStyle = '#a77926'; ctx.lineWidth = Math.max(1, size * .018);
    ctx.beginPath(); ctx.moveTo(-size * .22, -size * .73); ctx.lineTo(-size * .27, -size * .97); ctx.lineTo(-size * .1, -size * .87); ctx.lineTo(0, -size * 1.03); ctx.lineTo(size * .1, -size * .87); ctx.lineTo(size * .27, -size * .97); ctx.lineTo(size * .22, -size * .73); ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

function cloud(ctx, x, y, s = 1) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.fillStyle = '#ffffffbb'; ctx.beginPath();
  ctx.ellipse(0, 0, 52, 16, 0, 0, Math.PI * 2); ctx.ellipse(-18, -12, 25, 23, 0, 0, Math.PI * 2); ctx.ellipse(18, -18, 27, 29, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
}

export function drawHero(ctx, time) {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#617a4416'; ctx.beginPath(); ctx.ellipse(325, 378, 121, 15, -.03, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#bbcba2'; ctx.lineWidth = 2; ctx.setLineDash([5, 7]); ctx.beginPath(); ctx.moveTo(114, 244); ctx.bezierCurveTo(169, 192, 138, 320, 242, 312); ctx.stroke(); ctx.setLineDash([]);
  drawFrog(ctx, 335, 231 + Math.sin(time * 2) * 7, 211, { expression: 'laugh', wings: true, rotation: -.08, wingPhase: time * 6 });
  ctx.save(); ctx.translate(444, 306); ctx.rotate(.17); ctx.fillStyle = '#8fab62'; ctx.strokeStyle = '#506e42'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.roundRect(-5, 10, 63, 89, 3); ctx.fill(); ctx.stroke(); ctx.fillStyle = '#a8c681';ctx.beginPath();ctx.roundRect(-11, 3, 75, 19, 4);ctx.fill();ctx.stroke();ctx.fillStyle='#bfd69e';ctx.fillRect(4,28,9,61);ctx.restore();
  ctx.font = '600 13px sans-serif';ctx.fillStyle='#8c9c70';ctx.fillText('呱？',164,127);
}

export function drawCard(ctx, game) {
  const w = 640, h = 330;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = { flappy: '#dfeeda', angry: '#f7e9cf', whack: '#e9e6f3', catch: '#dceef1', jump: '#f1e0e8', merge: '#f2ebca', fighter: '#f1ded1', survivor: '#dbe6d9', bomber: '#e7dff0', aim: '#172d32', guandan: '#244c42' }[game]; ctx.fillRect(0, 0, w, h);
  if (game === 'guandan') {
    ctx.save();
    ctx.fillStyle = '#386655'; ctx.strokeStyle = '#b6bd8066'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(320, 224, 275, 109, 0, 0, Math.PI*2); ctx.fill(); ctx.stroke();
    drawFrog(ctx, 158, 155, 99, { skinSlot: 0, animation: 'laugh', animationTime: .5, expression: 'laugh' });
    drawFrog(ctx, 490, 154, 98, { skinSlot: 1, animation: 'laugh', animationTime: .2, expression: 'laugh', scaleX: -1 });
    for (const [i, face] of ['A', 'A', '♥2', 'K', 'K'].entries()) {
      ctx.save(); ctx.translate(234 + i*43, 238); ctx.rotate((i-2)*.1);
      ctx.fillStyle = i === 2 ? '#fff0c7' : '#fffdf0'; ctx.strokeStyle = '#c8cfb2'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(-28,-48,56,82,6); ctx.fill(); ctx.stroke();
      ctx.fillStyle = i === 2 ? '#b65442' : '#354f40'; ctx.font = 'bold 25px Georgia'; ctx.textAlign = 'center'; ctx.fillText(face,0,-13);
      ctx.font = '21px Georgia'; ctx.fillText(i === 2 ? '配' : i%2 ? '♣' : '♠',0,17); ctx.restore();
    }
    ctx.fillStyle = '#e2d99e'; ctx.textAlign = 'center'; ctx.font = '600 16px sans-serif'; ctx.fillText('奶家人同桌 · 笑到头游', 320, 75);
    ctx.restore();
  } else if (game === 'aim') {
    ctx.save();
    ctx.strokeStyle = '#34524f'; ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 64) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = 0; y < h; y += 55) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    for (const [x, y, r] of [[165, 120, 27], [360, 190, 38], [494, 95, 23]]) {
      const glow = ctx.createRadialGradient(x-r*.35, y-r*.35, 1, x, y, r);
      glow.addColorStop(0, '#deffe0'); glow.addColorStop(.4, '#9beac2'); glow.addColorStop(1, '#3c9f90');
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.fill();
      ctx.strokeStyle = '#83d6b144'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r+9, 0, Math.PI*2); ctx.stroke();
    }
    ctx.strokeStyle = '#f8e9ae'; ctx.lineWidth = 2;
    for (const [x,y,dx,dy] of [[360,174,0,-12],[360,206,0,12],[344,190,-12,0],[376,190,12,0]]) { ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x+dx,y+dy); ctx.stroke(); }
    ctx.globalAlpha = .9; drawFrog(ctx, 170, 246, 78, { pose: 'smug' });
    ctx.fillStyle = '#b6d9bd'; ctx.font = '600 12px sans-serif'; ctx.fillText('FOCUS. CLICK. QUACK.', 298, 281);
    ctx.restore();
  } else if (game === 'flappy') {
    cloud(ctx, 155, 88, .8); cloud(ctx, 426, 62, .65);
    ctx.fillStyle = '#c5dcb3';ctx.beginPath();ctx.ellipse(470,366,340,120,0,0,Math.PI*2);ctx.fill();
    for (const [x,y,hh] of [[85,-20,123],[482,210,160]]) {
      ctx.fillStyle = '#8cab6c';ctx.strokeStyle = '#547742';ctx.lineWidth = 3;ctx.beginPath();ctx.roundRect(x,y,72,hh,4);ctx.fill();ctx.stroke();
      ctx.fillStyle = '#c3d99c';ctx.fillRect(x+12,y+9,9,hh-18);ctx.fillStyle='#a7c183';ctx.beginPath();ctx.roundRect(x-7,y<0?y+hh-23:y-4,86,24,4);ctx.fill();ctx.stroke();
    }
    ctx.strokeStyle='#afc398';ctx.lineWidth=2;ctx.setLineDash([5,7]);ctx.beginPath();ctx.moveTo(184,244);ctx.quadraticCurveTo(210,188,268,204);ctx.stroke();ctx.setLineDash([]);
    drawFrog(ctx,322,184,137,{expression:'happy',wings:true,rotation:-.15,wingPhase:1});
    ctx.fillStyle='#688151';ctx.font='bold 22px sans-serif';ctx.fillText('!',421,130);
  } else if (game === 'angry') {
    cloud(ctx,330,100,.9);ctx.fillStyle='#e8d5ae';ctx.beginPath();ctx.ellipse(370,399,420,140,0,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle='#785943';ctx.lineWidth=17;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(213,286);ctx.lineTo(210,198);ctx.lineTo(168,152);ctx.moveTo(210,198);ctx.lineTo(250,148);ctx.stroke();
    ctx.strokeStyle='#886049';ctx.lineWidth=7;ctx.beginPath();ctx.moveTo(168,152);ctx.lineTo(137,188);ctx.lineTo(250,148);ctx.stroke();
    drawFrog(ctx,150,173,109,{expression:'angry',rotation:-.4,scaleX:1.12});
    ctx.strokeStyle='#c6ad81';ctx.lineWidth=3;ctx.setLineDash([3,12]);ctx.beginPath();ctx.moveTo(238,134);ctx.quadraticCurveTo(370,39,465,191);ctx.stroke();ctx.setLineDash([]);
    for (const [x,y,ww,hh] of [[470,233,26,71],[557,233,26,71],[461,212,132,22],[495,157,23,55],[548,157,23,55],[484,140,98,20]]) {ctx.fillStyle='#c98c62';ctx.strokeStyle='#a9704e';ctx.lineWidth=2;ctx.beginPath();ctx.roundRect(x,y,ww,hh,3);ctx.fill();ctx.stroke();ctx.fillStyle='#e2b183';ctx.fillRect(x+4,y+4,ww-8,4);}
  } else if (game === 'whack') {
    ctx.strokeStyle='#dcd5e9';ctx.lineWidth=1;
    for(let x=0;x<w;x+=58){ctx.beginPath();ctx.moveTo(x,130);ctx.lineTo(x-100,h);ctx.stroke();}
    for(let y=153;y<h;y+=51){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}
    for (const [x,y] of [[159,232],[321,255],[494,230]]) {ctx.fillStyle='#beb1c5';ctx.beginPath();ctx.ellipse(x,y,65,22,0,0,Math.PI*2);ctx.fill();ctx.fillStyle='#7f748b';ctx.beginPath();ctx.ellipse(x,y-3,57,17,0,0,Math.PI*2);ctx.fill();}
    ctx.save();ctx.beginPath();ctx.rect(85,70,150,158);ctx.clip();drawFrog(ctx,159,196,99,{expression:'smug',rotation:-.1});ctx.restore();
    ctx.save();ctx.beginPath();ctx.rect(260,70,133,179);ctx.clip();drawFrog(ctx,325,178,137,{expression:'laugh'});ctx.restore();
    ctx.save();ctx.translate(493,129);ctx.rotate(.5);ctx.fillStyle='#a98570';ctx.beginPath();ctx.roundRect(-9,0,18,102,5);ctx.fill();ctx.fillStyle='#bc9fd3';ctx.strokeStyle='#8e73a1';ctx.lineWidth=3;ctx.beginPath();ctx.roundRect(-48,-24,96,54,13);ctx.fill();ctx.stroke();ctx.fillStyle='#d8c7e5';ctx.fillRect(-36,-15,14,36);ctx.restore();
    ctx.fillStyle='#9b81b0';ctx.font='bold 23px sans-serif';ctx.fillText('哈！',384,124);
  } else if (game === 'catch') {
    cloud(ctx, 110, 95, .85); cloud(ctx, 495, 68, .7);
    ctx.strokeStyle='#b1d2d7';ctx.lineWidth=3;ctx.setLineDash([5,8]);
    for (const x of [220,420]) { ctx.beginPath();ctx.moveTo(x,45);ctx.lineTo(x-14,125);ctx.stroke(); }ctx.setLineDash([]);
    drawFrog(ctx,267,144,105,{expression:'laugh',rotation:.17});drawFrog(ctx,444,88,71,{pose:'wave',rotation:-.2});
    ctx.fillStyle='#b88c5a';ctx.strokeStyle='#886844';ctx.lineWidth=4;ctx.beginPath();ctx.roundRect(220,230,209,82,[8,8,30,30]);ctx.fill();ctx.stroke();
    ctx.strokeStyle='#d8b27a';ctx.lineWidth=5;
    for(let x=245;x<419;x+=27){ctx.beginPath();ctx.moveTo(x,244);ctx.lineTo(x,297);ctx.stroke();}
    ctx.beginPath();ctx.moveTo(235,267);ctx.lineTo(413,267);ctx.stroke();ctx.fillStyle='#e1c18c';ctx.beginPath();ctx.roundRect(211,220,226,20,9);ctx.fill();ctx.stroke();
    ctx.fillStyle='#658795';ctx.font='bold 24px sans-serif';ctx.fillText('+50',135,174);
  } else if (game === 'jump') {
    cloud(ctx,120,100,.6);cloud(ctx,500,85,.8);
    ctx.strokeStyle='#b898b0';ctx.lineWidth=3;ctx.setLineDash([4,9]);ctx.beginPath();ctx.moveTo(190,217);ctx.quadraticCurveTo(306,29,457,209);ctx.stroke();ctx.setLineDash([]);
    for(const [x,y,ww] of [[115,248,127],[413,228,123]]){ctx.fillStyle='#c4a1b8';ctx.beginPath();ctx.roundRect(x,y,ww,82,7);ctx.fill();ctx.fillStyle='#ead3dd';ctx.beginPath();ctx.roundRect(x-6,y-6,ww+12,20,7);ctx.fill();}
    drawFrog(ctx,309,144,108,{pose:'wave',rotation:.2});
    ctx.strokeStyle='#a8b785';ctx.lineWidth=3;ctx.beginPath();ctx.ellipse(475,232,29,8,0,0,Math.PI*2);ctx.stroke();
    ctx.fillStyle='#93778a';ctx.font='bold 22px sans-serif';ctx.fillText('完美！',429,185);
  } else if (game === 'fighter') {
    ctx.save();
    ctx.fillStyle = '#ddc4b1'; ctx.beginPath(); ctx.ellipse(320, 294, 250, 48, 0, 0, Math.PI * 2); ctx.fill();
    for (const y of [154, 210]) { ctx.strokeStyle = '#bd9b88'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(75, y); ctx.lineTo(565, y); ctx.stroke(); }
    for (const x of [72, 563]) { ctx.fillStyle = '#977864'; ctx.beginPath(); ctx.roundRect(x, 107, 9, 180, 4); ctx.fill(); }
    ctx.fillStyle = '#fffaed'; ctx.beginPath(); ctx.roundRect(121, 58, 157, 15, 6); ctx.roundRect(362, 58, 157, 15, 6); ctx.fill();
    ctx.fillStyle = '#90aa79'; ctx.fillRect(125, 62, 140, 7); ctx.fillStyle = '#c28d9a'; ctx.fillRect(366, 62, 120, 7);
    drawFrog(ctx, 217, 197, 126, { pose: 'angry', rotation: .12 });
    drawFrog(ctx, 443, 195, 122, { skinSlot: 1, pose: 'laugh', scaleX: -1, rotation: -.12 });
    ctx.font = '900 italic 40px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#a57c5e'; ctx.fillText('VS', 329, 168);
    ctx.strokeStyle = '#f9f2d4'; ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(295, 194); ctx.lineTo(317, 212); ctx.lineTo(341, 192); ctx.stroke();
    ctx.restore();
  } else if (game === 'survivor') {
    ctx.save();
    ctx.strokeStyle = '#a8c0a6'; ctx.lineWidth = 2; ctx.setLineDash([4, 8]); ctx.beginPath(); ctx.ellipse(320, 200, 176, 90, 0, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4, x = 320 + Math.cos(angle) * 212, y = 187 + Math.sin(angle) * 100;
      ctx.save(); ctx.translate(x, y); ctx.rotate(Math.sin(angle) * .2);
      ctx.fillStyle = i % 2 ? '#d4b6a2' : '#b2b2c6'; ctx.beginPath(); ctx.roundRect(-18, -25, 36, 46, 5); ctx.fill();
      ctx.fillStyle = '#fff6dc'; ctx.fillRect(-12, -15, 24, 21); ctx.fillStyle = '#75695e'; ctx.fillRect(-8, -10, 4, 5); ctx.fillRect(4, -10, 4, 5); ctx.restore();
    }
    ctx.strokeStyle = '#ebcb77'; ctx.lineWidth = 8; ctx.beginPath(); ctx.arc(320, 200, 99, -.5, 1.8); ctx.stroke();
    drawFrog(ctx, 316, 167, 120, { pose: 'laugh', crown: true });
    for (const [x, y] of [[172, 145], [458, 228], [259, 295]]) { ctx.save(); ctx.translate(x, y); ctx.rotate(.75); ctx.fillStyle = '#82bca8'; ctx.fillRect(-7, -7, 14, 14); ctx.restore(); }
    ctx.restore();
  } else if (game === 'bomber') {
    ctx.save();
    for (let row = 0; row < 4; row++) for (let col = 0; col < 8; col++) {
      const x = 99 + col * 58, y = 67 + row * 55;
      ctx.fillStyle = row % 2 === 1 && col % 2 === 1 ? '#b9b0cb' : '#f3ecf5';
      ctx.beginPath(); ctx.roundRect(x, y, 51, 48, 5); ctx.fill();
    }
    for (const [x, y] of [[157, 67], [447, 177], [331, 67]]) { ctx.fillStyle = '#caa887'; ctx.beginPath(); ctx.roundRect(x, y, 51, 48, 5); ctx.fill(); ctx.strokeStyle = '#e9cba6'; ctx.lineWidth = 3; ctx.strokeRect(x + 6, y + 6, 39, 36); ctx.beginPath(); ctx.moveTo(x + 6, y + 6); ctx.lineTo(x + 45, y + 42); ctx.stroke(); }
    ctx.fillStyle = '#f2c886'; ctx.beginPath(); ctx.roundRect(299, 232, 156, 38, 12); ctx.roundRect(357, 174, 38, 148, 12); ctx.fill();
    ctx.fillStyle = '#665675'; ctx.beginPath(); ctx.arc(374, 247, 29, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#ad9263'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(378, 219); ctx.quadraticCurveTo(383, 195, 402, 207); ctx.stroke();
    ctx.fillStyle = '#f6ce63'; ctx.beginPath(); ctx.arc(403, 207, 7, 0, Math.PI * 2); ctx.fill();
    drawFrog(ctx, 225, 191, 116, { pose: 'run', rotation: -.12 });
    ctx.restore();
  } else if (game === 'merge') {
    const tiles=[{x:120,y:88,n:2,pose:'idle',color:'#edf1d9'},{x:262,y:88,n:4,pose:'wave',color:'#dae8d0'},{x:403,y:88,n:2048,pose:'laugh',color:'#e9ca68'}];
    for(const t of tiles){ctx.fillStyle='#c4be9a';ctx.beginPath();ctx.roundRect(t.x-5,t.y-5,124,163,13);ctx.fill();ctx.fillStyle=t.color;ctx.beginPath();ctx.roundRect(t.x,t.y,114,153,10);ctx.fill();drawFrog(ctx,t.x+57,t.y+71,75,{pose:t.pose});ctx.fillStyle='#52603c';ctx.font='800 24px sans-serif';ctx.textAlign='center';ctx.fillText(String(t.n),t.x+57,t.y+140);}ctx.textAlign='left';
    ctx.fillStyle='#a39655';ctx.font='bold 20px sans-serif';ctx.fillText('越来越抽象 →',256,289);
  }
}
