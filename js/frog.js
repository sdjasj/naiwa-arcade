// Meme sprite provided by NaiLoong / linalg. See assets/ATTRIBUTION.md.
const sheet = new Image();
sheet.src = new URL('../assets/naifrog-sheet.webp', import.meta.url).href;
export const frogReady = sheet.decode().catch(() => undefined);
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
  if (sheet.complete && sheet.naturalWidth) {
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
  } else {
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
  ctx.fillStyle = { flappy: '#dfeeda', angry: '#f7e9cf', whack: '#e9e6f3', catch: '#dceef1', jump: '#f1e0e8', merge: '#f2ebca' }[game]; ctx.fillRect(0, 0, w, h);
  if (game === 'flappy') {
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
  } else if (game === 'merge') {
    const tiles=[{x:120,y:88,n:2,pose:'idle',color:'#edf1d9'},{x:262,y:88,n:4,pose:'wave',color:'#dae8d0'},{x:403,y:88,n:2048,pose:'laugh',color:'#e9ca68'}];
    for(const t of tiles){ctx.fillStyle='#c4be9a';ctx.beginPath();ctx.roundRect(t.x-5,t.y-5,124,163,13);ctx.fill();ctx.fillStyle=t.color;ctx.beginPath();ctx.roundRect(t.x,t.y,114,153,10);ctx.fill();drawFrog(ctx,t.x+57,t.y+71,75,{pose:t.pose});ctx.fillStyle='#52603c';ctx.font='800 24px sans-serif';ctx.textAlign='center';ctx.fillText(String(t.n),t.x+57,t.y+140);}ctx.textAlign='left';
    ctx.fillStyle='#a39655';ctx.font='bold 20px sans-serif';ctx.fillText('越来越抽象 →',256,289);
  }
}
