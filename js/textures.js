// テクスチャ(すべて canvas で描く。画像ファイルは使わない)
import * as THREE from 'three';

const TAU = Math.PI * 2;

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function tex(c, { repeat = false, nearest = false } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (nearest) { t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; }
  return t;
}

// 乱数(毎回同じ絵になるよう種を固定)
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// ---------------------------------------------------------------- 道路
// u = 道の横(0 = 左のはし、1 = 右のはし。路肩をふくむ)、v = 道に沿う方向(繰り返し)
// kind: 'pref'(白い外側線と黄色のセンターライン)/ 'narrow'(線なし)/ 'gravel'(じゃり)
export function roadTexture(kind, half, shoulder) {
  const W = 256, H = 512;
  const [c, g] = canvas(W, H);
  const r = rng(kind === 'gravel' ? 13 : 7);
  const total = (half + shoulder) * 2;
  const U = d => (d + half + shoulder) / total;      // 中心からの距離 d(m)→ u
  if (kind === 'gravel') {
    g.fillStyle = '#4a463d'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 16000; i++) {
      const v = 45 + r() * 50;
      g.fillStyle = `rgb(${v + 6},${v + 2},${v - 6})`;
      g.fillRect(r() * W, r() * H, 1 + r() * 2.5, 1 + r() * 2.5);
    }
    // わだち(土が見える2本の筋)と、まん中の草
    for (const d of [-0.75, 0.75]) {
      const x = U(d) * W;
      const gr = g.createLinearGradient(x - 18, 0, x + 18, 0);
      gr.addColorStop(0, 'rgba(40,34,26,0)'); gr.addColorStop(0.5, 'rgba(40,34,26,0.7)'); gr.addColorStop(1, 'rgba(40,34,26,0)');
      g.fillStyle = gr; g.fillRect(x - 18, 0, 36, H);
    }
    for (let i = 0; i < 900; i++) {
      g.fillStyle = `rgba(${50 + r() * 30},${70 + r() * 40},${30 + r() * 20},0.8)`;
      g.fillRect(U(0) * W + (r() - 0.5) * 22, r() * H, 1.5, 3 + r() * 5);
    }
    for (const d of [-(half + shoulder), half + shoulder]) {
      for (let i = 0; i < 700; i++) {
        g.fillStyle = `rgba(${40 + r() * 30},${62 + r() * 40},${28 + r() * 20},0.9)`;
        g.fillRect(U(d) * W + (d < 0 ? 1 : -1) * r() * 26 - 1, r() * H, 2, 3 + r() * 6);
      }
    }
    return tex(c, { repeat: true });
  }
  g.fillStyle = '#2b2d2e'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 9000; i++) {
    const v = 30 + r() * 26;
    g.fillStyle = `rgb(${v},${v + 1},${v + 2})`;
    g.fillRect(r() * W, r() * H, 1 + r() * 2, 1 + r() * 2);
  }
  // 補修したつぎはぎ
  g.fillStyle = 'rgba(20,21,22,0.55)'; g.fillRect(W * 0.18, 140, W * 0.22, 90);
  g.fillStyle = 'rgba(55,57,58,0.35)'; g.fillRect(W * 0.56, 330, W * 0.3, 60);
  // わだち
  const ruts = kind === 'pref' ? [-2.2, -0.8, 0.8, 2.2] : [-0.75, 0.75];
  for (const d of ruts) {
    const x = U(d) * W;
    const gr = g.createLinearGradient(x - 14, 0, x + 14, 0);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.5, 'rgba(10,12,14,0.35)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(x - 14, 0, 28, H);
  }
  // 路肩(舗装のはしから外はくすんだ色)
  g.fillStyle = 'rgba(58,56,48,0.85)';
  g.fillRect(0, 0, U(-half) * W, H);
  g.fillRect(U(half) * W, 0, W - U(half) * W, H);
  const line = (d, w, col, dash) => {
    g.fillStyle = col;
    const x = U(d) * W;
    if (!dash) g.fillRect(x - w / 2, 0, w, H);
    else for (let y = 0; y < H; y += 128) g.fillRect(x - w / 2, y, w, 64);
  };
  if (kind === 'pref') {
    line(-half + 0.12, 5, 'rgba(196,198,190,0.85)');
    line(half - 0.12, 5, 'rgba(196,198,190,0.85)');
    line(0, 6, 'rgba(201,150,40,0.9)');
    for (let i = 0; i < 1400; i++) {
      g.fillStyle = 'rgba(43,45,46,0.8)';
      const x = U([-half + 0.12, 0, half - 0.12][i % 3]) * W + (r() - 0.5) * 7;
      g.fillRect(x, r() * H, 1 + r() * 2, 1 + r() * 3);
    }
  }
  return tex(c, { repeat: true });
}

// 濡れたつや(水たまり)の強さ。白いほど濡れて光る
export function puddleTexture() {
  const W = 128, H = 256;
  const [c, g] = canvas(W, H);
  const r = rng(11);
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  g.filter = 'blur(3px)';
  for (let i = 0; i < 26; i++) {
    const x = (r() < 0.6 ? (r() < 0.5 ? 0.2 : 0.8) : r()) * W; // わだちにたまりやすい
    const y = r() * H;
    g.fillStyle = `rgba(255,255,255,${0.5 + r() * 0.5})`;
    g.beginPath();
    g.ellipse(x, y, 4 + r() * 12, 8 + r() * 30, 0, 0, TAU);
    g.fill();
  }
  g.filter = 'none';
  const t = tex(c, { repeat: true });
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

// 法面(のりめん)のコンクリートの格子(法枠)
export function slopeTexture() {
  const W = 256, H = 256;
  const [c, g] = canvas(W, H);
  const r = rng(3);
  g.fillStyle = '#3c4a34'; g.fillRect(0, 0, W, H); // 枠の中は草
  for (let i = 0; i < 3000; i++) {
    g.fillStyle = `rgba(${40 + r() * 30},${60 + r() * 40},${30 + r() * 20},0.8)`;
    g.fillRect(r() * W, r() * H, 2, 3 + r() * 4);
  }
  g.strokeStyle = '#6f716b'; g.lineWidth = 22;
  g.strokeRect(0, 0, W, H);
  g.beginPath(); g.moveTo(W / 2, 0); g.lineTo(W / 2, H); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
  // 雨だれの黒ずみ
  for (let i = 0; i < 60; i++) {
    const x = r() * W;
    const gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, 'rgba(20,24,20,0.35)'); gr.addColorStop(1, 'rgba(20,24,20,0)');
    g.fillStyle = gr; g.fillRect(x, 0, 1 + r() * 3, H * (0.3 + r() * 0.7));
  }
  return tex(c, { repeat: true });
}

// ---------------------------------------------------------------- メーター
// 90年代の国産セダン:黒い文字盤。数字は白く印刷してあり、ライトをつけると橙色に光る
// (光り方は材質の色で変える。ここでは白で描く)
export const GAUGE = {
  W: 1400, H: 440,
  lit: '#f4efe4',
  dim: '#9a9488',
  red: '#e0402a',
  // 針の中心と長さ(文字盤の画素)。針は 3D の板で別に描く
  tach: { cx: 470, cy: 236, R: 190, a0: Math.PI * 0.75, a1: Math.PI * 2.25, max: 8 },
  speed: { cx: 930, cy: 236, R: 190, a0: Math.PI * 0.75, a1: Math.PI * 2.25, max: 180 },
  temp: { cx: 160, cy: 250, R: 92, a0: Math.PI * 1.2, a1: Math.PI * 1.8, max: 1 },
  fuel: { cx: 1240, cy: 250, R: 92, a0: Math.PI * 1.2, a1: Math.PI * 1.8, max: 1 },
  drums: { x: 866, y: 338, w: 150, h: 80 },
};

function dial(g, { cx, cy, R, a0, a1, min, max, major, minor, labels, label, unit, redFrom }) {
  const bg = g.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 1.08);
  bg.addColorStop(0, '#0d0e0d'); bg.addColorStop(1, '#050505');
  g.fillStyle = bg; g.beginPath(); g.arc(cx, cy, R * 1.08, 0, TAU); g.fill();
  g.strokeStyle = '#1d1f1e'; g.lineWidth = 4; g.stroke();
  const ang = v => a0 + (a1 - a0) * (v - min) / (max - min);
  if (redFrom != null) {
    g.strokeStyle = GAUGE.red; g.lineWidth = R * 0.07;
    g.beginPath(); g.arc(cx, cy, R * 0.93, ang(redFrom), ang(max)); g.stroke();
  }
  for (let v = min; v <= max + 1e-6; v += minor) {
    const isMaj = Math.abs(v / major - Math.round(v / major)) < 1e-6;
    const a = ang(v);
    const r1 = R * 0.97, r0 = R * (isMaj ? 0.83 : 0.9);
    g.strokeStyle = (redFrom != null && v >= redFrom) ? GAUGE.red : GAUGE.lit;
    g.lineWidth = isMaj ? 5 : 2.5;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    g.stroke();
  }
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const [v, s] of labels) {
    const a = ang(v);
    const rr = R * 0.68;
    g.save();
    g.translate(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    g.scale(0.82, 1);
    g.font = `bold ${Math.round(R * 0.19)}px "Barlow Condensed", "DejaVu Sans", sans-serif`;
    g.fillStyle = (redFrom != null && v >= redFrom) ? GAUGE.red : GAUGE.lit;
    g.fillText(s, 0, 0);
    g.restore();
  }
  g.font = `bold ${Math.round(R * 0.1)}px "Barlow Condensed", "DejaVu Sans", sans-serif`;
  g.fillStyle = GAUGE.dim;
  if (label) g.fillText(label, cx, cy - R * 0.36);
  if (unit) g.fillText(unit, cx, cy - R * 0.22);
}

function lampShape(g, x, y, col, on, draw) {
  g.save();
  g.translate(x, y);
  g.strokeStyle = on ? col : '#191a19';
  g.fillStyle = on ? col : '#191a19';
  if (on) { g.shadowColor = col; g.shadowBlur = 12; }
  g.lineWidth = 3;
  draw(g);
  g.restore();
}

// 文字盤(針とドラムの数字をのぞく)。state の警告灯・変速の表示で描き直す
export function drawClusterFace(c, state) {
  const { W, H } = GAUGE;
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#060606'; g.fillRect(0, 0, W, H);
  dial(g, { ...GAUGE.tach, min: 0, major: 1, minor: 0.5, labels: [0, 1, 2, 3, 4, 5, 6, 7, 8].map(v => [v, String(v)]), label: 'x1000r/min', redFrom: 6.5 });
  dial(g, { ...GAUGE.speed, min: 0, major: 20, minor: 10, labels: [0, 20, 40, 60, 80, 100, 120, 140, 160, 180].map(v => [v, String(v)]), label: 'km/h' });
  dial(g, { ...GAUGE.temp, min: 0, major: 0.5, minor: 0.5, labels: [[0, 'C'], [1, 'H']], redFrom: 0.85 });
  dial(g, { ...GAUGE.fuel, min: 0, major: 0.5, minor: 0.25, labels: [[0, 'E'], [0.5, '1/2'], [1, 'F']] });
  // ドラムの窓
  const D = GAUGE.drums;
  g.fillStyle = '#0a0b0a'; g.fillRect(D.x, D.y, D.w, D.h);
  g.font = 'bold 13px "Barlow Condensed", "DejaVu Sans", sans-serif'; g.fillStyle = GAUGE.dim; g.textAlign = 'right'; g.textBaseline = 'alphabetic';
  g.fillText('ODO', D.x - 2, D.y + 20);
  g.fillText('TRIP', D.x - 2, D.y + 58);
  // トリップを戻すつまみ
  g.fillStyle = '#111'; g.beginPath(); g.arc(1050, 404, 13, 0, TAU); g.fill();
  g.strokeStyle = '#3a3a3a'; g.lineWidth = 3; g.stroke();
  // 変速の表示
  g.textAlign = 'center';
  const pos = state.mt ? ['R', 'N', '1', '2', '3', '4', '5'] : ['P', 'R', 'N', 'D', '2', 'L'];
  const x0 = 700 - (pos.length - 1) * 18;
  pos.forEach((p, i) => {
    const on = p === state.shift;
    g.font = 'bold 26px "Barlow Condensed", "DejaVu Sans", sans-serif';
    g.fillStyle = on ? '#ffb347' : '#1e201e';
    g.shadowColor = '#ffb347'; g.shadowBlur = on ? 12 : 0;
    g.fillText(p, x0 + i * 36, 404);
  });
  g.shadowBlur = 0;
  if (!state.mt) {
    g.font = 'bold 15px "Barlow Condensed", "DejaVu Sans", sans-serif';
    g.fillStyle = state.odOff ? '#ffb347' : '#1e201e';
    if (state.odOff) { g.shadowColor = '#ffb347'; g.shadowBlur = 10; }
    g.fillText('O/D OFF', 700, 432);
    g.shadowBlur = 0;
  }
  // 警告灯
  lampShape(g, 160, 360, '#3cff7a', state.blinkL, g2 => {
    g2.beginPath(); g2.moveTo(-18, 0); g2.lineTo(0, -14); g2.lineTo(0, -6); g2.lineTo(16, -6);
    g2.lineTo(16, 6); g2.lineTo(0, 6); g2.lineTo(0, 14); g2.closePath(); g2.fill();
  });
  lampShape(g, 1240, 360, '#3cff7a', state.blinkR, g2 => {
    g2.beginPath(); g2.moveTo(18, 0); g2.lineTo(0, -14); g2.lineTo(0, -6); g2.lineTo(-16, -6);
    g2.lineTo(-16, 6); g2.lineTo(0, 6); g2.lineTo(0, 14); g2.closePath(); g2.fill();
  });
  lampShape(g, 700, 70, '#4aa8ff', state.highBeam, g2 => {
    g2.beginPath(); g2.arc(4, 0, 12, -Math.PI / 2, Math.PI / 2); g2.closePath(); g2.stroke();
    for (let i = -1; i <= 1; i++) { g2.beginPath(); g2.moveTo(-8, i * 7); g2.lineTo(-24, i * 7); g2.stroke(); }
  });
  lampShape(g, 640, 70, '#ff3b2a', state.brakeLamp, g2 => {
    g2.beginPath(); g2.arc(0, 0, 11, 0, TAU); g2.stroke();
    g2.beginPath(); g2.arc(0, 0, 16, -0.9, 0.9); g2.stroke(); g2.beginPath(); g2.arc(0, 0, 16, Math.PI - 0.9, Math.PI + 0.9); g2.stroke();
    g2.font = 'bold 14px sans-serif'; g2.textAlign = 'center'; g2.textBaseline = 'middle'; g2.fillText('!', 0, 1);
  });
  lampShape(g, 760, 70, '#ff3b2a', state.oilLamp, g2 => {
    g2.fillRect(-14, -3, 22, 8); g2.fillRect(6, -8, 10, 4); g2.fillRect(-18, -6, 5, 5);
  });
  lampShape(g, 820, 70, '#ff3b2a', state.battLamp, g2 => {
    g2.strokeRect(-13, -8, 26, 16); g2.fillRect(-9, -12, 5, 4); g2.fillRect(4, -12, 5, 4);
    g2.font = 'bold 12px sans-serif'; g2.textAlign = 'center'; g2.textBaseline = 'middle'; g2.fillText('-  +', 0, 1);
  });
  lampShape(g, 580, 70, '#ffb020', state.fuelLamp, g2 => {
    g2.strokeRect(-10, -12, 14, 22); g2.fillRect(-7, -9, 8, 6); g2.beginPath(); g2.moveTo(4, -6); g2.lineTo(10, -2); g2.lineTo(10, 8); g2.stroke();
  });
  lampShape(g, 520, 70, '#ffb020', state.engineLamp, g2 => {
    g2.strokeRect(-14, -8, 24, 14); g2.fillRect(-6, -12, 8, 4); g2.fillRect(10, -4, 6, 6); g2.fillRect(-18, -4, 4, 6);
  });
  // 透明カバーの映り込み
  const gl = g.createLinearGradient(0, 0, W * 0.6, H);
  gl.addColorStop(0, 'rgba(255,255,255,0.05)'); gl.addColorStop(0.35, 'rgba(255,255,255,0.0)');
  g.fillStyle = gl; g.fillRect(0, 0, W, H);
}

// 回転するドラムの数字(オドメーターとトリップ)。小さい canvas に毎フレーム描く
export function drawDrums(c, odoKm, tripKm) {
  const D = GAUGE.drums;
  if (c.width !== D.w) { c.width = D.w; c.height = D.h; }
  const g = c.getContext('2d');
  g.fillStyle = '#0a0b0a'; g.fillRect(0, 0, D.w, D.h);
  const cw = 22, ch = 34;
  const drum = (x, y, digits, value, lastWhite) => {
    const whole = Math.floor(value);
    const frac = value - whole;
    for (let i = 0; i < digits; i++) {
      const white = lastWhite && i === digits - 1;
      const place = 10 ** (digits - 1 - i);
      const d = Math.floor(whole / place) % 10;
      // 下の桁が 9 から 0 に回るときだけ、上の桁も一緒に回る
      const lower = whole % place;
      const roll = (lower === place - 1 || place === 1) ? frac : 0;
      const X = x + i * (cw + 2);
      g.fillStyle = white ? '#d9d6cc' : '#121212';
      g.fillRect(X, y, cw, ch);
      g.save();
      g.beginPath(); g.rect(X, y, cw, ch); g.clip();
      g.fillStyle = white ? '#141414' : '#e6e8e0';
      g.font = 'bold 25px "DejaVu Sans Mono", monospace';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(d), X + cw / 2, y + ch / 2 - roll * ch);
      g.fillText(String((d + 1) % 10), X + cw / 2, y + ch / 2 + (1 - roll) * ch);
      const gr = g.createLinearGradient(0, y, 0, y + ch);
      gr.addColorStop(0, 'rgba(0,0,0,0.65)'); gr.addColorStop(0.3, 'rgba(0,0,0,0)');
      gr.addColorStop(0.7, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.65)');
      g.fillStyle = gr; g.fillRect(X, y, cw, ch);
      g.restore();
    }
  };
  drum(4, 2, 6, odoKm, false);
  drum(52, 41, 4, tripKm * 10, true);
}

// ---------------------------------------------------------------- コマ図
// ラリーの道案内の紙。手書き風に、行ごとに少し傾ける
function arrowDiagram(g, x, y, s, kind, r) {
  // 入口はいつも下から。太線が進む道、細線がほかの道
  const cx = x + s / 2, cy = y + s / 2;
  g.lineCap = 'round'; g.lineJoin = 'round';
  g.strokeStyle = '#1b2230';
  const thin = () => { g.lineWidth = 3; };
  const thick = () => { g.lineWidth = 7; };
  const jitter = () => (r() - 0.5) * 3;
  const dot = () => { g.fillStyle = '#1b2230'; g.beginPath(); g.arc(cx, y + s * 0.92, 6, 0, TAU); g.fill(); };
  const head = (hx, hy, ang) => {
    g.fillStyle = '#1b2230';
    g.beginPath();
    g.moveTo(hx + Math.cos(ang) * 14, hy + Math.sin(ang) * 14);
    g.lineTo(hx + Math.cos(ang + 2.5) * 13, hy + Math.sin(ang + 2.5) * 13);
    g.lineTo(hx + Math.cos(ang - 2.5) * 13, hy + Math.sin(ang - 2.5) * 13);
    g.closePath(); g.fill();
  };
  dot();
  if (kind === 'start') {
    thick(); g.beginPath(); g.moveTo(cx, y + s * 0.92); g.lineTo(cx + jitter(), y + s * 0.15); g.stroke();
    head(cx, y + s * 0.12, -Math.PI / 2);
  } else if (kind === 'yright') {
    thin(); g.beginPath(); g.moveTo(cx, cy); g.lineTo(x + s * 0.2, y + s * 0.12); g.stroke();
    thick(); g.beginPath(); g.moveTo(cx, y + s * 0.92); g.lineTo(cx, cy); g.lineTo(x + s * 0.8 + jitter(), y + s * 0.15); g.stroke();
    head(x + s * 0.82, y + s * 0.12, -Math.PI / 4);
  } else if (kind === 'tleft') {
    thin(); g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx, y + s * 0.08); g.stroke();
    thick(); g.beginPath(); g.moveTo(cx, y + s * 0.92); g.lineTo(cx, cy); g.lineTo(x + s * 0.12, cy + jitter()); g.stroke();
    head(x + s * 0.1, cy, Math.PI);
    // 鳥居の記号
    g.lineWidth = 3; g.strokeStyle = '#b3261e';
    const tx = x + s * 0.74, ty = y + s * 0.62;
    g.beginPath();
    g.moveTo(tx - 15, ty - 13); g.quadraticCurveTo(tx, ty - 17, tx + 15, ty - 13);
    g.moveTo(tx - 11, ty - 7); g.lineTo(tx + 11, ty - 7);
    g.moveTo(tx - 8, ty - 13); g.lineTo(tx - 9, ty + 9);
    g.moveTo(tx + 8, ty - 13); g.lineTo(tx + 9, ty + 9);
    g.stroke();
  } else if (kind === 'tunnel') {
    thick(); g.beginPath(); g.moveTo(cx, y + s * 0.92); g.lineTo(cx + jitter(), y + s * 0.15); g.stroke();
    head(cx, y + s * 0.12, -Math.PI / 2);
    g.lineWidth = 3;
    g.beginPath(); g.arc(cx, y + s * 0.5, s * 0.22, Math.PI, 0); g.stroke();
    g.beginPath(); g.moveTo(cx - s * 0.22, y + s * 0.5); g.lineTo(cx - s * 0.22, y + s * 0.62);
    g.moveTo(cx + s * 0.22, y + s * 0.5); g.lineTo(cx + s * 0.22, y + s * 0.62); g.stroke();
  } else if (kind === 'goal') {
    thick(); g.beginPath(); g.moveTo(cx, y + s * 0.92); g.lineTo(cx, y + s * 0.5); g.stroke();
    // 温泉の記号
    g.lineWidth = 3; g.strokeStyle = '#b3261e';
    g.beginPath(); g.ellipse(cx, y + s * 0.38, s * 0.2, s * 0.08, 0, 0, TAU); g.stroke();
    for (const dx of [-0.1, 0, 0.1]) {
      g.beginPath(); g.moveTo(cx + dx * s, y + s * 0.3);
      g.bezierCurveTo(cx + dx * s - 8, y + s * 0.22, cx + dx * s + 8, y + s * 0.16, cx + dx * s, y + s * 0.08); g.stroke();
    }
  } else if (kind === 'xright') {
    thin(); g.beginPath(); g.moveTo(x + s * 0.12, cy); g.lineTo(cx, cy); g.moveTo(cx, cy); g.lineTo(cx, y + s * 0.08); g.stroke();
    thick(); g.beginPath(); g.moveTo(cx, y + s * 0.92); g.lineTo(cx, cy); g.lineTo(x + s * 0.88, cy + jitter()); g.stroke();
    head(x + s * 0.9, cy, 0);
    // バス停の記号
    g.lineWidth = 3;
    g.beginPath(); g.arc(x + s * 0.28, y + s * 0.3, 9, 0, TAU); g.stroke();
    g.beginPath(); g.moveTo(x + s * 0.28, y + s * 0.3 + 9); g.lineTo(x + s * 0.28, y + s * 0.42); g.stroke();
  }
}

export function komazuTexture(route, rows) {
  const W = 600, H = 860;
  const [c, g] = canvas(W, H);
  const r = rng(21);
  g.fillStyle = '#e7e1cf'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 4000; i++) {
    g.fillStyle = `rgba(${150 + r() * 60},${140 + r() * 50},${110 + r() * 40},0.08)`;
    g.fillRect(r() * W, r() * H, 2, 2);
  }
  const top = 104, rowH = (H - top - 30) / rows.length, x0 = 26, x1 = 136, x2 = 300, x3 = W - 26;
  g.fillStyle = '#28303c';
  g.font = 'bold 24px "BIZ UDPGothic", "IPAGothic", sans-serif';
  g.textAlign = 'left'; g.textBaseline = 'middle';
  g.fillText('コマ図', x0, 42);
  g.font = '18px "BIZ UDPGothic", "IPAGothic", sans-serif';
  g.fillText(route.name, x0 + 100, 44);
  g.strokeStyle = '#6d8db4'; g.lineWidth = 2;
  g.font = '14px "BIZ UDPGothic", "IPAGothic", sans-serif'; g.fillStyle = '#6d8db4';
  g.fillText('番号/距離 km', x0 + 6, top - 16);
  g.fillText('図', x1 + 74, top - 16);
  g.fillText('メモ', x2 + 10, top - 16);
  g.strokeRect(x0, top, x3 - x0, rowH * rows.length);
  for (let i = 1; i < rows.length; i++) { g.beginPath(); g.moveTo(x0, top + rowH * i); g.lineTo(x3, top + rowH * i); g.stroke(); }
  for (const x of [x1, x2]) { g.beginPath(); g.moveTo(x, top); g.lineTo(x, top + rowH * rows.length); g.stroke(); }
  rows.forEach((row, i) => {
    const y = top + rowH * i;
    g.save();
    g.translate(0, y);
    g.rotate((r() - 0.5) * 0.012);
    g.fillStyle = '#1b2230';
    g.font = 'bold 28px "BIZ UDPGothic", "IPAGothic", sans-serif';
    g.textAlign = 'left';
    g.fillText(String(row.no), x0 + 10, 30);
    g.font = 'bold 32px "DejaVu Sans Mono", monospace';
    g.fillText(row.km.toFixed(2), x0 + 6, rowH - 34);
    g.restore();
    arrowDiagram(g, x1 + 18, y + 6, Math.min(rowH - 12, x2 - x1 - 36), row.kind, r);
    g.save();
    g.translate(x2 + 16, y + rowH * 0.36);
    g.rotate((r() - 0.5) * 0.02);
    g.fillStyle = '#1b2230';
    g.font = 'bold 28px "BIZ UDPGothic", "IPAGothic", sans-serif';
    g.fillText(row.memo[0], 0, 0);
    g.font = '22px "BIZ UDPGothic", "IPAGothic", sans-serif';
    g.fillText(row.memo[1], 2, 40);
    g.restore();
  });
  for (let i = 0; i < 5; i++) {
    const x = r() * W, y = r() * H, rr = 10 + r() * 26;
    const gr = g.createRadialGradient(x, y, rr * 0.6, x, y, rr);
    gr.addColorStop(0, 'rgba(160,150,120,0.10)'); gr.addColorStop(0.85, 'rgba(120,110,80,0.22)'); gr.addColorStop(1, 'rgba(120,110,80,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, rr, 0, TAU); g.fill();
  }
  return tex(c);
}

// 自販機の正面
export function vendingTexture() {
  const W = 128, H = 256;
  const [c, g] = canvas(W, H);
  g.fillStyle = '#e9ece6'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#c42a24'; g.fillRect(0, 0, W, 34);
  g.fillStyle = '#fff'; g.font = 'bold 20px "IPAGothic", sans-serif'; g.textAlign = 'center';
  g.fillText('つめた〜い', W / 2, 24);
  const cols = ['#2a5bbd', '#d9a21b', '#2f8f4a', '#c9c9c9', '#a8322c', '#2e2e2e'];
  for (let row = 0; row < 3; row++) for (let i = 0; i < 6; i++) {
    g.fillStyle = cols[(i + row * 2) % cols.length];
    g.fillRect(8 + i * 19, 46 + row * 46, 13, 30);
    g.fillStyle = row === 0 ? '#2c6fd6' : '#d0392b';
    g.fillRect(8 + i * 19, 80 + row * 46, 13, 5);
  }
  g.fillStyle = '#20252a'; g.fillRect(16, 196, 96, 26);
  g.fillStyle = '#9aa2a8'; g.fillRect(96, 150, 18, 30);
  return tex(c);
}

// 看板・標識など、文字を描いた板
// lines: [{ text, size, color, font, y }]、bg: 背景色、border: ふちの色
export function signTexture(W, H, bg, lines, border) {
  const [c, g] = canvas(W, H);
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  if (border) { g.strokeStyle = border; g.lineWidth = Math.max(3, W * 0.02); g.strokeRect(g.lineWidth, g.lineWidth, W - g.lineWidth * 2, H - g.lineWidth * 2); }
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const l of lines) {
    g.fillStyle = l.color || '#fff';
    g.font = `${l.weight || 'bold'} ${l.size}px ${l.font || '"BIZ UDPGothic", "IPAGothic", sans-serif'}`;
    if (l.vertical) {
      [...l.text].forEach((ch, i) => g.fillText(ch, l.x ?? W / 2, l.y + i * l.size * 1.08));
    } else g.fillText(l.text, l.x ?? W / 2, l.y);
  }
  // 雨の汚れ
  const r = rng(W * 7 + H);
  for (let i = 0; i < W / 6; i++) {
    const x = r() * W;
    const gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, 'rgba(30,30,25,0.18)'); gr.addColorStop(1, 'rgba(30,30,25,0)');
    g.fillStyle = gr; g.fillRect(x, 0, 1 + r() * 2, H * r());
  }
  return tex(c);
}

// 窓(夜は明かりがつく)。家の壁の材質に使う
export function windowTexture() {
  const [c, g] = canvas(64, 64);
  g.fillStyle = '#000'; g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#fff'; g.fillRect(14, 16, 36, 30);
  g.fillStyle = '#000'; g.fillRect(31, 16, 2, 30); g.fillRect(14, 30, 36, 2);
  const t = tex(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}
