// 描き方:景色を粗い解像度で描く → フロントガラスの水滴・くもり → 車内(2倍の細かさ)を重ねる → 画面へ
import * as THREE from 'three';
import { SNAP } from './psx.js';
import { GLASS } from './cockpit.js';

export class Renderer {
  constructor(canvas) {
    this.r = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.r.setPixelRatio(1);
    this.r.outputColorSpace = THREE.SRGBColorSpace;
    this.r.autoClear = true;
    this.lowH = 360;
    const opt = { type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true };
    this.rtWorld = new THREE.WebGLRenderTarget(4, 4, opt);
    this.rtGlass = new THREE.WebGLRenderTarget(4, 4, { ...opt, type: THREE.UnsignedByteType });
    this.rtPost = new THREE.WebGLRenderTarget(4, 4, { ...opt, depthBuffer: false });
    this.rtCock = new THREE.WebGLRenderTarget(4, 4, opt);
    this.rtDrops = new THREE.WebGLRenderTarget(256, 128, { type: THREE.UnsignedByteType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });

    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = (mat) => { const s = new THREE.Scene(); const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); m.frustumCulled = false; s.add(m); return s; };

    this.post = new THREE.ShaderMaterial({
      uniforms: {
        tWorld: { value: this.rtWorld.texture }, tGlass: { value: this.rtGlass.texture }, tDrops: { value: this.rtDrops.texture },
        tCock: { value: this.rtCock.texture },
        res: { value: new THREE.Vector2(1, 1) }, uFog: { value: 0 }, uRoom: { value: 0 }, uReflY: { value: 0.3 },
        uGlow: { value: 0 }, uFade: { value: 0 }, uTint: { value: new THREE.Vector3(1, 1, 1) }, uGlassOn: { value: 1 },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `precision highp float;
        uniform sampler2D tWorld, tGlass, tDrops, tCock; uniform vec2 res;
        uniform float uFog, uRoom, uReflY, uGlow, uFade, uGlassOn; uniform vec3 uTint;
        varying vec2 vUv;
        vec3 blur(vec2 uv, float r){
          vec2 px = r / res; vec3 s = vec3(0.0);
          s += texture2D(tWorld, uv + vec2(-px.x, -px.y)).rgb; s += texture2D(tWorld, uv + vec2(px.x, -px.y)).rgb;
          s += texture2D(tWorld, uv + vec2(-px.x, px.y)).rgb; s += texture2D(tWorld, uv + vec2(px.x, px.y)).rgb;
          s += texture2D(tWorld, uv + vec2(0.0, px.y * 1.5)).rgb; s += texture2D(tWorld, uv - vec2(0.0, px.y * 1.5)).rgb;
          s += texture2D(tWorld, uv + vec2(px.x * 1.5, 0.0)).rgb; s += texture2D(tWorld, uv - vec2(px.x * 1.5, 0.0)).rgb;
          return s / 8.0;
        }
        void main(){
          vec3 col = texture2D(tWorld, vUv).rgb;
          vec4 g = texture2D(tGlass, vUv);
          if (uGlassOn > 0.5 && g.b > 0.5) {
            vec4 d = texture2D(tDrops, g.rg);
            if (d.b > 0.35) {
              vec2 n = d.rg * 2.0 - 1.0;
              vec2 off = -n * 0.045 * (0.4 + d.a);
              vec3 c = blur(vUv + off, 1.0);
              float rim = smoothstep(0.55, 1.0, length(n));
              c *= 0.9 + 0.25 * smoothstep(0.2, -0.8, n.y);
              c += vec3(0.05) * rim * smoothstep(-0.2, 0.9, n.y);
              col = mix(col, c, smoothstep(0.35, 0.6, d.b));
            }
            // 内側のくもり(ぼやけて白っぽくなる)
            if (uFog > 0.01) {
              vec3 b = blur(vUv, 1.0 + uFog * 3.0);
              float l = dot(b, vec3(0.3, 0.59, 0.11));
              col = mix(col, mix(b, vec3(l * 0.9 + 0.035), 0.55), uFog * 0.85);
            }
            // ガラスへの映り込み(メーターの照明、室内灯)
            vec2 ru = vec2(vUv.x, 2.0 * uReflY - vUv.y);
            if (ru.y > 0.0 && ru.y < 1.0) {
              vec4 rc = texture2D(tCock, ru);
              col += rc.rgb * rc.a * (uGlow * 0.08 + uRoom * 0.3);
            }
            col = col * (1.0 - uRoom * 0.45) + vec3(0.03, 0.028, 0.022) * uRoom;
          }
          col *= uTint;
          float l = dot(col, vec3(0.299, 0.587, 0.114));
          col = mix(vec3(l), col, 0.86);
          vec2 v = vUv - 0.5; col *= 1.0 - dot(v, v) * 0.5;
          col *= 1.0 - uFade;
          gl_FragColor = vec4(col, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.postScene = quad(this.post);

    this.final = new THREE.ShaderMaterial({
      uniforms: { tPost: { value: this.rtPost.texture }, tCock: { value: this.rtCock.texture }, uCock: { value: 1 }, uFade: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `uniform sampler2D tPost, tCock; uniform float uCock, uFade; varying vec2 vUv;
        void main(){
          vec3 c = texture2D(tPost, vUv).rgb;
          vec4 k = texture2D(tCock, vUv);
          c = mix(c, k.rgb * (1.0 - uFade), k.a * uCock);
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
      depthTest: false, depthWrite: false,
    });
    this.finalScene = quad(this.final);

    // ガラスの位置(水滴の座標)を書き出す材質
    this.glassMat = new THREE.ShaderMaterial({
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'varying vec2 vUv; void main(){ gl_FragColor = vec4(vUv, 1.0, 1.0); }',
      side: THREE.DoubleSide,
    });
    this.glassScene = new THREE.Scene();

    // 水滴(点の大きさ = 水滴の大きさ)
    this.dropMax = 900;
    this.dropPos = new Float32Array(this.dropMax * 3);
    this.dropSize = new Float32Array(this.dropMax);
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(this.dropPos, 3));
    dg.setAttribute('size', new THREE.BufferAttribute(this.dropSize, 1));
    this.dropGeo = dg;
    const dm = new THREE.ShaderMaterial({
      vertexShader: `attribute float size; varying float vS;
        void main(){ vS = size; gl_Position = vec4(position.xy * 2.0 - 1.0, 0.0, 1.0); gl_PointSize = size; }`,
      fragmentShader: `varying float vS;
        void main(){
          vec2 c = gl_PointCoord * 2.0 - 1.0; c.y = -c.y;
          float d = length(c);
          if (d > 1.0) discard;
          gl_FragColor = vec4(c * 0.5 + 0.5, 1.0, clamp(vS / 14.0, 0.0, 1.0));
        }`,
      depthTest: false, depthWrite: false,
    });
    const pts = new THREE.Points(dg, dm); pts.frustumCulled = false;
    this.dropScene = new THREE.Scene(); this.dropScene.add(pts);
  }

  setGlass(geo) { this.glassScene.clear(); this.glassMesh = new THREE.Mesh(geo, this.glassMat); this.glassScene.add(this.glassMesh); }

  resize(w, h, lowH) {
    this.r.setSize(w, h, false);
    this.lowH = lowH || this.lowH;
    const lh = Math.min(this.lowH, h), lw = Math.round(lh * w / h);
    this.lw = lw; this.lh = lh;
    this.rtWorld.setSize(lw, lh); this.rtGlass.setSize(lw, lh); this.rtPost.setSize(lw, lh);
    const k = Math.min(2, h / lh);
    this.rtCock.setSize(Math.round(lw * k), Math.round(lh * k));
    this.post.uniforms.res.value.set(lw, lh);
    // 頂点のガタつきは、画面の半分のマス目に合わせる(少しだけ)
    SNAP.value.set(lw / 2, lh / 2);
  }

  // drops: [{u, v, r}](r はガラスの幅に対する半径)
  drawDrops(drops) {
    const n = Math.min(drops.length, this.dropMax);
    for (let i = 0; i < n; i++) {
      const d = drops[i];
      this.dropPos[i * 3] = d.u; this.dropPos[i * 3 + 1] = d.v; this.dropPos[i * 3 + 2] = 0;
      this.dropSize[i] = Math.max(1.5, d.r * 256 * 2);
    }
    this.dropGeo.setDrawRange(0, n);
    this.dropGeo.attributes.position.needsUpdate = true;
    this.dropGeo.attributes.size.needsUpdate = true;
    this.r.setRenderTarget(this.rtDrops);
    this.r.setClearColor(0x000000, 0);
    this.r.clear();
    this.r.render(this.dropScene, this.quadCam);
  }

  render({ scene, camera, cockpit, cockCamera, glassOn, fog, room, glow, fade, tint }) {
    const r = this.r;
    r.setRenderTarget(this.rtWorld);
    r.setClearColor(scene.fog ? scene.fog.color : 0x000000, 1);
    r.render(scene, camera);
    if (glassOn) {
      r.setRenderTarget(this.rtGlass);
      r.setClearColor(0x000000, 0);
      r.clear();
      r.render(this.glassScene, cockCamera);
    }
    if (cockpit) {
      r.setRenderTarget(this.rtCock);
      r.setClearColor(0x000000, 0);
      r.clear();
      r.render(cockpit, cockCamera);
      // ガラスの下の辺の、画面上の高さ(映り込みの折り返し)
      const p = new THREE.Vector3(-0.37, 0.955, -1.03).applyMatrix4(cockCamera.matrixWorldInverse).applyMatrix4(cockCamera.projectionMatrix);
      this.post.uniforms.uReflY.value = p.y * 0.5 + 0.5;
    }
    const u = this.post.uniforms;
    u.uGlassOn.value = glassOn ? 1 : 0;
    u.uFog.value = fog || 0; u.uRoom.value = room || 0; u.uGlow.value = glow || 0; u.uFade.value = fade || 0;
    if (tint) u.uTint.value.copy(tint);
    r.setRenderTarget(this.rtPost);
    r.render(this.postScene, this.quadCam);
    r.setRenderTarget(null);
    this.final.uniforms.uCock.value = cockpit ? 1 : 0;
    this.final.uniforms.uFade.value = fade || 0;
    r.render(this.finalScene, this.quadCam);
  }
}

// ------------------------------------------------------------ フロントガラスの水滴とワイパー
export class Windshield {
  constructor() {
    this.drops = [];
    this.fog = 0.0;           // くもり
    this.acc = 0;
  }
  // rain 0..1、speed m/s、wipers: [{u, v, ang, prevAng, len}](ガラスの座標)
  update(dt, rain, speed, wipers, inTunnel) {
    const D = this.drops;
    // 新しい水滴(雨が強いほど、速いほど多い)
    if (!inTunnel) {
      this.acc += dt * rain * (26 + speed * 2.2);
      while (this.acc > 1) {
        this.acc--;
        if (D.length > 850) D.shift();
        const big = Math.random();
        D.push({ u: Math.random(), v: Math.random(), r: 0.003 + big * big * big * 0.011, vy: 0, age: 0 });
      }
    }
    // 動き:止まっているときは大きい粒が下へ流れ、速いときは風で上へ押される
    const air = Math.max(0, speed - 9) * 0.012;
    for (let i = D.length - 1; i >= 0; i--) {
      const d = D[i];
      d.age += dt;
      if (d.r > 0.007) d.v += (air * (d.r * 120) - 0.015 * (d.r > 0.009 ? 1 : 0.2)) * dt;
      else d.v += air * 0.4 * dt;
      d.u += (d.u - 0.5) * air * 0.25 * dt;
      if (d.v > 1.02 || d.v < -0.02 || d.u < -0.02 || d.u > 1.02) { D.splice(i, 1); continue; }
      // 小さな粒が近くの粒とくっつく
    }
    // ワイパーが通った所を消す
    const aspect = GLASS.W / GLASS.H;
    for (const w of wipers) {
      if (Math.abs(w.ang - w.prevAng) < 1e-4) continue;
      const a0 = Math.min(w.ang, w.prevAng) - 0.02, a1 = Math.max(w.ang, w.prevAng) + 0.02;
      for (let i = D.length - 1; i >= 0; i--) {
        const d = D[i];
        const dx = (d.u - w.u) * GLASS.W, dy = (d.v - w.v) * GLASS.H;
        const dist = Math.hypot(dx, dy);
        if (dist > w.len * 1.05 || dist < w.len * 0.12) continue;
        // 角度 0 = 左向き、上へ +
        const ang = Math.atan2(dy, -dx);
        if (ang >= a0 && ang <= a1) D.splice(i, 1);
      }
    }
    // くもり:雨の日は少しずつ曇る。曇り止めで晴れる
    return aspect;
  }
}
