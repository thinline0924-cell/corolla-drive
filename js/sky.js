// 空・霧・光の色。時刻(夕方から夜へ)と雨の強さで変わる
import * as THREE from 'three';

// 時刻 → 明るさ(0 = 真っ暗、1 = 雨の日の昼)
// 夏の雨の日。18:40 ごろから急に暗くなり、19:30 には夜
export function daylight(clock) {
  const t = (clock - 18.4) / 1.1; // 18:24 → 0、19:30 → 1
  return 1 - Math.min(1, Math.max(0, t)) ** 0.8;
}

const C = (h) => new THREE.Color(h);
const DAY = { sky: C('#7f8a8b'), top: C('#3c4a50'), fog: C('#6a7473'), hemiSky: C('#8b9698'), hemiGround: C('#20261e'), glow: C('#a3907a') };
const NIGHT = { sky: C('#0c1113'), top: C('#05080a'), fog: C('#0b1012'), hemiSky: C('#1a2428'), hemiGround: C('#050706'), glow: C('#141617') };

export function createSky(scene) {
  const uni = {
    uHor: { value: DAY.sky.clone() }, uTop: { value: DAY.top.clone() }, uGlow: { value: DAY.glow.clone() },
  };
  const g = new THREE.SphereGeometry(1200, 24, 12);
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, uniforms: uni,
    vertexShader: 'varying vec3 vP; void main(){ vP = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }',
    fragmentShader: `uniform vec3 uHor, uTop, uGlow; varying vec3 vP;
      void main(){
        vec3 d = normalize(vP);
        float h = d.y;
        vec3 c = mix(uHor, uTop, smoothstep(-0.02, 0.5, h));
        float w = pow(max(0.0, dot(normalize(d.xz), normalize(vec2(-0.75, 0.66)))), 5.0);
        c = mix(c, uGlow, w * (1.0 - smoothstep(0.0, 0.22, h)) * 0.55);
        // 雲のむら
        float n = sin(d.x * 9.0 + d.z * 4.0) * sin(d.z * 7.0 - d.x * 3.0);
        c *= 1.0 + n * 0.035 * smoothstep(0.0, 0.3, h);
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  scene.add(mesh);

  scene.fog = new THREE.FogExp2(DAY.fog.clone(), 0.009);
  const hemi = new THREE.HemisphereLight(DAY.hemiSky, DAY.hemiGround, 1.7);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight('#9aa39c', 0.4);
  dir.position.set(-300, 400, 300);
  scene.add(dir);

  const state = { light: 1, tunnel: 0 };
  const tunnelHemi = C('#d08a40');
  function update(clock, rain, camPos, tunnelAmt) {
    const L = daylight(clock);
    state.light = L;
    const k = 1 - L;
    uni.uHor.value.copy(DAY.sky).lerp(NIGHT.sky, k);
    uni.uTop.value.copy(DAY.top).lerp(NIGHT.top, k);
    uni.uGlow.value.copy(DAY.glow).lerp(NIGHT.glow, Math.min(1, k * 1.4));
    // 雨が強いと遠くが白くかすむ
    scene.fog.color.copy(DAY.fog).lerp(NIGHT.fog, k);
    scene.fog.density = 0.0065 + rain * 0.006 + k * 0.004;
    hemi.color.copy(DAY.hemiSky).lerp(NIGHT.hemiSky, k);
    hemi.groundColor.copy(DAY.hemiGround).lerp(NIGHT.hemiGround, k);
    hemi.intensity = 1.7 * (0.12 + 0.88 * L);
    dir.intensity = 0.4 * L;
    // トンネルの中:空の光を消して、ナトリウム灯の橙にする
    if (tunnelAmt > 0) {
      hemi.color.lerp(tunnelHemi, tunnelAmt);
      hemi.groundColor.lerp(C('#3a2410'), tunnelAmt);
      hemi.intensity = THREE.MathUtils.lerp(hemi.intensity, 0.9, tunnelAmt);
      dir.intensity *= 1 - tunnelAmt;
    }
    mesh.position.copy(camPos);
  }
  return { mesh, hemi, dir, update, state };
}
