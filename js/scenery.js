// 景色を作る:地面、道、木、ガードレール、橋、トンネル、川
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as W from './world.js';
import * as T from './textures.js';
import * as C from './collide.js';
import { lam, std, psx, rng, WET } from './psx.js';
import { buildProps } from './props.js';

const CH = 32; // 1つの地面のかたまりのマス数(32 × 4m = 128m)
export const LINE_GLOW = { value: 0 };

export function buildWorld(scene) {
  const out = { chunks: [], treeChunks: [], emitters: [], animated: [], night: { value: 0 } };
  const rnd = rng(42);

  // ------------------------------------------------------------ 地面
  {
    const mat = lam({ vertexColors: true, flatShading: true });
    const NC = (W.GRID_N - 1) / CH;
    const col = new THREE.Color();
    const kindColor = [
      new THREE.Color('#26331e'), // 森
      new THREE.Color('#34472a'), // 草
      new THREE.Color('#4b5444'), // 法面
      new THREE.Color('#5d5b52'), // 河原
      new THREE.Color('#3b3a2a'), // 田んぼ
      new THREE.Color('#383934'), // 路肩
    ];
    for (let cj = 0; cj < NC; cj++) for (let ci = 0; ci < NC; ci++) {
      const n = CH + 1;
      const pos = new Float32Array(n * n * 3), cols = new Float32Array(n * n * 3);
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const gi = ci * CH + i, gj = cj * CH + j, k = gj * W.GRID_N + gi;
        const x = W.MAP.x0 + gi * W.MAP.cell, z = W.MAP.z0 + gj * W.MAP.cell;
        const v = (j * n + i) * 3;
        pos[v] = x; pos[v + 1] = W.heights[k]; pos[v + 2] = z;
        col.copy(kindColor[W.groundKind[k]]);
        const nz = W.fbm(x / 23, z / 23, 2);
        col.offsetHSL(nz * 0.02, nz * 0.05, nz * 0.03 + (rnd() - 0.5) * 0.012);
        cols[v] = col.r; cols[v + 1] = col.g; cols[v + 2] = col.b;
      }
      const idx = [];
      for (let j = 0; j < CH; j++) for (let i = 0; i < CH; i++) {
        const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
        idx.push(a, c, b, c, d, b); // 対角線は (i,j+1)-(i+1,j)。world.terrainHeight と同じ
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      g.setIndex(idx);
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mat);
      m.matrixAutoUpdate = false;
      scene.add(m);
      out.chunks.push({ mesh: m, cx: W.MAP.x0 + (ci + 0.5) * CH * W.MAP.cell, cz: W.MAP.z0 + (cj + 0.5) * CH * W.MAP.cell });
    }
  }

  // ------------------------------------------------------------ 道
  const puddle = T.puddleTexture();
  const roadMats = {};
  for (const kind of ['pref', 'narrow', 'gravel']) {
    const k = W.roads.find(r => r.kindName === kind).kind;
    const m = std({ map: T.roadTexture(kind, k.half, k.shoulder), roughness: 0.45, metalness: 0 });
    m.userData.key = 'road' + kind;
    const isGravel = kind === 'gravel';
    const prev = m.onBeforeCompile;
    m.onBeforeCompile = (sh, r) => {
      prev(sh, r);
      sh.uniforms.uPud = { value: puddle };
      sh.uniforms.uWet = WET;
      sh.uniforms.uLine = LINE_GLOW;
      sh.fragmentShader = sh.fragmentShader
        .replace('void main() {', 'uniform sampler2D uPud; uniform float uWet; uniform float uLine;\nvoid main() {')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          // 白線・黄線は前照灯を反射して光る(再帰反射)
          float lum = dot(texture2D(map, vMapUv).rgb, vec3(0.33));
          totalEmissiveRadiance += texture2D(map, vMapUv).rgb * smoothstep(0.32, 0.55, lum) * uLine * exp(-length(vViewPosition) / 38.0) * 0.9;`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          float wet = texture2D(uPud, vMapUv * vec2(1.0, 0.31)).r * uWet;
          roughnessFactor = mix(${isGravel ? '0.75' : '0.42'} - uWet * 0.12, 0.05, wet);
          diffuseColor.rgb *= mix(1.0 - uWet * 0.2, 0.5, wet);`);
    };
    m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = -2;
    roadMats[kind] = m;
  }
  const tunnelFloorMat = new THREE.MeshBasicMaterial({ vertexColors: true, map: T.roadTexture('pref', 3.1, 0.8) });

  W.roads.forEach((road, ri) => {
    const S = road.samples, k = road.kind;
    const half = k.half + k.shoulder;
    const lift = 0.02 + ri * 0.004;
    const build = (filter, mat, colorFn) => {
      const pos = [], uv = [], idx = [], cols = [];
      let n = 0, prevOk = false;
      for (let i = 0; i < S.length; i++) {
        const o = S[i];
        const ok = filter(o, i);
        if (!ok) { prevOk = false; continue; }
        pos.push(o.x - o.rx * half, o.y + lift, o.z - o.rz * half, o.x + o.rx * half, o.y + lift, o.z + o.rz * half);
        uv.push(0, o.s / 14, 1, o.s / 14);
        if (colorFn) { const c = colorFn(o); cols.push(c.r, c.g, c.b, c.r, c.g, c.b); }
        if (prevOk) { const a = (n - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
        n++; prevOk = true;
      }
      if (!n) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      if (colorFn) g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      // 上向きになるように
      if (g.attributes.normal.getY(0) < 0) { const ix = g.index.array; for (let q = 0; q < ix.length; q += 3) { const t = ix[q]; ix[q] = ix[q + 2]; ix[q + 2] = t; } g.computeVertexNormals(); }
      const m = new THREE.Mesh(g, mat);
      m.renderOrder = 1 + ri;
      scene.add(m);
    };
    build((o, i) => !o.tunnel || !(S[i + 1] && S[i + 1].tunnel) && !(S[i - 1] && S[i - 1].tunnel), roadMats[road.kindName]);
    if (S.some(o => o.tunnel)) {
      const sod = new THREE.Color('#d98a3a');
      build((o, i) => o.tunnel || (S[i - 1] && S[i - 1].tunnel), tunnelFloorMat, o => {
        const l = 0.3 + 0.7 * Math.pow(0.5 + 0.5 * Math.cos(o.s / 16 * Math.PI * 2), 2);
        return sod.clone().multiplyScalar(0.25 + 0.55 * l);
      });
    }
  });

  // ------------------------------------------------------------ 道ばた:ガードレール・視線誘導標・電柱
  const railGeos = [], postGeos = [], delinGeos = [], reflGeos = [], poleGeos = [];
  const wirePts = [];
  const nearNode = (x, z, r) => Object.values(W.NODES).some(([nx, nz]) => (nx - x) ** 2 + (nz - z) ** 2 < r * r);
  const boxAt = (arr, w, h, d, x, y, z, yaw) => { const g = new THREE.BoxGeometry(w, h, d); g.rotateY(yaw); g.translate(x, y, z); arr.push(g); };
  for (const road of W.roads) {
    if (road.kindName === 'gravel') continue;
    const S = road.samples, k = road.kind, edge = k.half + k.shoulder;
    for (const side of [-1, 1]) {
      // ガードレールが必要な所:外側が 1.8m 以上低い
      const need = S.map((o, i) => {
        if (o.tunnel || o.bridge || o.ford || W.villageAt(o.x, o.z, 10) || nearNode(o.x, o.z, 16)) return false;
        const t = W.terrainHeight(o.x + o.rx * side * (edge + 4), o.z + o.rz * side * (edge + 4));
        return t < o.y - 1.8;
      });
      for (let i = 1; i < need.length - 1; i++) if (!need[i] && need[i - 1] && need[i + 1]) need[i] = true;
      for (let i = 0; i < S.length - 2; i += 2) {
        if (!need[i] || !need[i + 2]) continue;
        const a = S[i], b = S[i + 2];
        const ax = a.x + a.rx * side * (edge + 0.3), az = a.z + a.rz * side * (edge + 0.3);
        const bx = b.x + b.rx * side * (edge + 0.3), bz = b.z + b.rz * side * (edge + 0.3);
        const len = Math.hypot(bx - ax, bz - az), yaw = Math.atan2(bx - ax, bz - az);
        const g = new THREE.BoxGeometry(0.05, 0.3, len + 0.05);
        // 坂にそって傾ける
        g.rotateX(-Math.atan2(b.y - a.y, len));
        g.rotateY(yaw);
        g.translate((ax + bx) / 2, (a.y + b.y) / 2 + 0.62, (az + bz) / 2);
        railGeos.push(g);
        const p = new THREE.CylinderGeometry(0.06, 0.06, 1.0, 5);
        p.translate(ax, a.y + 0.4, az); postGeos.push(p);
        C.addSeg(ax, az, bx, bz, a.y - 0.5, a.y + 0.85, 'rail');
      }
      // 視線誘導標(カーブで、反射板が光る)
      if (road.kindName === 'pref') {
        for (let i = 6; i < S.length - 6; i += 12) {
          const o = S[i];
          if (o.tunnel || o.bridge || need[i] || nearNode(o.x, o.z, 14) || W.villageAt(o.x, o.z)) continue;
          const turn = Math.abs(S[i + 5].tx * S[i - 5].tz - S[i + 5].tz * S[i - 5].tx);
          if (turn < 0.08) continue;
          const x = o.x + o.rx * side * (edge + 0.2), z = o.z + o.rz * side * (edge + 0.2);
          const g = new THREE.BoxGeometry(0.08, 1.0, 0.08); g.translate(x, o.y + 0.5, z); delinGeos.push(g);
          const r = new THREE.BoxGeometry(0.1, 0.1, 0.1); r.translate(x, o.y + 0.95, z); reflGeos.push(r);
        }
      }
    }
    // 電柱(県道の山側に 38m ごと)
    if (['r1', 'r3', 'r7', 'r9', 'r11', 'r5'].includes(road.id)) {
      let prevTop = null;
      for (let i = 4; i < S.length; i += 19) {
        const o = S[i];
        if (o.tunnel || o.bridge || o.ford) { prevTop = null; continue; }
        const x = o.x - o.rx * (edge + 1.2), z = o.z - o.rz * (edge + 1.2);
        const gy = W.terrainHeight(x, z);
        const p = new THREE.CylinderGeometry(0.12, 0.16, 10, 6); p.translate(x, gy + 4.8, z); poleGeos.push(p);
        const yaw = Math.atan2(o.tx, o.tz);
        boxAt(poleGeos, 1.5, 0.1, 0.1, x, gy + 9.2, z, yaw + Math.PI / 2);
        C.addCircle(x, z, 0.2, gy - 1, gy + 10, 'pole');
        const top = [new THREE.Vector3(x - o.tz * 0.6, gy + 9.25, z + o.tx * 0.6), new THREE.Vector3(x + o.tz * 0.6, gy + 9.25, z - o.tx * 0.6)];
        if (prevTop) for (let w = 0; w < 2; w++) {
          const A = prevTop[w], B = top[w];
          for (let j = 0; j < 10; j++) {
            const f = t => { const v = A.clone().lerp(B, t); v.y -= Math.sin(t * Math.PI) * 0.8; return v; };
            wirePts.push(f(j / 10), f((j + 1) / 10));
          }
        }
        prevTop = top;
      }
    }
  }
  const addMerged = (geos, mat) => { if (geos.length) { const m = new THREE.Mesh(mergeGeometries(geos.map(g => g.index ? g.toNonIndexed() : g)), mat); scene.add(m); return m; } };
  addMerged(railGeos, lam({ color: '#c7cac2' }));
  addMerged(postGeos, lam({ color: '#a9aca5' }));
  addMerged(delinGeos, lam({ color: '#d8d8d2' }));
  const reflMat = lam({ color: '#ff8a1c', emissive: '#000000' });
  out.reflector = reflMat;
  addMerged(reflGeos, reflMat);
  addMerged(poleGeos, lam({ color: '#76776f' }));
  if (wirePts.length) scene.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(wirePts), new THREE.LineBasicMaterial({ color: '#121412' })));

  // ------------------------------------------------------------ 橋
  {
    const geos = [], pierGeos = [];
    for (const road of W.roads) {
      const S = road.samples, edge = road.kind.half + road.kind.shoulder;
      const idx = S.map((o, i) => o.bridge ? i : -1).filter(i => i >= 0);
      if (!idx.length) continue;
      const i0 = Math.max(0, idx[0] - 2), i1 = Math.min(S.length - 1, idx[idx.length - 1] + 2);
      for (let i = i0; i < i1; i++) {
        const a = S[i], b = S[i + 1];
        for (const side of [-1, 1]) {
          const ax = a.x + a.rx * side * (edge + 0.15), az = a.z + a.rz * side * (edge + 0.15);
          const bx = b.x + b.rx * side * (edge + 0.15), bz = b.z + b.rz * side * (edge + 0.15);
          const len = Math.hypot(bx - ax, bz - az), yaw = Math.atan2(bx - ax, bz - az);
          // 欄干(低いコンクリートの壁+上の手すり)
          let g = new THREE.BoxGeometry(0.25, 0.55, len + 0.02); g.rotateY(yaw); g.translate((ax + bx) / 2, (a.y + b.y) / 2 + 0.27, (az + bz) / 2); geos.push(g);
          g = new THREE.BoxGeometry(0.08, 0.08, len + 0.02); g.rotateY(yaw); g.translate((ax + bx) / 2, (a.y + b.y) / 2 + 1.0, (az + bz) / 2); geos.push(g);
          if (i % 2 === 0) { g = new THREE.BoxGeometry(0.08, 0.5, 0.08); g.translate(ax, a.y + 0.78, az); geos.push(g); }
          C.addSeg(ax, az, bx, bz, a.y - 1, a.y + 1.1, 'bridge');
        }
        // 橋げた
        const g = new THREE.BoxGeometry(edge * 2 + 0.6, 1.1, Math.hypot(b.x - a.x, b.z - a.z) + 0.05);
        g.rotateY(Math.atan2(b.x - a.x, b.z - a.z)); g.translate((a.x + b.x) / 2, (a.y + b.y) / 2 - 0.6, (a.z + b.z) / 2); geos.push(g);
        if ((i - i0) % 9 === 4) {
          const ground = W.terrainHeight(a.x, a.z) - 2;
          const h = a.y - 1.1 - ground;
          if (h > 1) { const p = new THREE.BoxGeometry(edge * 1.6, h, 1.4); p.rotateY(Math.atan2(a.tx, a.tz)); p.translate(a.x, ground + h / 2, a.z); pierGeos.push(p); }
        }
      }
    }
    addMerged(geos, lam({ color: '#8d8f88' }));
    addMerged(pierGeos, lam({ color: '#6f716a' }));
  }

  // ------------------------------------------------------------ トンネル
  out.tunnels = [];
  for (const road of W.roads) {
    const S = road.samples;
    const ids = S.map((o, i) => o.tunnel ? i : -1).filter(i => i >= 0);
    if (!ids.length) continue;
    const a = ids[0], b = ids[ids.length - 1];
    const HW = road.kind.half + 0.9, WALL = 3.0, R = HW;
    // 断面(右の壁の下から、アーチをまわって左の壁の下まで)
    const prof = [[HW, 0], [HW, WALL]];
    for (let k = 1; k < 10; k++) { const t = k / 10 * Math.PI; prof.push([Math.cos(t) * R, WALL + Math.sin(t) * R * 0.75]); }
    prof.push([-HW, WALL], [-HW, 0]);
    const pos = [], cols = [], idx = [];
    const sod = new THREE.Color('#e09040'), dark = new THREE.Color('#2c2620');
    for (let i = a; i <= b; i++) {
      const o = S[i];
      const light = Math.pow(0.5 + 0.5 * Math.cos(o.s / 16 * Math.PI * 2), 3);
      prof.forEach(([px, py], k) => {
        pos.push(o.x + o.rx * px, o.y + py, o.z + o.rz * px);
        const near = 1 - Math.min(1, Math.abs(py - 4.2) / 5);
        const c = dark.clone().lerp(sod, (0.25 + 0.75 * light) * (0.45 + 0.55 * near) * (k === 0 || k === prof.length - 1 ? 0.5 : 1));
        // 壁の下のほうは雨水のすじで黒ずむ
        if (py < 1.2) c.multiplyScalar(0.7);
        cols.push(c.r, c.g, c.b);
      });
      if (i > a) {
        const P = prof.length, base = (i - a) * P, prev = base - P;
        for (let k = 0; k < P - 1; k++) idx.push(prev + k, base + k, prev + k + 1, prev + k + 1, base + k, base + k + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    g.setIndex(idx);
    const tube = new THREE.Mesh(g, psx(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })));
    scene.add(tube);
    // 照明(16m ごと、天井の左右)
    const lampGeos = [];
    for (let i = a; i <= b; i += 8) {
      const o = S[i];
      for (const sd of [-1, 1]) {
        const gl = new THREE.BoxGeometry(0.3, 0.15, 1.2);
        gl.rotateY(Math.atan2(o.tx, o.tz));
        gl.translate(o.x + o.rx * sd * HW * 0.62, o.y + WALL + R * 0.6, o.z + o.rz * sd * HW * 0.62);
        lampGeos.push(gl);
      }
      out.emitters.push({ x: o.x, y: o.y + WALL + R * 0.55, z: o.z, color: 0xff9a40, intensity: 18, dist: 14, tunnel: true });
    }
    addMerged(lampGeos, new THREE.MeshBasicMaterial({ color: '#ffc070' }));
    // 壁の当たり判定
    for (let i = a; i < b; i++) for (const sd of [-1, 1]) {
      const p = S[i], q = S[i + 1];
      C.addSeg(p.x + p.rx * sd * (HW - 0.3), p.z + p.rz * sd * (HW - 0.3), q.x + q.rx * sd * (HW - 0.3), q.z + q.rz * sd * (HW - 0.3), p.y - 1, p.y + 6, 'tunnel');
    }
    // 入口の顔(アーチの穴のあいたコンクリートの壁)と名前の板
    const portal = (o, dir) => {
      const sh = new THREE.Shape();
      const PW = HW + 3.5, PH = WALL + R + 2.2;
      sh.moveTo(-PW, -1.5); sh.lineTo(PW, -1.5); sh.lineTo(PW, PH); sh.lineTo(-PW, PH); sh.lineTo(-PW, -1.5);
      const hole = new THREE.Path();
      hole.moveTo(HW, 0); hole.lineTo(HW, WALL);
      for (let k = 1; k < 16; k++) { const t = k / 16 * Math.PI; hole.lineTo(Math.cos(t) * R, WALL + Math.sin(t) * R * 0.75); }
      hole.lineTo(-HW, WALL); hole.lineTo(-HW, 0); hole.lineTo(HW, 0);
      sh.holes.push(hole);
      const eg = new THREE.ExtrudeGeometry(sh, { depth: 1.4, bevelEnabled: false });
      const m = new THREE.Mesh(eg, lam({ color: '#7b7d76' }));
      m.position.set(o.x, o.y, o.z);
      m.rotation.y = Math.atan2(o.tx, o.tz) + (dir > 0 ? Math.PI : 0);
      m.translateZ(-0.7);
      scene.add(m);
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 0.9), new THREE.MeshLambertMaterial({
        map: T.signTexture(512, 110, '#3d3f3a', [{ text: '湯ノ沢トンネル', size: 64, y: 58, color: '#e6e2d6' }], '#575a52'),
      }));
      plate.position.set(o.x, o.y + WALL + R * 0.75 + 1.1, o.z);
      plate.rotation.y = m.rotation.y;
      plate.translateZ(0.75);
      scene.add(plate);
      // 入口の左右の壁(袖壁)
      for (const sd of [-1, 1]) {
        C.addSeg(o.x + o.rx * sd * (HW - 0.3), o.z + o.rz * sd * (HW - 0.3), o.x + o.rx * sd * (HW + 4), o.z + o.rz * sd * (HW + 4), o.y - 1, o.y + 8, 'tunnel');
      }
    };
    portal(S[a], -1);
    portal(S[b], 1);
    out.tunnels.push({ road, a, b });
  }

  // ------------------------------------------------------------ 水(川・沢・田んぼ)
  const waterMat = std({ color: '#26302f', roughness: 0.12, metalness: 0.2 });
  {
    const pos = [], idx = [];
    let n = 0;
    for (let x = W.MAP.x0; x <= W.MAP.x0 + W.MAP.size; x += 8) {
      const z = W.riverZ(x);
      pos.push(x, 0, z - 34, x, 0, z + 34);
      if (n) { const q = (n - 1) * 2; idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
      n++;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx); g.computeVertexNormals();
    if (g.attributes.normal.getY(0) < 0) { const ix = g.index.array; for (let q = 0; q < ix.length; q += 3) { const t = ix[q]; ix[q] = ix[q + 2]; ix[q + 2] = t; } g.computeVertexNormals(); }
    const river = new THREE.Mesh(g, waterMat);
    river.position.y = W.RIVER_LEVEL;
    scene.add(river);
    out.river = river;
  }
  {
    const f = W.fordInfo();
    const g = new THREE.CircleGeometry(26, 20); g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, std({ color: '#3a3628', roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.86 }));
    m.position.set(f.x, f.low + 0.12, f.z);
    m.renderOrder = 30;
    scene.add(m);
    out.ford = { mesh: m, base: f.low + 0.12 };
  }
  for (const fl of W.FIELDS_LIST) {
    const g = new THREE.CircleGeometry(1, 24); g.rotateX(-Math.PI / 2); g.scale(fl.rx, 1, fl.rz);
    const y = W.terrainHeight(fl.x, fl.z) + 0.06;
    const m = new THREE.Mesh(g, std({ color: '#2f3326', roughness: 0.15, metalness: 0.1 }));
    m.position.set(fl.x, y, fl.z); scene.add(m);
    // 稲(夏なので青々としている)
    const blade = new THREE.ConeGeometry(0.12, 0.6, 4); blade.translate(0, 0.3, 0);
    const pts = [];
    for (let a = -fl.rx; a < fl.rx; a += 1.4) for (let b = -fl.rz; b < fl.rz; b += 0.9) {
      if ((a / fl.rx) ** 2 + (b / fl.rz) ** 2 > 0.92) continue;
      if (W.nearestRoad(fl.x + a, fl.z + b, 6)) continue;
      pts.push([fl.x + a + (rnd() - 0.5) * 0.3, fl.z + b + (rnd() - 0.5) * 0.2]);
    }
    const im = new THREE.InstancedMesh(blade, lam({ color: '#4f7a2e', flatShading: true }), pts.length);
    const M = new THREE.Matrix4();
    pts.forEach(([x, z], i) => { M.makeTranslation(x, y - 0.05, z); im.setMatrixAt(i, M); });
    scene.add(im);
  }

  // ------------------------------------------------------------ 木
  buildTrees(scene, out, rnd);

  // ------------------------------------------------------------ 集落・目印など
  buildProps(scene, out);

  return out;
}

// 木の形:杉(円すいを重ねる)/ 広葉樹(かたまりを重ねる)/ やぶ
function treeGeos() {
  const paint = (g, c) => {
    const col = new THREE.Color(c), n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = col.r; a[i * 3 + 1] = col.g; a[i * 3 + 2] = col.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return g.index ? g.toNonIndexed() : g;
  };
  const trunk = (h, r) => { const g = new THREE.CylinderGeometry(r * 0.7, r, h, 5); g.translate(0, h / 2, 0); return paint(g, '#3b2e22'); };
  const cone = (r, h, y) => { const g = new THREE.ConeGeometry(r, h, 6); g.translate(0, y, 0); return paint(g, '#ffffff'); };
  const blob = (r, x, y, z) => { const g = new THREE.IcosahedronGeometry(r, 0); g.scale(1, 0.8, 1); g.translate(x, y, z); return paint(g, '#ffffff'); };
  const cedar = mergeGeometries([trunk(4, 0.22), cone(1.7, 4.2, 4.6), cone(1.35, 3.6, 6.6), cone(1.0, 3.0, 8.4), cone(0.6, 2.2, 10.0)]);
  const broad = mergeGeometries([trunk(3, 0.2), blob(2.2, 0, 4.2, 0), blob(1.7, 1.1, 5.4, 0.4), blob(1.5, -0.9, 5.0, -0.6), blob(1.2, 0.2, 6.4, -0.2)]);
  const bush = mergeGeometries([blob(0.9, 0, 0.5, 0), blob(0.7, 0.6, 0.6, 0.3), blob(0.6, -0.5, 0.45, -0.3)]);
  return { cedar, broad, bush };
}

function buildTrees(scene, out, rnd) {
  const G = treeGeos();
  const mat = lam({ vertexColors: true, flatShading: true });
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), Sv = new THREE.Vector3(), P = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
  const size = 128;
  for (let cz = W.MAP.z0; cz < W.MAP.z0 + W.MAP.size; cz += size) for (let cx = W.MAP.x0; cx < W.MAP.x0 + W.MAP.size; cx += size) {
    const lists = { cedar: [], broad: [], bush: [] };
    for (let z = cz; z < cz + size; z += 6.5) for (let x = cx; x < cx + size; x += 6.5) {
      const px = x + rnd() * 6, pz = z + rnd() * 6;
      const dens = 0.55 + W.fbm(px / 140, pz / 140, 3) * 0.9;
      if (W.villageAt(px, pz, -10)) continue;
      const nr = W.nearestRoad(px, pz, 30);
      let roadside = false;
      if (nr) {
        const d = Math.abs(nr.lateral) - (nr.road.kind.half + nr.road.kind.shoulder);
        if (nr.tunnel) { if (d < 10) continue; }
        else if (d < 2.2) continue;
        else if (d < 6) roadside = true;
      }
      const fi = Math.round((px - W.MAP.x0) / W.MAP.cell), fj = Math.round((pz - W.MAP.z0) / W.MAP.cell);
      const kind = W.groundKind[fj * W.GRID_N + fi];
      if (kind === W.KIND.gravel || kind === W.KIND.field || kind === W.KIND.shoulder) continue;
      const h = W.terrainHeight(px, pz);
      if (W.waterLevelAt(px, pz) > h - 0.3) continue;
      if (roadside) { if (rnd() < 0.5) lists.bush.push([px, h, pz, 0.8 + rnd() * 0.8]); if (rnd() > dens * 0.5) continue; }
      if (rnd() > dens) { if (rnd() < 0.25) lists.bush.push([px, h, pz, 0.7 + rnd() * 0.7]); continue; }
      const cedarZone = W.fbm(px / 210 + 9, pz / 210, 2) > 0.05;
      const s = (cedarZone ? 0.95 : 0.8) + rnd() * 0.6;
      (cedarZone ? lists.cedar : lists.broad).push([px, h - 0.3, pz, s]);
      C.addCircle(px, pz, 0.32 * s, h - 1, h + 8, 'tree');
    }
    const chunk = { cx: cx + size / 2, cz: cz + size / 2, meshes: [] };
    for (const [name, list] of Object.entries(lists)) {
      if (!list.length) continue;
      const im = new THREE.InstancedMesh(G[name], mat, list.length);
      const col = new THREE.Color();
      list.forEach(([x, y, z, s], i) => {
        Q.setFromAxisAngle(Y, rnd() * 6.28);
        Sv.set(s, s * (0.85 + rnd() * 0.35), s);
        M.compose(P.set(x, y, z), Q, Sv);
        im.setMatrixAt(i, M);
        if (name === 'cedar') col.setHSL(0.30 + rnd() * 0.04, 0.32, 0.12 + rnd() * 0.05);
        else if (name === 'broad') col.setHSL(0.24 + rnd() * 0.07, 0.42, 0.17 + rnd() * 0.07);
        else col.setHSL(0.23 + rnd() * 0.06, 0.45, 0.17 + rnd() * 0.06);
        im.setColorAt(i, col);
      });
      im.computeBoundingSphere();
      scene.add(im);
      chunk.meshes.push(im);
    }
    out.treeChunks.push(chunk);
  }
}

// 遠くの物を隠す(霧で見えないので、描かない)
export function cullWorld(world, x, z, terrainDist = 430, treeDist = 300) {
  const t2 = terrainDist * terrainDist, r2 = treeDist * treeDist;
  for (const c of world.chunks) c.mesh.visible = (c.cx - x) ** 2 + (c.cz - z) ** 2 < t2;
  for (const c of world.treeChunks) {
    const v = (c.cx - x) ** 2 + (c.cz - z) ** 2 < r2;
    for (const m of c.meshes) m.visible = v;
  }
}
