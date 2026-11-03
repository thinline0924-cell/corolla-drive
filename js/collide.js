// ぶつかる物(木・電柱・ガードレール・壁など)を、上から見た円と線分で持つ
const CELL = 16;
const grid = new Map();
const key = (ix, iz) => ix * 100003 + iz;

function put(ix, iz, obj) {
  const k = key(ix, iz);
  let a = grid.get(k);
  if (!a) grid.set(k, a = []);
  a.push(obj);
}

// 円(木の幹・柱など)。y0..y1 はぶつかる高さ
export function addCircle(x, z, r, y0 = -1e9, y1 = 1e9, tag = '') {
  const o = { type: 'c', x, z, r, y0, y1, tag };
  for (let ix = Math.floor((x - r) / CELL); ix <= Math.floor((x + r) / CELL); ix++)
    for (let iz = Math.floor((z - r) / CELL); iz <= Math.floor((z + r) / CELL); iz++) put(ix, iz, o);
  return o;
}

// 線分(ガードレール・壁など)
export function addSeg(x0, z0, x1, z1, y0 = -1e9, y1 = 1e9, tag = '') {
  const o = { type: 's', x0, z0, x1, z1, y0, y1, tag };
  const len = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(1, Math.ceil(len / (CELL * 0.5)));
  const seen = new Set();
  for (let i = 0; i <= n; i++) {
    const x = x0 + (x1 - x0) * i / n, z = z0 + (z1 - z0) * i / n;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const ix = Math.floor(x / CELL) + a, iz = Math.floor(z / CELL) + b;
      const k = key(ix, iz);
      if (seen.has(k)) continue;
      seen.add(k); put(ix, iz, o);
    }
  }
  return o;
}

// 長方形(家など)を4本の線分で
export function addBox(x, z, w, d, yaw, y0, y1, tag = '') {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const P = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([a, b]) => [x + a * c + b * s, z - a * s + b * c]);
  for (let i = 0; i < 4; i++) addSeg(P[i][0], P[i][1], P[(i + 1) % 4][0], P[(i + 1) % 4][1], y0, y1, tag);
}

export function removeTag(tag) {
  for (const a of grid.values()) for (let i = a.length - 1; i >= 0; i--) if (a[i].tag === tag) a.splice(i, 1);
}

// 点 (x, z) から半径 r の中にある物
export function nearby(x, z, r) {
  const out = new Set();
  for (let ix = Math.floor((x - r) / CELL); ix <= Math.floor((x + r) / CELL); ix++)
    for (let iz = Math.floor((z - r) / CELL); iz <= Math.floor((z + r) / CELL); iz++) {
      const a = grid.get(key(ix, iz));
      if (a) for (const o of a) out.add(o);
    }
  return out;
}

// 点と物のいちばん近い所。めりこみ(pen)と押し出す向き(nx, nz)を返す
export function contact(o, x, z, rad) {
  if (o.type === 'c') {
    const dx = x - o.x, dz = z - o.z, d = Math.hypot(dx, dz);
    const pen = o.r + rad - d;
    if (pen <= 0) return null;
    return { pen, nx: d > 1e-6 ? dx / d : 1, nz: d > 1e-6 ? dz / d : 0 };
  }
  const abx = o.x1 - o.x0, abz = o.z1 - o.z0;
  let t = ((x - o.x0) * abx + (z - o.z0) * abz) / (abx * abx + abz * abz || 1);
  t = Math.max(0, Math.min(1, t));
  const px = o.x0 + abx * t, pz = o.z0 + abz * t;
  const dx = x - px, dz = z - pz, d = Math.hypot(dx, dz);
  const pen = rad - d;
  if (pen <= 0) return null;
  return { pen, nx: d > 1e-6 ? dx / d : -abz, nz: d > 1e-6 ? dz / d : abx };
}
