// 集落と目印:家、酒屋、ガソリンスタンド、鳥居、自販機、バス停、点滅信号、温泉街、標識、落石
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as W from './world.js';
import * as T from './textures.js';
import * as C from './collide.js';
import { lam, psx, rng } from './psx.js';

const rnd = rng(77);

// 色を頂点に塗った形(まとめて1つの形にするため)
function painted(g, color) {
  g = g.index ? g.toNonIndexed() : g;
  const c = new THREE.Color(color), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g;
}
const place = (g, x, y, z, yaw = 0) => { g.rotateY(yaw); g.translate(x, y, z); return g; };

// 道のサンプル(道の id と、はじめからの距離 s)から、横に d(右が+)ずらした点
function along(roadId, s, d = 0) {
  const r = W.roadById[roadId], S = r.samples;
  if (s < 0) s += r.length;
  let i = Math.min(S.length - 1, Math.max(0, Math.round(s / 2)));
  while (i < S.length - 1 && S[i].s < s) i++;
  const o = S[i];
  return { x: o.x + o.rx * d, y: o.y, z: o.z + o.rz * d, yaw: Math.atan2(o.tx, o.tz), o };
}

export function buildProps(scene, out) {
  const solid = [];             // 頂点色でまとめる形
  const windows = [];           // 夜に灯る窓
  const signs = [];
  const add = (g, color) => solid.push(painted(g, color));
  const emit = (x, y, z, color, intensity, dist, extra = {}) => out.emitters.push({ x, y, z, color, intensity, dist, ...extra });

  // ---- 家(切妻屋根)。窓はまとめて別の形にする
  const WALLS = ['#c7bfae', '#b9b2a2', '#6b5640', '#8c8e88', '#d2ccbe'];
  const ROOFS = ['#3a4c62', '#6b3a2c', '#2f3133', '#3e5a44', '#5a5d61'];
  function house(x, z, yaw, w, d, h, opt = {}) {
    const y = opt.y ?? W.terrainHeight(x, z);
    const wall = opt.wall || WALLS[Math.floor(rnd() * WALLS.length)];
    const roof = opt.roof || ROOFS[Math.floor(rnd() * ROOFS.length)];
    add(place(new THREE.BoxGeometry(w, h + 1.2, d), x, y + (h + 1.2) / 2 - 1.2, z, yaw), wall);
    // 屋根:2枚の板と、三角の妻壁
    const rh = Math.min(w, d) * 0.32, over = 0.5;
    const half = d / 2 + over;
    const slope = Math.hypot(half, rh);
    for (const sd of [-1, 1]) {
      const g = new THREE.BoxGeometry(w + over * 2, 0.12, slope);
      g.rotateX(sd * Math.atan2(rh, half));
      g.translate(0, h + rh / 2, sd * half / 2);
      add(place(g, x, y, z, yaw), roof);
    }
    const tri = new THREE.Shape([new THREE.Vector2(-d / 2, 0), new THREE.Vector2(d / 2, 0), new THREE.Vector2(0, rh)]);
    for (const sd of [-1, 1]) {
      const g = new THREE.ShapeGeometry(tri);
      g.rotateY(Math.PI / 2 * sd);
      g.translate(sd * w / 2, h, 0);
      add(place(g, x, y, z, yaw), wall);
    }
    // 窓(長い面に)
    const nWin = Math.max(1, Math.floor(w / 3));
    for (const sd of [-1, 1]) for (let i = 0; i < nWin; i++) {
      const lit = rnd() < (opt.lit ?? 0.6);
      const g = new THREE.PlaneGeometry(1.1, 0.9);
      if (sd < 0) g.rotateY(Math.PI);
      g.translate(-w / 2 + (i + 0.5) * w / nWin, h * 0.55, sd * (d / 2 + 0.02));
      place(g, x, y, z, yaw);
      const n = g.attributes.position.count, col = new Float32Array(n * 3).fill(lit ? 1 : 0.06);
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      windows.push(g);
    }
    C.addBox(x, z, w, d, yaw, y - 1, y + h + rh, 'house');
  }

  // 家を道ぞいに並べる
  function houseRow(roadId, s0, s1, step, sides = [-1, 1], opt = {}) {
    const r = W.roadById[roadId], edge = r.kind.half + r.kind.shoulder;
    const placed = [];
    for (let s = s0; s < s1; s += step) for (const sd of sides) {
      if (rnd() < 0.25) continue;
      const w = 7 + rnd() * 4, d = 6 + rnd() * 3, h = 2.8 + (rnd() < 0.4 ? 2.8 : 0);
      const p = along(roadId, s + (rnd() - 0.5) * 6, sd * (edge + 4 + d / 2 + rnd() * 3));
      // ほかの道に重ならないように
      const nr = W.nearestRoad(p.x, p.z, 30);
      if (nr && nr.road.id !== roadId && Math.abs(nr.lateral) < nr.road.kind.half + Math.max(w, d) / 2 + 3) continue;
      if (placed.some(([x, z]) => Math.hypot(x - p.x, z - p.z) < 11)) continue;
      placed.push([p.x, p.z]);
      house(p.x, p.z, p.yaw + (sd > 0 ? Math.PI : 0) + Math.PI / 2, w, d, h, opt);
    }
  }

  // ---- 自販機(いつも明るい)
  const vendTex = T.vendingTexture();
  function vending(x, z, yaw, y) {
    y = y ?? W.terrainHeight(x, z);
    add(place(new THREE.BoxGeometry(1.0, 1.85, 0.75), x, y + 0.92, z, yaw), '#dfe2dc');
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 1.75), new THREE.MeshBasicMaterial({ map: vendTex }));
    face.position.set(x, y + 0.95, z); face.rotation.y = yaw; face.translateZ(0.38);
    signs.push(face);
    const fx = x + Math.sin(yaw) * 1.2, fz = z + Math.cos(yaw) * 1.2;
    emit(fx, y + 1.3, fz, 0xe8f2ff, 9, 12);
    C.addCircle(x, z, 0.65, y - 1, y + 2, 'vend');
  }

  // ---- カーブミラー
  function curveMirror(x, z, yaw) {
    const y = W.terrainHeight(x, z);
    add(place(new THREE.CylinderGeometry(0.05, 0.05, 3.2, 6), x, y + 1.6, z), '#d0682a');
    const rim = new THREE.CylinderGeometry(0.42, 0.42, 0.06, 12); rim.rotateX(Math.PI / 2); rim.translate(0, 0, 0.05);
    add(place(rim, x, y + 3.0, z, yaw), '#d0682a');
    const gl = new THREE.CircleGeometry(0.37, 12); gl.translate(0, 0, 0.09);
    add(place(gl, x, y + 3.0, z, yaw), '#8c979a');
    C.addCircle(x, z, 0.12, y - 1, y + 3, 'pole');
  }

  // ---- 街灯(白っぽい蛍光灯)
  function streetLamp(x, z, yaw, warm = false) {
    const y = W.terrainHeight(x, z);
    add(place(new THREE.CylinderGeometry(0.1, 0.13, 7, 6), x, y + 3.5, z), '#7a7b74');
    const arm = new THREE.BoxGeometry(0.08, 0.08, 1.4); arm.translate(0, 6.9, 0.6);
    add(place(arm, x, y, z, yaw), '#7a7b74');
    const head = new THREE.BoxGeometry(0.3, 0.12, 0.6); head.translate(0, 6.85, 1.3);
    const hm = new THREE.Mesh(place(head, x, y, z, yaw), new THREE.MeshBasicMaterial({ color: warm ? '#ffd59a' : '#e4f2ff' }));
    signs.push(hm);
    emit(x + Math.sin(yaw) * 1.3, y + 6.6, z + Math.cos(yaw) * 1.3, warm ? 0xffc27a : 0xd8ecff, 22, 22, { night: true });
    C.addCircle(x, z, 0.16, y - 1, y + 7, 'pole');
  }

  // ---- 文字の板(標識・看板)
  function board(x, y, z, yaw, w, h, texture, lit = false) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), lit ? new THREE.MeshBasicMaterial({ map: texture }) : psx(new THREE.MeshLambertMaterial({ map: texture, side: THREE.DoubleSide })));
    m.position.set(x, y, z); m.rotation.y = yaw;
    signs.push(m);
    return m;
  }
  function postSign(x, z, yaw, w, h, texture, height = 2.4) {
    const y = W.terrainHeight(x, z);
    add(place(new THREE.CylinderGeometry(0.05, 0.05, height + h / 2, 6), x, y + (height + h / 2) / 2, z), '#8b8d86');
    board(x, y + height, z, yaw, w, h, texture);
    C.addCircle(x, z, 0.1, y - 1, y + height, 'pole');
  }

  // =================================================== 出発の集落と酒屋
  {
    const st = W.nodePos('start');
    const p = along('r1', 18, -(3.9 + 6));
    const yaw = p.yaw + Math.PI / 2;
    // 酒屋:2階建て。1階は店
    house(p.x, p.z, yaw, 9, 7, 5.6, { wall: '#d6cfbe', roof: '#3a4c62', lit: 1 });
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const shopTex = T.signTexture(512, 128, '#efe9d8', [{ text: '酒', size: 96, y: 66, x: 90, color: '#a32a1e' }, { text: '岡田商店', size: 64, y: 68, x: 320, color: '#1d2433' }], '#2a3346');
    board(p.x + fx * 3.62, p.y + 3.4, p.z + fz * 3.62, yaw, 6, 1.5, shopTex, false);
    // 店先の明かり
    const shopLit = new THREE.Mesh(new THREE.PlaneGeometry(6, 2.2), new THREE.MeshBasicMaterial({ color: '#ffdca0' }));
    shopLit.position.set(p.x + fx * 3.53, p.y + 1.2, p.z + fz * 3.53); shopLit.rotation.y = yaw;
    out.nightLit = out.nightLit || []; out.nightLit.push(shopLit.material);
    signs.push(shopLit);
    emit(p.x + fx * 5, p.y + 2.2, p.z + fz * 5, 0xffd08a, 14, 14);
    // たばこの看板(つり下げ)
    const tb = T.signTexture(128, 256, '#c62a22', [{ text: 'たばこ', size: 50, y: 40, vertical: true, color: '#fff' }]);
    board(p.x + fx * 4.2 + Math.cos(yaw) * 3.5, p.y + 2.8, p.z + fz * 4.2 - Math.sin(yaw) * 3.5, yaw + Math.PI / 2, 0.5, 1.0, tb);
    vending(p.x + fx * 4.3 - Math.cos(yaw) * 4.0, p.z + fz * 4.3 + Math.sin(yaw) * 4.0, yaw, p.y);
    vending(p.x + fx * 4.3 - Math.cos(yaw) * 5.1, p.z + fz * 4.3 + Math.sin(yaw) * 5.1, yaw, p.y);
    houseRow('r1', 40, 220, 22);
    houseRow('r13', 20, 200, 20);
    for (let s = 30; s < 260; s += 55) { const q = along('r1', s, -5.5); streetLamp(q.x, q.z, q.yaw + Math.PI / 2); }
  }

  // =================================================== Y字の分かれ道
  {
    const p = along('r3', 22, -6);
    const t = T.signTexture(512, 256, '#1d4f9c', [
      { text: '↖ 峠・湯ノ沢', size: 54, y: 80, x: 250, color: '#fff' },
      { text: '→ 石油 (行き止まり)', size: 42, y: 180, x: 256, color: '#fff' },
    ], '#ffffff');
    const q = along('r1', -40, -4.6);
    postSign(q.x, q.z, q.yaw + Math.PI, 2.6, 1.3, t, 2.6);
    curveMirror(p.x, p.z, p.yaw + Math.PI / 2);
  }

  // =================================================== ガソリンスタンド
  {
    const g = W.nodePos('gas');
    const p = along('r2', -20, -(3.9 + 9));
    const yaw = p.yaw;
    const y = p.y;
    const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    // 屋根(キャノピー)
    add(place(new THREE.BoxGeometry(10, 0.6, 14), p.x, y + 4.8, p.z, yaw), '#e8e6df');
    add(place(new THREE.BoxGeometry(10.1, 0.25, 14.1), p.x, y + 4.4, p.z, yaw), '#b8312a');
    for (const [a, b] of [[-3.5, -5], [3.5, -5], [-3.5, 5], [3.5, 5]]) {
      add(place(new THREE.BoxGeometry(0.35, 4.6, 0.35), p.x + rx * a + fx * b, y + 2.3, p.z + rz * a + fz * b, yaw), '#d8d6cf');
      C.addCircle(p.x + rx * a + fx * b, p.z + rz * a + fz * b, 0.25, y - 1, y + 4, 'pole');
    }
    const under = new THREE.Mesh(new THREE.PlaneGeometry(8, 12), new THREE.MeshBasicMaterial({ color: '#eef6ff' }));
    under.rotation.x = Math.PI / 2; under.rotation.z = -yaw; under.position.set(p.x, y + 4.48, p.z);
    signs.push(under);
    emit(p.x, y + 4, p.z, 0xeaf4ff, 40, 24);
    // 計量機(2台)
    for (const b of [-2.5, 2.5]) {
      const x = p.x + fx * b, z = p.z + fz * b;
      add(place(new THREE.BoxGeometry(0.8, 0.3, 1.6), x, y + 0.15, z, yaw), '#9a9a94');
      add(place(new THREE.BoxGeometry(0.6, 1.6, 0.9), x, y + 1.1, z, yaw), '#e9e6de');
      add(place(new THREE.BoxGeometry(0.62, 0.3, 0.92), x, y + 1.8, z, yaw), '#b8312a');
      C.addCircle(x, z, 0.55, y - 1, y + 2, 'pump');
    }
    // 事務所
    const ox = p.x - rx * 9, oz = p.z - rz * 9;
    house(ox, oz, yaw, 6, 5, 3.0, { wall: '#e3e0d6', roof: '#5a5d61', lit: 1, y });
    // 看板
    const tex = T.signTexture(256, 384, '#f2f0ea', [
      { text: 'ヤマダ', size: 52, y: 80, color: '#b8312a' }, { text: '石油', size: 70, y: 160, color: '#b8312a' },
      { text: 'レギュラー', size: 34, y: 250, color: '#1d2433' }, { text: '98', size: 64, y: 315, color: '#1d2433', font: '"Barlow Condensed", sans-serif' },
    ], '#b8312a');
    const sx = p.x + rx * 6 - fx * 7, sz = p.z + rz * 6 - fz * 7;
    add(place(new THREE.BoxGeometry(0.3, 6, 0.3), sx, W.terrainHeight(sx, sz) + 3, sz), '#d8d6cf');
    board(sx, W.terrainHeight(sx, sz) + 5.2, sz, yaw + Math.PI / 2, 1.6, 2.4, tex, true);
    out.gasStation = { x: p.x, z: p.z, y, r: 7 };
    const dead = T.signTexture(256, 256, '#f2c21b', [{ text: 'この先', size: 50, y: 90, color: '#111' }, { text: '行き止まり', size: 46, y: 160, color: '#111' }], '#111');
    const q = along('r2b', 30, 3.2);
    postSign(q.x, q.z, q.yaw + Math.PI, 1.0, 1.0, dead, 1.6);
  }

  // =================================================== 赤い鳥居と自販機(本線はここで左)
  {
    const tn = W.nodePos('torii');
    const r4 = W.roadById.r4.samples, r5 = W.roadById.r5.samples;
    const dir4 = [r4[6].x - tn.x, r4[6].z - tn.z], dir5 = [r5[6].x - tn.x, r5[6].z - tn.z];
    const l4 = Math.hypot(...dir4), l5 = Math.hypot(...dir5);
    // r4(まっすぐ)と r5(左)のあいだの角
    let cx = dir4[0] / l4 + dir5[0] / l5, cz = dir4[1] / l4 + dir5[1] / l5;
    const cl = Math.hypot(cx, cz); cx /= cl; cz /= cl;
    const tx = tn.x + cx * 13, tz = tn.z + cz * 13;
    const ty = W.terrainHeight(tx, tz);
    const yaw = Math.atan2(-cx, -cz); // 分かれ道のほうを向く
    const grp = new THREE.Group();
    const red = '#b3301f', black = '#1a1a1a';
    const parts = [];
    for (const sx of [-1.4, 1.4]) {
      parts.push(painted(place(new THREE.CylinderGeometry(0.17, 0.19, 4.0, 8), sx, 2.0, 0), red));
      parts.push(painted(place(new THREE.CylinderGeometry(0.22, 0.22, 0.3, 8), sx, 0.15, 0), black));
    }
    parts.push(painted(place(new THREE.BoxGeometry(4.0, 0.24, 0.36), 0, 4.15, 0), black));
    parts.push(painted(place(new THREE.BoxGeometry(3.7, 0.18, 0.3), 0, 3.92, 0), red));
    parts.push(painted(place(new THREE.BoxGeometry(3.3, 0.18, 0.18), 0, 3.25, 0), red));
    parts.push(painted(place(new THREE.BoxGeometry(0.36, 0.55, 0.08), 0, 3.6, 0.1), black));
    const tm = new THREE.Mesh(mergeGeometries(parts), lam({ vertexColors: true }));
    tm.position.set(tx, ty, tz); tm.rotation.y = yaw;
    scene.add(tm);
    for (const sx of [-1.4, 1.4]) C.addCircle(tx + Math.cos(yaw) * sx, tz - Math.sin(yaw) * sx, 0.25, ty - 1, ty + 4, 'torii');
    // 石段(山の上へ)
    for (let k = 1; k < 14; k++) {
      const sx = tx - Math.sin(yaw) * k * 0.9, sz = tz - Math.cos(yaw) * k * 0.9;
      const sy = Math.max(ty + k * 0.32, W.terrainHeight(sx, sz) + 0.1);
      add(place(new THREE.BoxGeometry(2.4, 0.3, 0.9), sx, sy, sz, yaw), '#6c6d66');
    }
    // 自販機(角に1台)
    const vx = tn.x + cx * 9 + Math.cos(yaw) * 3.2, vz = tn.z + cz * 9 - Math.sin(yaw) * 3.2;
    vending(vx, vz, yaw, W.terrainHeight(vx, vz));
    // 神社の木の標柱
    const sh = T.signTexture(96, 384, '#cfc6ae', [{ text: '八幡神社', size: 64, y: 60, vertical: true, color: '#222' }]);
    const bx = tn.x + cx * 10 - Math.cos(yaw) * 3, bz = tn.z + cz * 10 + Math.sin(yaw) * 3;
    const by = W.terrainHeight(bx, bz);
    add(place(new THREE.BoxGeometry(0.3, 2.4, 0.3), bx, by + 1.2, bz, yaw), '#cfc6ae');
    board(bx + Math.sin(yaw) * 0.16, by + 1.35, bz + Math.cos(yaw) * 0.16, yaw, 0.28, 1.9, sh);
    // 鳥居の上の杉はそのまま。ミラー
    const m = along('r3', -14, 5.5);
    curveMirror(m.x, m.z, m.yaw + Math.PI);
    out.torii = { x: tx, z: tz };
  }

  // =================================================== 落石(ふさがっている回は旧道を回る)
  {
    const oa = W.roadById.r5;
    let sOld = 0;
    { const [ox, oz] = W.NODES.oldA; let best = 1e9; for (const o of oa.samples) { const d = Math.hypot(o.x - ox, o.z - oz); if (d < best) { best = d; sOld = o.s; } } }
    const p = along('r5', sOld + 70, 0);
    const grp = new THREE.Group();
    const rockGeo = new THREE.IcosahedronGeometry(1, 0);
    const rocks = [];
    for (let k = 0; k < 9; k++) {
      const d = (rnd() - 0.5) * 7, f = (rnd() - 0.5) * 6, s = 0.6 + rnd() * 1.1;
      const x = p.x + p.o.rx * d + p.o.tx * f, z = p.z + p.o.rz * d + p.o.tz * f;
      const g = rockGeo.clone(); g.scale(s, s * 0.8, s); g.rotateY(rnd() * 6); g.translate(x, p.y + s * 0.5, z);
      rocks.push(painted(g, '#5d5e58'));
      C.addCircle(x, z, s * 0.9, p.y - 1, p.y + s, 'block');
    }
    // 倒れた木
    const log = new THREE.CylinderGeometry(0.3, 0.35, 11, 6); log.rotateZ(Math.PI / 2); log.rotateY(p.yaw + 0.3); log.translate(p.x + p.o.tx * 3, p.y + 0.4, p.z + p.o.tz * 3);
    rocks.push(painted(log, '#3b2e22'));
    // 通行止めの柵(手前に)
    const bx = p.x - p.o.tx * 8, bz = p.z - p.o.tz * 8;
    const bar = new THREE.BoxGeometry(5.5, 0.3, 0.08); bar.rotateY(p.yaw); bar.translate(bx, p.y + 0.9, bz);
    rocks.push(painted(bar, '#e8c21c'));
    for (const sd of [-2.6, 2.6]) { const leg = new THREE.BoxGeometry(0.08, 1.0, 0.08); leg.translate(bx + p.o.rx * sd, p.y + 0.5, bz + p.o.rz * sd); rocks.push(painted(leg, '#222')); }
    C.addSeg(bx - p.o.rx * 2.8, bz - p.o.rz * 2.8, bx + p.o.rx * 2.8, bz + p.o.rz * 2.8, p.y - 1, p.y + 1.2, 'block');
    const bm = new THREE.Mesh(mergeGeometries(rocks), lam({ vertexColors: true, flatShading: true }));
    scene.add(bm);
    const sign = board(bx, p.y + 1.45, bz, p.yaw + Math.PI, 1.2, 0.5, T.signTexture(256, 110, '#ffffff', [{ text: '通行止', size: 64, y: 58, color: '#c62a22' }], '#c62a22'));
    out.block = {
      mesh: bm, sign, active: true,
      set(on) {
        this.active = on; bm.visible = on; sign.visible = on;
        if (!on) C.removeTag('block');
      },
    };
  }

  // =================================================== バス停と点滅信号(十字路)
  {
    const p = along('r7', -40, -(3.9 + 1.6));
    const yaw = p.yaw + Math.PI / 2;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    // 待合所
    const y = p.y;
    add(place(new THREE.BoxGeometry(3.2, 0.12, 1.8), p.x - fx * 0.6, y + 2.3, p.z - fz * 0.6, yaw), '#5c5f63');
    add(place(new THREE.BoxGeometry(3.2, 2.3, 0.1), p.x - fx * 1.45, y + 1.15, p.z - fz * 1.45, yaw), '#9aa09a');
    for (const sd of [-1.55, 1.55]) add(place(new THREE.BoxGeometry(0.1, 2.3, 1.8), p.x - fx * 0.6 + Math.cos(yaw) * sd, y + 1.15, p.z - fz * 0.6 - Math.sin(yaw) * sd, yaw), '#9aa09a');
    add(place(new THREE.BoxGeometry(2.6, 0.08, 0.4), p.x - fx * 1.15, y + 0.45, p.z - fz * 1.15, yaw), '#6b5640');
    C.addBox(p.x - fx * 0.6, p.z - fz * 0.6, 3.2, 1.8, yaw, y - 1, y + 2.3, 'house');
    // バス停の標識(丸い板)
    const bs = T.signTexture(256, 256, '#f3f1ea', [{ text: '峠下', size: 72, y: 110, color: '#1d2433' }, { text: 'とうげした', size: 30, y: 180, color: '#1d2433' }], '#c62a22');
    const sx = p.x + Math.cos(yaw) * 2.6, sz = p.z - Math.sin(yaw) * 2.6;
    add(place(new THREE.CylinderGeometry(0.05, 0.05, 2.2, 6), sx, y + 1.1, sz), '#9a9c96');
    add(place(new THREE.CylinderGeometry(0.3, 0.35, 0.2, 8), sx, y + 0.1, sz), '#9a9c96');
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.42, 16), psx(new THREE.MeshLambertMaterial({ map: bs, side: THREE.DoubleSide })));
    disc.position.set(sx, y + 2.4, sz); disc.rotation.y = yaw + Math.PI / 2; signs.push(disc);
    C.addCircle(sx, sz, 0.3, y - 1, y + 2, 'pole');
    vending(p.x + Math.cos(yaw) * 3.6 - fx * 0.8, p.z - Math.sin(yaw) * 3.6 - fz * 0.8, yaw, y);
    streetLamp(p.x - Math.cos(yaw) * 4, p.z + Math.sin(yaw) * 4, yaw + Math.PI);

    // 点滅信号(十字路の上)
    const c = W.nodePos('cross');
    const r7 = W.roadById.r7.samples, last = r7[r7.length - 1];
    const px = c.x - last.rx * 6 - last.tx * 4, pz = c.z - last.rz * 6 - last.tz * 4;
    const py = W.terrainHeight(px, pz);
    add(place(new THREE.CylinderGeometry(0.12, 0.15, 6, 6), px, py + 3, pz), '#7a7b74');
    const armYaw = Math.atan2(last.rx, last.rz);
    const arm = new THREE.BoxGeometry(0.1, 0.1, 6); arm.translate(0, 5.8, 3);
    add(place(arm, px, py, pz, armYaw), '#7a7b74');
    const hx = px + last.rx * 6, hz = pz + last.rz * 6;
    add(place(new THREE.BoxGeometry(0.45, 0.45, 0.45), hx, py + 5.6, hz), '#2a2b28');
    const lampMat = new THREE.MeshBasicMaterial({ color: '#ffb000' });
    for (const yy of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const l = new THREE.Mesh(new THREE.CircleGeometry(0.14, 10), lampMat);
      l.position.set(hx, py + 5.6, hz); l.rotation.y = yy; l.translateZ(0.235); signs.push(l);
    }
    C.addCircle(px, pz, 0.2, py - 1, py + 6, 'pole');
    const e = { x: hx, y: py + 5.3, z: hz, color: 0xffa800, intensity: 16, dist: 18 };
    out.emitters.push(e);
    out.animated.push(t => { const on = (t % 1.2) < 0.6; lampMat.color.set(on ? '#ffb000' : '#3a2a08'); e.intensity = on ? 16 : 0; });
    // 案内の標識
    const t = T.signTexture(512, 192, '#1d4f9c', [{ text: '湯ノ沢温泉 →', size: 62, y: 96, color: '#fff' }], '#fff');
    const q = along('r7', -22, -5.0);
    postSign(q.x, q.z, q.yaw + Math.PI, 2.4, 0.9, t, 2.4);
  }

  // =================================================== 湯ノ沢(目的地)
  {
    const o = W.nodePos('onsen');
    houseRow('r9', 330, 490, 16, [-1, 1], { lit: 0.85 });
    houseRow('r12', 10, 250, 15, [-1, 1], { lit: 0.85 });
    // 赤いちょうちん
    const lanternMat = new THREE.MeshBasicMaterial({ color: '#ff5a2a' });
    for (let s = 20; s < 240; s += 14) for (const sd of [-1, 1]) {
      const q = along('r12', s, sd * 3.0);
      const y = q.y;
      add(place(new THREE.CylinderGeometry(0.04, 0.04, 2.6, 5), q.x, y + 1.3, q.z), '#3b2e22');
      const l = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.5, 8), lanternMat);
      l.position.set(q.x, y + 2.4, q.z); signs.push(l);
      if (sd > 0 && s % 28 === 20) emit(q.x, y + 2.4, q.z, 0xff6a30, 6, 9);
    }
    // 入口の看板
    const p = along('r9', -40, 5.2);
    const t = T.signTexture(128, 512, '#4a3624', [{ text: '湯ノ沢温泉', size: 92, y: 70, vertical: true, color: '#efe6cf' }], '#2a1d12');
    const y = W.terrainHeight(p.x, p.z);
    add(place(new THREE.BoxGeometry(0.4, 3.6, 0.4), p.x, y + 1.8, p.z, p.yaw), '#4a3624');
    board(p.x - Math.sin(p.yaw) * 0.21, y + 2.0, p.z - Math.cos(p.yaw) * 0.21, p.yaw + Math.PI, 0.6, 2.4, t);
    C.addCircle(p.x, p.z, 0.3, y - 1, y + 3, 'pole');
    for (let s = 300; s < 500; s += 45) { const q = along('r9', s, -5.4); streetLamp(q.x, q.z, q.yaw + Math.PI / 2, true); }
    // 湯けむり
    const steamN = 70;
    const sp = new Float32Array(steamN * 3), base = [];
    for (let i = 0; i < steamN; i++) {
      const q = along('r12', 60 + (i % 4) * 50, (i % 2 ? 1 : -1) * 12);
      base.push([q.x + (rnd() - 0.5) * 4, q.y + 3, q.z + (rnd() - 0.5) * 4, rnd()]);
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    const steam = new THREE.Points(sg, new THREE.PointsMaterial({ color: '#c9ccc8', size: 3.5, transparent: true, opacity: 0.22, depthWrite: false }));
    scene.add(steam);
    out.animated.push(t => {
      for (let i = 0; i < steamN; i++) {
        const [x, y0, z, ph] = base[i];
        const k = (t * 0.12 + ph) % 1;
        sp[i * 3] = x + Math.sin(t * 0.5 + i) * 0.8 * k; sp[i * 3 + 1] = y0 + k * 9; sp[i * 3 + 2] = z + k * 1.5;
      }
      sg.attributes.position.needsUpdate = true;
    });
    out.goal = { x: o.x, z: o.z, r: 34 };
  }

  // =================================================== そのほかのミラーと標識
  {
    for (const [roadId, s, d] of [['r8', 12, 4], ['r7', 140, -6], ['r10', 14, 4.5], ['r11', 14, -4.5]]) {
      const q = along(roadId, s, d);
      curveMirror(q.x, q.z, q.yaw + Math.PI);
    }
    const old = T.signTexture(256, 160, '#f2c21b', [{ text: '旧道', size: 56, y: 60, color: '#111' }, { text: '大型車通行不可', size: 30, y: 122, color: '#111' }], '#111');
    const q = along('r8', 16, -3);
    postSign(q.x, q.z, q.yaw + Math.PI, 1.1, 0.7, old, 1.6);
    const dam = T.signTexture(256, 160, '#f2c21b', [{ text: 'この先', size: 46, y: 56, color: '#111' }, { text: '行き止まり', size: 42, y: 118, color: '#111' }], '#111');
    for (const id of ['r4', 'r10', 'r11']) { const z = along(id, 40, 3.0); postSign(z.x, z.z, z.yaw + Math.PI, 1.0, 0.62, dam, 1.6); }
  }

  // ---- まとめて追加
  const solidMesh = new THREE.Mesh(mergeGeometries(solid), lam({ vertexColors: true }));
  scene.add(solidMesh);
  const winMat = psx(new THREE.MeshBasicMaterial({ map: T.windowTexture(), vertexColors: true, color: '#2a2c2e' }));
  out.windowMat = winMat;
  if (windows.length) scene.add(new THREE.Mesh(mergeGeometries(windows), winMat));
  for (const s of signs) scene.add(s);
}
