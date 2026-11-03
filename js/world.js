// 山の形・道・地面の種類を計算する(three.js を使わない。物理と描画の両方から使う)
import { NODES, ROADS, ROAD_KIND, riverZ, VILLAGES, FIELDS, ROUTE, SCALE, NODE_HEIGHT, NODE_SINK } from './roads.js';

export const MAP = { x0: -1600, z0: -1600, size: 3200, cell: 4 };
export const GRID_N = MAP.size / MAP.cell + 1; // 頂点の数(一辺)

// ------------------------------------------------------------ ノイズ
function hash(ix, iz) {
  let h = (ix * 374761393 + iz * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
  return (a + (b - a) * ux) + ((c + (d - c) * ux) - (a + (b - a) * ux)) * uz;
}
export function fbm(x, z, oct = 4) {
  let s = 0, a = 1, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { s += (vnoise(x * f, z * f) - 0.5) * a; n += a; a *= 0.5; f *= 2.03; }
  return s / n * 2;
}
export const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const lerp = (a, b, t) => a + (b - a) * t;

// ------------------------------------------------------------ もとの山の形
export const RIVER_LEVEL = 7.0;
export function baseHeight(X, Z) {
  const x = X / SCALE, z = Z / SCALE;
  // 南と北に谷、まん中(z ≒ -40)に東西の尾根。x ≒ 20 あたりが低い峠
  const ridge = 175 * Math.exp(-(((z + 40) / 330) ** 2));
  const saddle = -55 * Math.exp(-(((x - 10) / 200) ** 2)) * Math.exp(-(((z + 40) / 230) ** 2));
  const eastWest = 170 * smoothstep(560, 960, Math.abs(x));
  const northSouth = 110 * smoothstep(820, 1000, Math.abs(z));
  const northValley = 30 * smoothstep(-300, -700, z);
  const hills = (12 + 40 * Math.exp(-(((z + 40) / 480) ** 2)) + 30 * smoothstep(500, 900, Math.abs(x)))
    * fbm(x / 260, z / 260, 5);
  let h = 14 + ridge + saddle + eastWest + northSouth + northValley + hills;
  // 川の谷
  const dz = (Z - riverZ(X)) / SCALE;
  const valley = Math.exp(-((dz / 70) ** 2));
  h = lerp(h, Math.min(h, 13), valley * 0.85);
  h = Math.max(h, lerp(RIVER_LEVEL + 3, RIVER_LEVEL - 4, Math.exp(-((dz / 30) ** 2))));
  h -= 9 * Math.exp(-((dz / 16) ** 2));
  return h;
}

// ------------------------------------------------------------ 道
// Catmull-Rom で点を通るなめらかな線にし、2m ごとの点(サンプル)を作る
const STEP = 2;
function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

export const roads = [];       // 道ごとのサンプル
const nodeHeight = {};

function sampleRoad(def) {
  const P = def.pts;
  const dense = [];
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
    const segLen = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const n = Math.max(2, Math.ceil(segLen / 0.5));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      dense.push({ x: catmull(p0[0], p1[0], p2[0], p3[0], t), z: catmull(p0[1], p1[1], p2[1], p3[1], t), seg: i });
    }
  }
  dense.push({ x: P[P.length - 1][0], z: P[P.length - 1][1], seg: P.length - 2 });
  // 弧の長さで 2m ごとに取り直す
  const out = [];
  let acc = 0, next = 0;
  for (let i = 0; i < dense.length; i++) {
    if (i > 0) acc += Math.hypot(dense[i].x - dense[i - 1].x, dense[i].z - dense[i - 1].z);
    if (i === dense.length - 1) {
      const last = out[out.length - 1];
      if (acc - last.s < STEP * 0.5) out.pop();
      out.push({ x: dense[i].x, z: dense[i].z, s: acc, seg: dense[i].seg });
    } else if (acc >= next) {
      out.push({ x: dense[i].x, z: dense[i].z, s: acc, seg: dense[i].seg });
      next += STEP;
    }
  }
  // 区間のしるし(橋・トンネル・沢)
  const tagIdx = { b: [], t: [], f: [] };
  P.forEach((p, i) => { if (p[2]) tagIdx[p[2]].push(i); });
  for (const o of out) {
    o.bridge = inPairs(tagIdx.b, o.seg);
    o.tunnel = inPairs(tagIdx.t, o.seg);
    o.ford = inPairs(tagIdx.f, o.seg);
  }
  // 向き
  for (let i = 0; i < out.length; i++) {
    const a = out[Math.max(0, i - 1)], b = out[Math.min(out.length - 1, i + 1)];
    const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
    out[i].tx = dx / l; out[i].tz = dz / l;
    out[i].rx = -dz / l; out[i].rz = dx / l; // 右向き(進む向きから見て右)
  }
  return out;
}
function inPairs(idx, seg) {
  for (let k = 0; k + 1 < idx.length; k += 2) if (seg >= idx[k] && seg < idx[k + 1]) return true;
  return false;
}

function heightsFor(road, def) {
  const S = road.samples;
  const n = S.length;
  const target = S.map(o => baseHeight(o.x, o.z));
  // 平均をとってなめらかに(半径 40m)
  const R = 30;
  let h = target.map((_, i) => {
    let s = 0, c = 0;
    for (let k = Math.max(0, i - R); k <= Math.min(n - 1, i + R); k++) { s += target[k]; c++; }
    return s / c;
  });
  // 橋とトンネルはまっすぐ結ぶ。沢は低くする
  const runs = (key) => {
    const r = []; let st = -1;
    for (let i = 0; i < n; i++) {
      if (S[i][key] && st < 0) st = i;
      if (!S[i][key] && st >= 0) { r.push([st, i]); st = -1; }
    }
    if (st >= 0) r.push([st, n - 1]);
    return r;
  };
  // 両はしの高さを分かれ道の高さに合わせる
  const h0 = def.from && nodeHeight[def.from] != null ? nodeHeight[def.from] : h[0];
  const h1 = def.to && nodeHeight[def.to] != null ? nodeHeight[def.to] : h[n - 1];
  const pinEnd = !!def.to;
  for (let i = 0; i < n; i++) h[i] = Math.max(h[i], RIVER_LEVEL + 3.5);
  const d0 = h0 - h[0], d1 = pinEnd ? h1 - h[n - 1] : 0;
  h = h.map((v, i) => Math.max(RIVER_LEVEL + 3.5, v + lerp(d0, d1, i / (n - 1))));
  // 坂の上限(県道 9%、細い道 12%)
  const G = (def.kind === 'pref' ? 0.09 : 0.12);
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 1; i < n; i++) { const g = G * (S[i].s - S[i - 1].s); h[i] = Math.min(h[i - 1] + g, Math.max(h[i - 1] - g, h[i])); }
    if (pinEnd) {
      h[n - 1] = h1;
      for (let i = n - 2; i >= 0; i--) { const g = G * (S[i + 1].s - S[i].s); h[i] = Math.min(h[i + 1] + g, Math.max(h[i + 1] - g, h[i])); }
    }
    h[0] = h0;
  }
  const tS = (i, a, b) => (S[i].s - S[a].s) / Math.max(0.01, S[b].s - S[a].s);
  for (const [a0, b] of runs('bridge')) {
    const a = Math.max(0, a0 - 1);
    const ha = h[a], hb = h[b];
    for (let i = a; i <= b; i++) { const t = tS(i, a, b); h[i] = lerp(ha, hb, t) + Math.sin(Math.PI * t) * 0.6; }
  }
  for (const [a, b] of runs('tunnel')) {
    const ha = h[a], hb = h[b];
    for (let i = a; i <= b; i++) h[i] = lerp(ha, hb, tS(i, a, b));
  }
  for (const [a, b] of runs('ford')) {
    const mid = (a + b) / 2, low = Math.min(h[a], h[b]) - 2.2;
    for (let i = a; i <= b; i++) {
      const t = 1 - Math.abs(i - mid) / ((b - a) / 2);
      h[i] = lerp(lerp(h[a], h[b], tS(i, a, b)), low, smoothstep(0, 1, t));
    }
    road.fordLow = low; road.fordMid = S[Math.round(mid)];
  }
  S.forEach((o, i) => { o.y = h[i]; });
  // 道の傾き(縦)
  for (let i = 0; i < n; i++) {
    const a = S[Math.max(0, i - 1)], b = S[Math.min(n - 1, i + 1)];
    S[i].grade = (b.y - a.y) / Math.max(0.1, b.s - a.s);
  }
}

// 分かれ道の高さ:決めてある所はその値、ほかは付近の山の高さの平均(トンネルの口は下げる)
const nodeFixed = {};
for (const [k, [x, z]] of Object.entries(NODES)) {
  let s = 0, c = 0;
  for (let dx = -30; dx <= 30; dx += 10) for (let dz = -30; dz <= 30; dz += 10) { s += baseHeight(x + dx, z + dz); c++; }
  nodeHeight[k] = s / c - (NODE_SINK[k] || 0);
  if (NODE_HEIGHT[k] != null) { nodeHeight[k] = NODE_HEIGHT[k]; nodeFixed[k] = true; }
}
// 道を順に作る。はしの高さは、すでにある道の上ならその高さ、なければ坂の上限におさまるように決める
function onBuiltRoad(x, z) {
  let best = 9, y = null;
  for (const r of roads) for (const o of r.samples) {
    const d = (o.x - x) ** 2 + (o.z - z) ** 2;
    if (d < best) { best = d; y = o.y; }
  }
  return y;
}
for (const def of ROADS) {
  const road = { def, id: def.id, kind: ROAD_KIND[def.kind], kindName: def.kind, samples: sampleRoad(def) };
  road.length = road.samples[road.samples.length - 1].s;
  const maxG = (def.kind === 'pref' ? 0.09 : 0.12) * 0.85;
  for (const end of ['from', 'to']) {
    const k = def[end];
    if (!k || nodeFixed[k]) continue;
    const y = onBuiltRoad(...NODES[k]);
    if (y != null) { nodeHeight[k] = y; nodeFixed[k] = true; }
  }
  if (def.to && !nodeFixed[def.to] && def.from && nodeFixed[def.from]) {
    const h0 = nodeHeight[def.from], lim = maxG * road.length;
    nodeHeight[def.to] = Math.min(h0 + lim, Math.max(h0 - lim, nodeHeight[def.to]));
    nodeFixed[def.to] = true;
  }
  if (def.from && !nodeFixed[def.from]) nodeFixed[def.from] = true;
  heightsFor(road, def);
  if (def.to) nodeFixed[def.to] = true;
  roads.push(road);
}
// トンネル北口の高さを本線の続き(r7)の始まりに合わせる(heightsFor の順番のため、ここで確かめる)
export const roadById = Object.fromEntries(roads.map(r => [r.id, r]));

// ------------------------------------------------------------ 近くの道を探すための格子
const RG = 24;
const roadGrid = new Map();
const rkey = (ix, iz) => ix * 100003 + iz;
roads.forEach((road, ri) => {
  road.samples.forEach((o, si) => {
    const k = rkey(Math.floor(o.x / RG), Math.floor(o.z / RG));
    let a = roadGrid.get(k); if (!a) roadGrid.set(k, a = []);
    a.push(ri, si);
  });
});

// いちばん近い道の点。lateral = 道の中心からの横の距離(右が+)
export function nearestRoad(x, z, maxDist = 48) {
  const ix = Math.floor(x / RG), iz = Math.floor(z / RG);
  const span = Math.ceil(maxDist / RG);
  let best = maxDist * maxDist, br = -1, bs = -1;
  for (let a = -span; a <= span; a++) for (let b = -span; b <= span; b++) {
    const arr = roadGrid.get(rkey(ix + a, iz + b));
    if (!arr) continue;
    for (let k = 0; k < arr.length; k += 2) {
      const o = roads[arr[k]].samples[arr[k + 1]];
      const dx = x - o.x, dz = z - o.z, d = dx * dx + dz * dz;
      if (d < best) { best = d; br = arr[k]; bs = arr[k + 1]; }
    }
  }
  if (br < 0) return null;
  const road = roads[br], S = road.samples;
  // 前後の点との線分に投影して、なめらかに
  let i0 = bs, i1 = bs + 1;
  if (i1 >= S.length) { i0 = bs - 1; i1 = bs; }
  const A = S[i0], B = S[i1];
  const abx = B.x - A.x, abz = B.z - A.z;
  let t = ((x - A.x) * abx + (z - A.z) * abz) / (abx * abx + abz * abz);
  if (t < 0 && i0 > 0) { i0--; i1--; return projOn(road, i0, i1, x, z); }
  if (t > 1 && i1 < S.length - 1) { i0++; i1++; return projOn(road, i0, i1, x, z); }
  return projOn(road, i0, i1, x, z);
}
function projOn(road, i0, i1, x, z) {
  const S = road.samples, A = S[i0], B = S[i1];
  const abx = B.x - A.x, abz = B.z - A.z;
  let t = ((x - A.x) * abx + (z - A.z) * abz) / (abx * abx + abz * abz);
  t = Math.min(1, Math.max(0, t));
  const px = A.x + abx * t, pz = A.z + abz * t;
  const rx = lerp(A.rx, B.rx, t), rz = lerp(A.rz, B.rz, t);
  const lateral = (x - px) * rx + (z - pz) * rz;
  const along = Math.hypot(x - px - lateral * rx, z - pz - lateral * rz);
  return {
    road, i: t < 0.5 ? i0 : i1, t, s: lerp(A.s, B.s, t), y: lerp(A.y, B.y, t),
    lateral, dist: Math.abs(lateral) + along, px, pz,
    bridge: A.bridge && B.bridge, tunnel: A.tunnel || B.tunnel, ford: A.ford || B.ford,
    tx: lerp(A.tx, B.tx, t), tz: lerp(A.tz, B.tz, t), rx, rz,
  };
}

// ------------------------------------------------------------ 地面の高さの格子
export const heights = new Float32Array(GRID_N * GRID_N);
export const groundKind = new Uint8Array(GRID_N * GRID_N); // 0 森 1 草 2 法面 3 じゃり(河原) 4 田んぼ 5 路肩
export const KIND = { forest: 0, grass: 1, cut: 2, gravel: 3, field: 4, shoulder: 5 };

function fieldAt(x, z) {
  for (const f of FIELDS) if (((x - f.x) / f.rx) ** 2 + ((z - f.z) / f.rz) ** 2 < 1) return f;
  return null;
}
export function villageAt(x, z, pad = 0) {
  for (const v of VILLAGES) if ((x - v.x) ** 2 + (z - v.z) ** 2 < (v.r + pad) ** 2) return v;
  return null;
}

(function buildHeights() {
  for (let j = 0; j < GRID_N; j++) {
    for (let i = 0; i < GRID_N; i++) {
      const x = MAP.x0 + i * MAP.cell, z = MAP.z0 + j * MAP.cell;
      let h = baseHeight(x, z);
      let kind = KIND.forest;
      const v = villageAt(x, z);
      if (v) { const vh = nodeHeightNear(x, z); if (vh != null) h = lerp(h, vh, smoothstep(v.r, v.r * 0.5, Math.hypot(x - v.x, z - v.z))); kind = KIND.grass; }
      const f = fieldAt(x, z);
      if (f) { h = lerp(h, Math.min(h, nodeHeightNear(f.x, f.z, 400) - 0.6), 0.9); kind = KIND.field; }
      const dz = z - riverZ(x);
      if (Math.abs(dz) < 26) kind = KIND.gravel;
      const nr = nearestRoad(x, z, 60);
      if (nr) {
        const k = nr.road.kind;
        const core = k.half + k.shoulder;
        const d = Math.abs(nr.lateral);
        if (nr.tunnel) {
          if (d < k.half + 3) h = Math.max(h, nr.y + 9.5);
        } else if (nr.bridge) {
          // 橋の下は谷のまま。橋のたもとだけ道に合わせる
        } else {
          const dh = h - nr.y;
          const fall = Math.max(5, Math.abs(dh) * (dh > 0 ? 0.75 : 1.2));
          // 道のわきは 4.5m ほど平らにして(側溝と草地)、地面の三角形が道の上にはみ出さないようにする
          const flat = core + 4.5;
          if (d <= core) { h = nr.y - 0.06; kind = KIND.shoulder; }
          else if (d <= flat) { h = nr.y - 0.12; kind = KIND.grass; }
          else {
            const t = smoothstep(flat, flat + fall, d);
            h = lerp(nr.y - 0.12, h, t);
            if (dh > 2 && d < core + fall * 0.8) kind = KIND.cut;
            else if (d < core + 3) kind = KIND.grass;
          }
        }
      }
      heights[j * GRID_N + i] = h;
      groundKind[j * GRID_N + i] = kind;
    }
  }
})();
function nodeHeightNear(x, z, maxD = 420) {
  let best = 1e9, h = null;
  for (const [k, [nx, nz]] of Object.entries(NODES)) {
    const d = Math.hypot(nx - x, nz - z);
    if (d < best && d < maxD) { best = d; h = nodeHeight[k]; }
  }
  return h;
}

// 格子の三角形にそった高さ(描画の地面と同じ)
export function terrainHeight(x, z) {
  const fx = (x - MAP.x0) / MAP.cell, fz = (z - MAP.z0) / MAP.cell;
  const i = Math.max(0, Math.min(GRID_N - 2, Math.floor(fx)));
  const j = Math.max(0, Math.min(GRID_N - 2, Math.floor(fz)));
  const u = Math.min(1, Math.max(0, fx - i)), v = Math.min(1, Math.max(0, fz - j));
  const h00 = heights[j * GRID_N + i], h10 = heights[j * GRID_N + i + 1];
  const h01 = heights[(j + 1) * GRID_N + i], h11 = heights[(j + 1) * GRID_N + i + 1];
  // 対角線は (i,j+1)-(i+1,j)(PlaneGeometry と同じ分け方)
  if (u + v <= 1) return h00 + (h10 - h00) * u + (h01 - h00) * v;
  return h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
}

// ------------------------------------------------------------ 水
let floodExtra = 0; // 大雨で沢の水かさが増える(0..0.5m)
export function setFloodLevel(v) { floodExtra = v; }
export function waterLevelAt(x, z, nr) {
  // 川
  const dz = z - riverZ(x);
  if (Math.abs(dz) < 40) return RIVER_LEVEL + floodExtra * 1.5;
  // 沢(道の低い所)
  if (nr && nr.ford && nr.road.fordMid) {
    const m = nr.road.fordMid;
    const d = Math.hypot(x - m.x, z - m.z);
    if (d < 30) return nr.road.fordLow + 0.12 + floodExtra;
  }
  // 田んぼ
  const f = fieldAt(x, z);
  if (f) return terrainHeight(x, z) + 0.06;
  return -1e9;
}
export function fordInfo() {
  const r = roadById.r5;
  return { x: r.fordMid.x, z: r.fordMid.z, low: r.fordLow };
}

// ------------------------------------------------------------ 物理用:地面の高さと種類
// 道の上なら道の高さ(橋・トンネルも)、それ以外は地形
export function groundAt(x, z) {
  const nr = nearestRoad(x, z, 12);
  if (nr) {
    const k = nr.road.kind;
    const d = Math.abs(nr.lateral);
    if (d <= k.half + k.shoulder + 0.2 && (nr.bridge || nr.tunnel || d <= k.half + k.shoulder)) {
      return { h: nr.y, nr, onRoad: d <= k.half + 0.15, road: nr.road, lateral: nr.lateral };
    }
    if (nr.bridge || nr.tunnel) return { h: -50, nr, onRoad: false, fall: true, lateral: nr.lateral };
  }
  return { h: terrainHeight(x, z), nr, onRoad: false };
}

export function surfaceAt(x, z, g) {
  g = g || groundAt(x, z);
  let type;
  if (g.onRoad) type = g.road.kind.surface;
  else if (g.nr && Math.abs(g.nr.lateral) <= g.nr.road.kind.half + g.nr.road.kind.shoulder + 0.2) type = 'shoulder';
  else {
    const fx = Math.round((x - MAP.x0) / MAP.cell), fz = Math.round((z - MAP.z0) / MAP.cell);
    const k = groundKind[Math.max(0, Math.min(GRID_N - 1, fz)) * GRID_N + Math.max(0, Math.min(GRID_N - 1, fx))];
    type = ['forest', 'grass', 'grass', 'gravel', 'mud', 'shoulder'][k];
  }
  const wl = waterLevelAt(x, z, g.nr);
  const depth = Math.max(0, wl - g.h);
  return { type, depth, ...SURF[type] };
}
// grip = 濡れているときのすべりにくさ、roll = 転がり抵抗、bump = でこぼこ(m)
export const SURF = {
  asphalt:  { grip: 0.80, roll: 0.012, bump: 0.0 },
  shoulder: { grip: 0.66, roll: 0.02, bump: 0.01 },
  gravel:   { grip: 0.60, roll: 0.03, bump: 0.025 },
  grass:    { grip: 0.48, roll: 0.06, bump: 0.035 },
  forest:   { grip: 0.42, roll: 0.08, bump: 0.05 },
  mud:      { grip: 0.30, roll: 0.16, bump: 0.03 },
};

// 道の上の水たまり(決まった場所に。雨が強いほど大きくなる)
export function puddleAt(x, z, wet) {
  const n = vnoise(x / 3.1 + 17.3, z / 7.7 - 4.1) * 0.6 + vnoise(x / 1.3, z / 1.9) * 0.4;
  return smoothstep(0.78 - wet * 0.12, 0.9 - wet * 0.1, n);
}

// ------------------------------------------------------------ コマ図の距離を道のデータから計算
export function routeRows() {
  let acc = 0;
  const atNode = { start: 0 };
  for (const id of ROUTE.legs) {
    const r = roadById[id];
    acc += r.length;
    atNode[r.def.to] = acc;
  }
  return ROUTE.rows.map((row, i) => ({ ...row, no: i + 1, km: (atNode[row.at] ?? 0) / 1000 }));
}

export function nodePos(name) {
  const [x, z] = NODES[name];
  return { x, z, y: nodeHeight[name] };
}
export { NODES, nodeHeight, riverZ };
export const FIELDS_LIST = FIELDS;
