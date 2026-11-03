// 雨:カメラのまわりに降る細い線。前照灯の中では明るく見える。地面のはね返りと、タイヤのしぶき
import * as THREE from 'three';
import { groundAt } from './world.js';

export function createRain(scene) {
  const N = 14000;
  const B = new THREE.Vector3(26, 16, 26);
  const base = new Float32Array(N * 2 * 3), end = new Float32Array(N * 2), rnd = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) {
    const x = (Math.random() * 2 - 1) * B.x, y = (Math.random() * 2 - 1) * B.y, z = (Math.random() * 2 - 1) * B.z, r = Math.random();
    for (let k = 0; k < 2; k++) {
      base.set([x, y, z], (i * 2 + k) * 3);
      end[i * 2 + k] = k; rnd[i * 2 + k] = r;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(base, 3));
  g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
  g.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 1));
  const uni = {
    uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uBox: { value: B },
    uVel: { value: new THREE.Vector3() }, uLen: { value: 0.05 },
    uHead: { value: new THREE.Vector3() }, uHeadDir: { value: new THREE.Vector3(0, 0, -1) }, uHeadOn: { value: 0 },
    uAmb: { value: 0.3 }, uFogC: { value: new THREE.Color() }, uFogD: { value: 0.01 }, uLamp: { value: new THREE.Vector4(0, -999, 0, 0) },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: uni, transparent: true, depthWrite: false,
    vertexShader: `uniform float uTime, uLen, uHeadOn, uAmb, uFogD; uniform vec3 uCam, uBox, uVel, uHead, uHeadDir; uniform vec4 uLamp;
      attribute float aEnd, aRnd; varying float vA; varying float vFog;
      void main(){
        vec3 p = position;
        float fall = 8.5 + aRnd * 2.5;
        p.y -= uTime * fall;
        p += uVel * uTime * 0.0;
        vec3 rel = mod(p - uCam + uBox, uBox * 2.0) - uBox;
        vec3 w = uCam + rel;
        // 線の長さ:落ちる速さとカメラの動きから
        vec3 sv = vec3(0.6, -fall, 0.3) - uVel;
        w += sv * uLen * aEnd;
        vec4 mv = modelViewMatrix * vec4(w, 1.0);
        gl_Position = projectionMatrix * mv;
        float d = -mv.z;
        // 前照灯の中は明るい
        vec3 h = w - uHead;
        float hd = length(h);
        float cone = smoothstep(0.86, 0.97, dot(h / max(hd, 0.01), uHeadDir)) * smoothstep(45.0, 3.0, hd) * uHeadOn;
        vec3 l = w - uLamp.xyz;
        float lamp = smoothstep(uLamp.w, 0.0, length(l));
        vA = (uAmb + cone * 1.6 + lamp * 0.8) * smoothstep(0.4, 2.0, d) * (0.55 + aRnd * 0.45);
        vFog = exp(-uFogD * uFogD * d * d);
      }`,
    fragmentShader: `uniform vec3 uFogC; varying float vA; varying float vFog;
      void main(){ vec3 c = mix(uFogC, vec3(0.78, 0.8, 0.8), vFog); gl_FragColor = vec4(c, vA * 0.22); }`,
  });
  const lines = new THREE.LineSegments(g, mat);
  lines.frustumCulled = false;
  lines.renderOrder = 50;
  scene.add(lines);

  // 地面のはね返り
  const SP = 500;
  const sp = new Float32Array(SP * 3), life = new Float32Array(SP);
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  const smat = new THREE.PointsMaterial({ color: '#b9c2c2', size: 0.035, transparent: true, opacity: 0.5, depthWrite: false });
  const splash = new THREE.Points(sg, smat); splash.frustumCulled = false; scene.add(splash);

  // タイヤのしぶき(後ろへ)
  const TS = 400;
  const tp = new Float32Array(TS * 3), tv = new Float32Array(TS * 3), tl = new Float32Array(TS);
  const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.BufferAttribute(tp, 3));
  const tmat = new THREE.PointsMaterial({ color: '#9aa3a3', size: 0.22, transparent: true, opacity: 0.25, depthWrite: false });
  const spray = new THREE.Points(tg, tmat); spray.frustumCulled = false; scene.add(spray);
  let tIdx = 0;

  let t = 0;
  return {
    update(dt, { cam, carVel, intensity, head, headDir, headOn, ambient, fog, lamp, car, wet }) {
      t += dt;
      uni.uTime.value = t;
      uni.uCam.value.copy(cam);
      uni.uVel.value.set(carVel.x, carVel.y, carVel.z);
      uni.uLen.value = 0.055;
      uni.uHead.value.copy(head); uni.uHeadDir.value.copy(headDir); uni.uHeadOn.value = headOn;
      uni.uAmb.value = ambient;
      uni.uFogC.value.copy(fog.color); uni.uFogD.value = fog.density;
      if (lamp) uni.uLamp.value.set(lamp.x, lamp.y, lamp.z, lamp.dist); else uni.uLamp.value.set(0, -999, 0, 0);
      g.setDrawRange(0, Math.floor(N * Math.min(1, intensity)) * 2);
      lines.visible = intensity > 0.01;
      // はね返り
      for (let i = 0; i < SP; i++) {
        life[i] -= dt;
        if (life[i] <= 0) {
          if (Math.random() > intensity) { sp[i * 3 + 1] = -9999; life[i] = 0.1; continue; }
          const a = Math.random() * 6.283, r = 4 + Math.random() * 22;
          const x = cam.x + Math.cos(a) * r, z = cam.z + Math.sin(a) * r;
          const gr = groundAt(x, z);
          sp[i * 3] = x; sp[i * 3 + 1] = gr.h + 0.05; sp[i * 3 + 2] = z;
          life[i] = 0.08 + Math.random() * 0.12;
        } else sp[i * 3 + 1] += dt * 0.6;
      }
      sg.attributes.position.needsUpdate = true;
      smat.opacity = 0.18 + headOn * 0.25;
      smat.color.setScalar(0.35 + ambient);
      // しぶき
      if (car) {
        const v = Math.hypot(car.vel.x, car.vel.z);
        const n = wet * Math.min(1, v / 25) * 120 * dt;
        for (let k = 0; k < n; k++) {
          const w = car.wheels[2 + (k & 1)];
          if (!w.contact || w.surface === 'forest' || w.surface === 'grass') continue;
          const p = car.toWorld({ x: w.x, y: -0.45, z: w.z + 0.25 });
          tp[tIdx * 3] = p.x; tp[tIdx * 3 + 1] = p.y; tp[tIdx * 3 + 2] = p.z;
          tv[tIdx * 3] = car.vel.x * 0.5 + (Math.random() - 0.5) * 2; tv[tIdx * 3 + 1] = 1 + Math.random() * 1.5; tv[tIdx * 3 + 2] = car.vel.z * 0.5 + (Math.random() - 0.5) * 2;
          tl[tIdx] = 0.5;
          tIdx = (tIdx + 1) % TS;
        }
        for (let i = 0; i < TS; i++) {
          if (tl[i] <= 0) { tp[i * 3 + 1] = -9999; continue; }
          tl[i] -= dt;
          tv[i * 3 + 1] -= 9 * dt;
          tp[i * 3] += tv[i * 3] * dt; tp[i * 3 + 1] += tv[i * 3 + 1] * dt; tp[i * 3 + 2] += tv[i * 3 + 2] * dt;
        }
        tg.attributes.position.needsUpdate = true;
        tmat.color.setScalar(0.25 + ambient * 0.8);
      }
    },
  };
}
