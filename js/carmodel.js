// 車の見た目(assets/car/e80.glb)。タイヤを分け、色を塗り直し、ライトを光らせ、ぶつかるとへこむ
// 原点 = 物理の重心。前が -z
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { psx, lam, std } from './psx.js';

// モデルの座標(長さ x、前が -x、10倍の大きさ)→ 車の座標
const S = 0.1;
const OFF = new THREE.Vector3(0, -0.515, 0.176);

export async function loadCarModel(url, paintColor = '#a7aaa9') {
  const gltf = await new GLTFLoader().loadAsync(url);
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const toCar = new THREE.Matrix4().makeTranslation(OFF.x, OFF.y, OFF.z)
    .multiply(new THREE.Matrix4().makeRotationY(-Math.PI / 2))
    .multiply(new THREE.Matrix4().makeScale(S, S, S));

  // 部品ごとの三角形を集める
  const bins = { paint: [], trim: [], glass: [], head: [], rev: [], tail: [], turn: [], chrome: [] };
  const wheelParts = { FL: [], FR: [], RL: [], RR: [] };
  const pushTris = (bin, pos, idxList) => bin.push({ pos, idx: idxList });
  root.traverse(o => {
    if (!o.isMesh) return;
    const g = o.geometry.clone();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(toCar, o.matrixWorld));
    const pos = g.attributes.position.array;
    const index = g.index ? Array.from(g.index.array) : [...Array(pos.length / 3).keys()];
    const mat = o.material.name;
    const parentName = o.parent ? o.parent.name : '';
    const tri = (i) => [index[i], index[i + 1], index[i + 2]];
    const cen = (t) => {
      let x = 0, y = 0, z = 0;
      for (const v of t) { x += pos[v * 3]; y += pos[v * 3 + 1]; z += pos[v * 3 + 2]; }
      return [x / 3, y / 3, z / 3];
    };
    if (/tire/.test(parentName)) {
      for (let i = 0; i < index.length; i += 3) {
        const t = tri(i), [cx, , cz] = cen(t);
        const key = (cz < 0 ? 'F' : 'R') + (cx < 0 ? 'L' : 'R');
        (wheelParts[key][mat] ||= []).push(...t.map(v => [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]]));
      }
      return;
    }
    const out = { paint: [], trim: [], glass: [], head: [], rev: [], tail: [], turn: [], chrome: [] };
    for (let i = 0; i < index.length; i += 3) {
      const t = tri(i), [, cy, cz] = cen(t);
      let bin;
      if (mat === 'gray') bin = 'paint';
      else if (mat === 'black') bin = cy > 0.36 ? 'paint' : 'trim';   // 上は車体の色、下(バンパー・グリル)は黒
      else if (mat === 'glass') bin = 'glass';
      else if (mat === 'white') bin = cz < -1.6 ? 'head' : cz > 1.95 ? 'rev' : 'chrome'; // 横の帯はめっき
      else if (mat === 'material') bin = 'tail';
      else if (mat === 'orange') bin = 'turn';
      else bin = 'trim';
      out[bin].push(...t.map(v => [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]]));
    }
    for (const k in out) if (out[k].length) bins[k].push(out[k]);
  });
  const geoFrom = (lists) => {
    const flat = lists.flat();
    if (!flat.length) return null;
    const a = new Float32Array(flat.length * 3);
    flat.forEach((p, i) => a.set(p, i * 3));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(a, 3));
    g.computeVertexNormals();
    return g;
  };

  const group = new THREE.Group();
  const paint = std({ color: paintColor, roughness: 0.38, metalness: 0.45 });
  paint.userData.key = 'carpaint';
  const mats = {
    paint,
    trim: lam({ color: '#141515' }),
    glass: std({ color: '#0b0f11', roughness: 0.08, metalness: 0.4 }),
    chrome: std({ color: '#888b8c', roughness: 0.3, metalness: 0.8 }),
    head: new THREE.MeshLambertMaterial({ color: '#d8d8d0', emissive: '#000000' }),
    rev: new THREE.MeshLambertMaterial({ color: '#cfcfca', emissive: '#000000' }),
    tail: new THREE.MeshLambertMaterial({ color: '#6a1010', emissive: '#000000' }),
    turn: new THREE.MeshLambertMaterial({ color: '#a05a10', emissive: '#000000' }),
  };
  const meshes = {};
  for (const k in bins) {
    const g = geoFrom(bins[k]);
    if (!g) continue;
    const m = new THREE.Mesh(g, mats[k]);
    group.add(m);
    meshes[k] = m;
  }
  // へこみ用に元の位置を覚えておく
  meshes.paint.userData.orig = meshes.paint.geometry.attributes.position.array.slice();

  // タイヤ(回転の中心を真ん中に)
  const wheels = {};
  const tireMat = lam({ color: '#121212' }), rimMat = std({ color: '#9a9c9c', roughness: 0.4, metalness: 0.6 });
  for (const key of ['FL', 'FR', 'RL', 'RR']) {
    const parts = wheelParts[key];
    const all = Object.values(parts).flat();
    const box = new THREE.Box3();
    for (const p of all) box.expandByPoint(new THREE.Vector3(...p));
    const c = box.getCenter(new THREE.Vector3());
    const pivot = new THREE.Group();
    pivot.position.copy(c);
    const spin = new THREE.Group();
    pivot.add(spin);
    for (const [mname, pts] of Object.entries(parts)) {
      const g = geoFrom([pts]);
      g.translate(-c.x, -c.y, -c.z);
      spin.add(new THREE.Mesh(g, mname === 'gray' ? rimMat : tireMat));
    }
    group.add(pivot);
    wheels[key] = { pivot, spin, rest: c.clone() };
  }

  // ライトのレンズの位置(光らせる板の中心)
  const lensCenter = (k) => { const b = new THREE.Box3().setFromObject(meshes[k]); return b.getCenter(new THREE.Vector3()); };
  const info = { head: lensCenter('head'), tail: lensCenter('tail') };

  return { group, meshes, mats, wheels, info };
}

// 毎フレーム:タイヤの位置と回転、ライト
export function updateCarModel(m, car, lights) {
  const W = { FL: car.wheels[0], FR: car.wheels[1], RL: car.wheels[2], RR: car.wheels[3] };
  for (const k in W) {
    const w = W[k], v = m.wheels[k];
    // サスペンションの沈みに合わせて上下
    v.pivot.position.y = v.rest.y + (w.comp - 0.11);
    if (k[0] === 'F') {
      const s = car.steer;
      v.pivot.rotation.y = -s * (1 + 0.13 * (Math.sign(s) === (k[1] === 'L' ? -1 : 1) ? -1 : 1) * Math.min(1, Math.abs(s) * 3));
    }
    v.spin.rotation.x = -w.spin;
  }
  const M = m.mats;
  M.head.emissive.set(lights.head > 0 ? (lights.high ? '#fff6dc' : '#f2e6c8') : '#000000');
  M.head.emissiveIntensity = lights.head > 0 ? 1.4 : 0;
  M.tail.emissive.set('#ff1a0a');
  M.tail.emissiveIntensity = (lights.small ? 0.5 : 0) + (lights.brake ? 1.3 : 0);
  M.rev.emissive.set('#ffffff');
  M.rev.emissiveIntensity = lights.reverse ? 1.2 : 0;
  M.turn.emissive.set('#ff9a20');
  M.turn.emissiveIntensity = lights.small ? 0.25 : 0;
}

// ぶつかった所をへこませる(見た目だけ)
export function dent(m, lx, lz, strength) {
  const g = m.meshes.paint.geometry, p = g.attributes.position.array, o = m.meshes.paint.userData.orig;
  const R = 0.45 + Math.min(0.5, strength * 0.05);
  const amt = Math.min(0.09, strength * 0.012);
  for (let i = 0; i < p.length; i += 3) {
    const dx = p[i] - lx, dz = p[i + 2] - lz;
    const d = Math.hypot(dx, dz);
    if (d > R || p[i + 1] > 0.55) continue;
    const f = (1 - d / R) ** 2 * amt;
    // 車の中心へ押しこむ(元の位置から 0.16m まで)
    const cx = p[i], cz = p[i + 2];
    const l = Math.hypot(cx, cz * 0.45) || 1;
    p[i] -= cx / l * f; p[i + 2] -= cz * 0.45 / l * f;
    p[i + 1] -= f * 0.3;
    const ox = p[i] - o[i], oz = p[i + 2] - o[i + 2];
    const ol = Math.hypot(ox, oz);
    if (ol > 0.16) { p[i] = o[i] + ox / ol * 0.16; p[i + 2] = o[i + 2] + oz / ol * 0.16; }
  }
  g.attributes.position.needsUpdate = true;
  g.computeVertexNormals();
}
