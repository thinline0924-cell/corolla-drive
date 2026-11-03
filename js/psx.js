// 昔のゲーム機のような見た目にするための共通部品
import * as THREE from 'three';

// 頂点の位置を、画面の粗いマス目に合わせる(形のふちが少しカクつく)
export const SNAP = { value: new THREE.Vector2(320, 180) };
// 雨で濡れている度合い(0..1)。道路の材質が使う
export const WET = { value: 1 };

export function psx(mat) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    sh.uniforms.uSnap = SNAP;
    sh.vertexShader = sh.vertexShader
      .replace('void main() {', 'uniform vec2 uSnap;\nvoid main() {')
      .replace('#include <project_vertex>', `#include <project_vertex>
        { vec4 p = gl_Position; p.xy = floor(p.xy / p.w * uSnap + 0.5) / uSnap * p.w; gl_Position = p; }`);
  };
  mat.customProgramCacheKey = () => 'psx' + (mat.userData.key || '');
  return mat;
}

export const lam = (o) => psx(new THREE.MeshLambertMaterial(o));
export const std = (o) => psx(new THREE.MeshStandardMaterial(o));

// 乱数(種を固定して、毎回同じ景色にする)
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
