// 運転席(右ハンドル)。原点 = 運転席の目の真下、前が -z
// メーター・ハンドル・ワイパー・コマ図・シフトレバー・室内灯
import * as THREE from 'three';
import * as T from './textures.js';

export const EYE_Y = 1.13;
export const CX = -0.37;   // 車の中心(目から左へ 0.37m)
// フロントガラス(下の辺と上の辺)
export const WS = { f0: 1.03, y0: 0.955, f1: 0.42, y1: 1.32, w0: 0.70, w1: 0.62 };
export const GLASS = (() => {
  const H = Math.hypot(WS.y1 - WS.y0, WS.f0 - WS.f1);
  return { W: WS.w0 * 2, H };
})();

const lamb = (o) => new THREE.MeshLambertMaterial(o);

// ミラーに映る後ろの景色(暗い道と、少し明るい空)
function mirrorTexture(door) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 32;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 32);
  gr.addColorStop(0, '#6d7676'); gr.addColorStop(0.45, '#4b5352'); gr.addColorStop(0.55, '#1e2322'); gr.addColorStop(1, '#141716');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 32);
  g.fillStyle = '#0b0c0c';
  if (door) { g.fillRect(0, 0, 34, 32); }
  else { g.fillRect(0, 0, 128, 4); g.fillRect(0, 28, 128, 4); g.fillRect(0, 0, 10, 32); g.fillRect(118, 0, 10, 32); g.fillRect(60, 0, 8, 10); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildCockpit(paintColor) {
  const scene = new THREE.Scene();
  const car = new THREE.Group();
  scene.add(car);
  const out = { scene, car };

  const dashM = lamb({ color: '#202221' });
  const dashM2 = lamb({ color: '#2a2c2b' });
  const blackM = lamb({ color: '#0e0f0e' });
  const roofM = lamb({ color: '#5b5a55' });
  const pillarM = lamb({ color: '#3a3a37' });
  const paint = new THREE.MeshStandardMaterial({ color: paintColor, roughness: 0.35, metalness: 0.4 });
  out.paint = paint;

  function prism(profile, x0, x1, mat) {
    const sh = new THREE.Shape(profile.map(([f, y]) => new THREE.Vector2(f, y)));
    const g = new THREE.ExtrudeGeometry(sh, { depth: x1 - x0, bevelEnabled: false, curveSegments: 2 });
    g.rotateY(Math.PI / 2); g.translate(x0, 0, 0);
    const m = new THREE.Mesh(g, mat); car.add(m); return m;
  }
  const box = (w, h, d, mat, x, y, z, rx = 0, ry = 0, rz = 0, parent = car) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z); m.rotation.set(rx, ry, rz); parent.add(m); return m;
  };

  // ---- ボンネット
  {
    const pos = [];
    const q = [[-0.74, 0.955, -1.02], [0.74, 0.955, -1.02], [0.70, 0.86, -2.0], [-0.70, 0.86, -2.0]];
    const mid = [[0, 0.975, -1.02], [0, 0.885, -2.0]];
    const v = (p) => [p[0] + CX, p[1], p[2]];
    pos.push(...v(q[0]), ...v(mid[0]), ...v(mid[1]), ...v(q[0]), ...v(mid[1]), ...v(q[3]));
    pos.push(...v(mid[0]), ...v(q[1]), ...v(q[2]), ...v(mid[0]), ...v(q[2]), ...v(mid[1]));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, paint); m.material.side = THREE.DoubleSide; car.add(m);
    out.hood = m;
  }

  // ---- ダッシュボード
  const dashProfile = [[0.60, 0.50], [0.66, 0.74], [0.74, 0.90], [0.80, 0.935], [1.02, 0.95], [1.12, 0.84], [1.12, 0.50]];
  prism(dashProfile, CX - 0.72, -0.25, dashM);
  prism(dashProfile, 0.25, 0.36, dashM);
  prism([[0.58, 0.50], [0.64, 0.70], [0.74, 0.775], [0.86, 0.79], [1.02, 0.79], [1.12, 0.50]], -0.25, 0.25, dashM2);
  prism([[0.86, 0.79], [0.88, 0.95], [1.02, 0.955], [1.02, 0.79]], -0.25, 0.25, blackM);
  prism([[0.70, 0.975], [0.73, 0.995], [0.90, 0.99], [0.92, 0.955], [0.74, 0.958]], -0.255, 0.255, dashM);
  for (const sx of [-0.255, 0.235]) prism([[0.71, 0.78], [0.71, 0.98], [0.90, 0.99], [0.90, 0.78]], sx, sx + 0.02, dashM);

  // ---- メーター
  {
    const w = 0.46, h = w * T.GAUGE.H / T.GAUGE.W;
    const f = 0.85, y = 0.872;
    const grp = new THREE.Group();
    grp.position.set(0, y, -f);
    grp.rotation.x = Math.atan2(EYE_Y - y, f) * 0.85;
    car.add(grp);
    const faceCanvas = document.createElement('canvas');
    const faceTex = new THREE.CanvasTexture(faceCanvas);
    faceTex.colorSpace = THREE.SRGBColorSpace;
    faceTex.anisotropy = 4;
    const faceMat = new THREE.MeshBasicMaterial({ map: faceTex });
    grp.add(new THREE.Mesh(new THREE.PlaneGeometry(w, h), faceMat));
    const px = w / T.GAUGE.W;
    const toLocal = (cx, cy) => new THREE.Vector3((cx - T.GAUGE.W / 2) * px, (T.GAUGE.H / 2 - cy) * px, 0);
    // 針
    const needleMat = new THREE.MeshBasicMaterial({ color: '#ff6a1c' });
    const mkNeedle = (G, lenPx, tail = 0.18) => {
      const piv = new THREE.Group();
      piv.position.copy(toLocal(G.cx, G.cy)); piv.position.z = 0.004;
      const L = lenPx * px, T2 = L * tail;
      const shape = new THREE.Shape([new THREE.Vector2(-T2, -0.0016), new THREE.Vector2(L, -0.0006), new THREE.Vector2(L, 0.0006), new THREE.Vector2(-T2, 0.0016)]);
      piv.add(new THREE.Mesh(new THREE.ShapeGeometry(shape), needleMat));
      const cap = new THREE.Mesh(new THREE.CircleGeometry(lenPx * 0.11 * px, 12), new THREE.MeshBasicMaterial({ color: '#0b0b0b' }));
      cap.position.z = 0.001; piv.add(cap);
      grp.add(piv);
      return { piv, G };
    };
    out.needles = {
      tach: mkNeedle(T.GAUGE.tach, 176), speed: mkNeedle(T.GAUGE.speed, 176),
      temp: mkNeedle(T.GAUGE.temp, 84, 0.1), fuel: mkNeedle(T.GAUGE.fuel, 84, 0.1),
    };
    // オドメーター・トリップのドラム
    const D = T.GAUGE.drums;
    const drumCanvas = document.createElement('canvas');
    const drumTex = new THREE.CanvasTexture(drumCanvas); drumTex.colorSpace = THREE.SRGBColorSpace;
    const drumMat = new THREE.MeshBasicMaterial({ map: drumTex });
    const dm = new THREE.Mesh(new THREE.PlaneGeometry(D.w * px, D.h * px), drumMat);
    dm.position.copy(toLocal(D.x + D.w / 2, D.y + D.h / 2)); dm.position.z = 0.002;
    grp.add(dm);
    // メーターのカバー(ガラスの映り込み)
    out.cluster = { grp, faceCanvas, faceTex, faceMat, drumCanvas, drumTex, drumMat, needleMat, lastKey: '', lastDrum: '' };
  }

  // ---- センター:吹き出し口とラジオ(時計)
  {
    const x = CX;
    box(0.26, 0.24, 0.05, dashM2, x, 0.69, -0.655, -0.35);
    for (let i = 0; i < 4; i++) for (const dx of [-0.065, 0.065]) box(0.1, 0.008, 0.02, blackM, x + dx, 0.78 - i * 0.02, -0.64 + i * 0.007, -0.35);
    const c = document.createElement('canvas'); c.width = 256; c.height = 64;
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const r = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.0375), new THREE.MeshBasicMaterial({ map: t }));
    r.position.set(x, 0.635, -0.628); r.rotation.x = -0.35; car.add(r);
    for (const dx of [-0.1, 0.1]) {
      const k = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.02, 8), blackM);
      k.rotation.x = Math.PI / 2 - 0.35; k.position.set(x + dx, 0.635, -0.62); car.add(k);
    }
    out.radio = { canvas: c, tex: t, last: '' };
    // 曇り止めのボタン(押すと橙に光る)
    const db = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.015), new THREE.MeshBasicMaterial({ color: '#2a2a28' }));
    db.position.set(x + 0.07, 0.585, -0.611); db.rotation.x = -0.35; car.add(db);
    out.defrostLamp = db.material;
  }

  // ---- シフトレバー(AT:センターコンソール)
  {
    const base = box(0.16, 0.06, 0.32, dashM2, CX + 0.02, 0.5, -0.3);
    const lever = new THREE.Group();
    lever.position.set(CX + 0.02, 0.53, -0.36);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.14, 6), blackM);
    rod.position.y = 0.07; lever.add(rod);
    const knob = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.06), lamb({ color: '#1a1b1a' }));
    knob.position.y = 0.15; lever.add(knob);
    car.add(lever);
    out.lever = lever;
  }

  // ---- ハンドル(4本スポーク)
  {
    const wheel = new THREE.Group();
    const inner = new THREE.Group();
    wheel.add(inner);
    const rimM = lamb({ color: '#141514' });
    inner.add(new THREE.Mesh(new THREE.TorusGeometry(0.185, 0.016, 6, 22), rimM));
    for (const a of [0.42, Math.PI - 0.42, Math.PI + 0.95, -0.95]) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.032, 0.014), rimM);
      s.position.set(Math.cos(a) * 0.1, Math.sin(a) * 0.1, 0.004); s.rotation.z = a; inner.add(s);
    }
    box(0.17, 0.105, 0.04, lamb({ color: '#1b1c1b' }), 0, -0.012, 0.022, 0, 0, 0, inner);
    box(0.15, 0.085, 0.01, lamb({ color: '#232423' }), 0, -0.012, 0.045, 0, 0, 0, inner);
    wheel.position.set(0, 0.695, -0.55);
    wheel.rotation.x = -0.5;
    car.add(wheel);
    out.wheel = inner;
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.055, 0.3, 8), dashM);
    col.position.set(0, 0.63, -0.67); col.rotation.x = Math.PI / 2 - 1.1; car.add(col);
    box(0.13, 0.014, 0.014, blackM, 0.13, 0.69, -0.64, 0, 0, -0.15);
    box(0.13, 0.014, 0.014, blackM, -0.13, 0.69, -0.64, 0, 0, 0.15);
  }

  // ---- フロントガラスの枠:Aピラー、屋根、ミラー、サンバイザー、ドア
  {
    const pillar = (sx) => {
      const a = new THREE.Vector3(CX + sx * WS.w0, WS.y0, -WS.f0), b = new THREE.Vector3(CX + sx * WS.w1, WS.y1, -WS.f1);
      const len = a.distanceTo(b);
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.075, len, 0.06), pillarM);
      m.position.copy(a).lerp(b, 0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      m.rotateY(sx * 0.5);
      car.add(m);
      const e = new THREE.Mesh(new THREE.BoxGeometry(0.02, len, 0.02), blackM);
      e.position.copy(m.position).add(new THREE.Vector3(-sx * 0.045, 0, 0));
      e.quaternion.copy(m.quaternion); car.add(e);
    };
    pillar(-1); pillar(1);
    prism([[0.0, 1.36], [0.0, 1.33], [WS.f1 - 0.02, 1.30], [WS.f1 + 0.02, 1.33], [WS.f1, 1.36]], CX - 0.7, CX + 0.7, roofM);
    box(0.022, 0.05, 0.02, blackM, CX, 1.295, -0.64);
    {
      const mg = new THREE.Group();
      mg.add(new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.065, 0.03), lamb({ color: '#1c1d1c' })));
      const face = new THREE.Mesh(new THREE.PlaneGeometry(0.235, 0.052), new THREE.MeshBasicMaterial({ map: mirrorTexture(false) }));
      face.position.z = 0.016; mg.add(face);
      mg.position.set(CX + 0.02, 1.255, -0.63); mg.rotation.set(0.1, 0.32, 0); car.add(mg);
      out.mirrorFace = face.material;
    }
    box(0.36, 0.028, 0.17, lamb({ color: '#6b675e' }), 0.0, 1.30, -0.36, 0.12);
    box(0.36, 0.028, 0.17, lamb({ color: '#6b675e' }), CX - 0.44, 1.30, -0.36, 0.12);
    prism([[0.0, 0.5], [0.0, 0.98], [0.9, 0.98], [1.0, 0.5]], 0.36, 0.42, pillarM);
    prism([[0.0, 0.5], [0.0, 0.98], [0.9, 0.98], [1.0, 0.5]], CX - 0.78, CX - 0.72, pillarM);
    // 右のドアミラー
    const mir = new THREE.Group();
    const hous = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.115, 0.07), lamb({ color: '#202221' }));
    hous.position.z = -0.03; mir.add(hous);
    const face2 = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.097), new THREE.MeshBasicMaterial({ map: mirrorTexture(true) }));
    face2.position.z = 0.006; mir.add(face2);
    mir.position.set(0.5, 0.99, -0.95);
    car.add(mir);
    mir.lookAt(new THREE.Vector3(0, EYE_Y, 0.2));
    out.doorMirror = face2.material;
    // 室内灯(屋根のまん中)
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.012, 0.08), new THREE.MeshBasicMaterial({ color: '#3a3a36' }));
    lamp.position.set(CX, 1.355, -0.05); car.add(lamp);
    out.roomLampMat = lamp.material;
  }

  // ---- フロントガラス(水滴の位置を決めるための面。uv = ガラスの上の位置)
  {
    const A = [CX - WS.w0, WS.y0, -WS.f0], B = [CX + WS.w0, WS.y0, -WS.f0], Cc = [CX + WS.w1, WS.y1, -WS.f1], D = [CX - WS.w1, WS.y1, -WS.f1];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([...A, ...B, ...Cc, ...A, ...Cc, ...D], 3));
    const u = (x) => (x - CX) / (WS.w0 * 2) + 0.5;
    g.setAttribute('uv', new THREE.Float32BufferAttribute([u(A[0]), 0, u(B[0]), 0, u(Cc[0]), 1, u(A[0]), 0, u(Cc[0]), 1, u(D[0]), 1], 2));
    out.glassGeo = g;
  }

  // ---- ワイパー(角度 0 = 左向きで止まっている、+ で上へ)
  {
    const wm = lamb({ color: '#0a0a0a' });
    const glassUp = new THREE.Vector3(0, WS.y1 - WS.y0, -(WS.f1 - WS.f0)).normalize();
    const along = new THREE.Vector3(-1, 0, 0);
    const n = new THREE.Vector3().crossVectors(along, glassUp).normalize(); // ガラスの面の向き(車内側)
    const mk = (px, len) => {
      const piv = new THREE.Group();
      piv.position.set(px, WS.y0 + 0.022, -WS.f0 - 0.02);
      // ガラスの面にそって回る:ローカルの x を左、y をガラスの上向き、z をガラスの外向きにする
      const m = new THREE.Matrix4().makeBasis(along, glassUp, n);
      piv.quaternion.setFromRotationMatrix(m);
      const rot = new THREE.Group(); piv.add(rot);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(len, 0.012, 0.012), wm); arm.position.x = len / 2; rot.add(arm);
      const blade = new THREE.Mesh(new THREE.BoxGeometry(len * 0.82, 0.016, 0.016), wm); blade.position.set(len * 0.6, -0.012, 0.006); rot.add(blade);
      car.add(piv);
      // ガラスの上の座標(s = 左右 m、t = 下からガラスにそって m)
      return { rot, len, s: px - CX, t: 0.012 };
    };
    out.wipers = [mk(CX + 0.36, 0.55), mk(CX - 0.16, 0.47)];
  }

  // ---- コマ図
  {
    const grp = new THREE.Group();
    grp.add(new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.006, 0.235), lamb({ color: '#5b4632' })));
    const paperMat = new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#000000' });
    const paper = new THREE.Mesh(new THREE.PlaneGeometry(0.155, 0.222), paperMat);
    paper.rotation.x = -Math.PI / 2; paper.position.set(0, 0.0045, 0.004);
    grp.add(paper);
    const clip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.014, 0.03), lamb({ color: '#a3a5a0' }));
    clip.position.set(0, 0.009, -0.105); grp.add(clip);
    grp.rotation.order = 'YXZ';
    grp.rotation.set(0.62, 0.22, 0);
    grp.position.set(-0.36, 0.975, -0.80);
    car.add(grp);
    out.komazu = grp; out.paperMat = paperMat;
  }

  // ---- 光
  out.ambient = new THREE.HemisphereLight('#8a9597', '#1a1d1a', 1.2);
  scene.add(out.ambient);
  // フロントガラスから入る空の光
  out.skyLight = new THREE.DirectionalLight('#9aa6a8', 0.6);
  out.skyLight.position.set(-0.4, 3, -2);
  scene.add(out.skyLight);
  out.roomLight = new THREE.PointLight('#ffe2b0', 0, 2.2, 1.6);
  out.roomLight.position.set(CX, 1.3, -0.1);
  car.add(out.roomLight);
  out.clusterGlow = new THREE.PointLight('#ffa040', 0, 0.6, 2);
  out.clusterGlow.position.set(0, 0.9, -0.72);
  car.add(out.clusterGlow);
  return out;
}

// 計器の文字盤を必要なときだけ描き直す
export function updateCockpit(ck, s) {
  const c = ck.cluster;
  const key = JSON.stringify([s.lit, s.mt, s.shift, s.odOff, s.blinkL, s.blinkR, s.highBeam, s.brakeLamp, s.oilLamp, s.battLamp, s.fuelLamp, s.engineLamp]);
  if (key !== c.lastKey) {
    T.drawClusterFace(c.faceCanvas, s);
    c.faceTex.needsUpdate = true;
    c.lastKey = key;
  }
  // 照明:ライトをつけると橙、消えているときは外の明るさで白っぽく見える
  const day = s.daylight;
  if (s.lit) { c.faceMat.color.setRGB(1.0, 0.62, 0.26); c.drumMat.color.setRGB(1.0, 0.7, 0.4); }
  else { const k = 0.18 + day * 0.55; c.faceMat.color.setRGB(k, k, k * 0.97); c.drumMat.color.setRGB(k, k, k); }
  c.needleMat.color.set(s.lit ? '#ff6a1c' : '#c4531c');
  const ang = (G, v) => {
    const a = G.a0 + (G.a1 - G.a0) * Math.max(0, Math.min(1.04, v / G.max));
    return -a; // canvas は y が下向きなので、3D では向きが逆
  };
  ck.needles.tach.piv.rotation.z = ang(T.GAUGE.tach, s.rpm / 1000);
  ck.needles.speed.piv.rotation.z = ang(T.GAUGE.speed, s.kmh);
  ck.needles.temp.piv.rotation.z = ang(T.GAUGE.temp, s.temp);
  ck.needles.fuel.piv.rotation.z = ang(T.GAUGE.fuel, s.fuel);
  const dk = (s.odoKm).toFixed(2) + '|' + (s.tripKm).toFixed(3);
  if (dk !== c.lastDrum) { T.drawDrums(c.drumCanvas, s.odoKm, s.tripKm); c.drumTex.needsUpdate = true; c.lastDrum = dk; }
  // ラジオの時計
  const hh = Math.floor(s.clock), mm = Math.floor((s.clock - hh) * 60);
  const txt = (s.power ? 'AM 1242' : '') + '|' + hh + ':' + String(mm).padStart(2, '0') + '|' + s.lit;
  if (txt !== ck.radio.last) {
    const g = ck.radio.canvas.getContext('2d');
    g.fillStyle = '#0a0b0a'; g.fillRect(0, 0, 256, 64);
    const col = s.power ? '#86ffb8' : '#1b2a20';
    g.fillStyle = col; g.shadowColor = col; g.shadowBlur = s.power ? 8 : 0;
    g.font = 'bold 30px "DejaVu Sans Mono", monospace'; g.fillText(s.power ? 'AM 1242' : '', 46, 44);
    g.font = 'bold 18px "DejaVu Sans Mono", monospace';
    g.fillText(String(hh).padStart(2, ' ') + ':' + String(mm).padStart(2, '0'), 182, 24);
    ck.radio.tex.needsUpdate = true; ck.radio.last = txt;
  }
}
