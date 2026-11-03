// 車の動き(物理)。three.js を使わない(画面なしでも試せるように)
// 座標:y が上。車の向きは -z が前、+x が右
import { groundAt, surfaceAt, puddleAt } from './world.js';
import * as C from './collide.js';

// ------------------------------------------------------------ 小さなベクトル計算
const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
const add = (a, b) => v3(a.x + b.x, a.y + b.y, a.z + b.z);
const sub = (a, b) => v3(a.x - b.x, a.y - b.y, a.z - b.z);
const mul = (a, s) => v3(a.x * s, a.y * s, a.z * s);
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const len = a => Math.hypot(a.x, a.y, a.z);
const norm = a => { const l = len(a) || 1; return mul(a, 1 / l); };
function qmul(a, b) {
  return { x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y, y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w, w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z };
}
function qrot(q, v) { // q * v * q^-1
  const ix = q.w * v.x + q.y * v.z - q.z * v.y, iy = q.w * v.y + q.z * v.x - q.x * v.z;
  const iz = q.w * v.z + q.x * v.y - q.y * v.x, iw = -q.x * v.x - q.y * v.y - q.z * v.z;
  return v3(ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y, iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z, iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x);
}
const qinvrot = (q, v) => qrot({ x: -q.x, y: -q.y, z: -q.z, w: q.w }, v);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ------------------------------------------------------------ 車のデータ(90年代の 1.6L 後輪駆動セダンを想定)
export const SPEC = {
  mass: 1090,
  inertia: v3(1350, 1500, 360),       // 左右軸(ピッチ)/ 上下軸(ヨー)/ 前後軸(ロール)
  wheelBase: 2.43, front: -1.10, rear: 1.33, track: 1.41,
  radius: 0.30,
  restLen: 0.32, attachY: 0.0,
  springF: 26000, springR: 22000, bump: 2100, rebound: 3000, arbF: 9000, arbR: 4500,
  maxSteer: 0.62,
  brakeF: 1500, brakeR: 820, handbrake: 1600,
  engineInertia: 0.17,
  idleRpm: 780, limiter: 7200, redline: 6500,
  // 全開のときのトルク(N·m)
  torque: [[0, 70], [800, 96], [1500, 116], [2500, 128], [3500, 136], [4500, 141], [5200, 143], [6000, 136], [6800, 120], [7400, 100]],
  at: { gears: [3.643, 2.008, 1.296, 0.892], reverse: 2.977, final: 4.10, tcK: 0.00195 },
  mt: { gears: [3.587, 2.022, 1.384, 1.0, 0.861], reverse: 3.484, final: 4.30, clutchCap: 270 },
  tankL: 50,
};

function torqueAt(rpm) {
  const T = SPEC.torque;
  if (rpm <= T[0][0]) return T[0][1];
  for (let i = 1; i < T.length; i++) if (rpm <= T[i][0]) {
    const [r0, t0] = T[i - 1], [r1, t1] = T[i];
    return t0 + (t1 - t0) * (rpm - r0) / (r1 - r0);
  }
  return T[T.length - 1][1];
}

// タイヤの力の形(すべり s=1 で最大、その先は少し落ちる)
function tireCurve(s) { return Math.sin(1.4 * Math.atan(2.07 * s)); }

const RPM = 60 / (2 * Math.PI);

export class Car {
  constructor(opts = {}) {
    this.trans = opts.trans || 'AT';            // 'AT' / 'MT'
    this.autoClutch = opts.autoClutch ?? true;
    this.abs = opts.abs ?? true;
    this.wheels = [
      { name: 'FL', x: -SPEC.track / 2, z: SPEC.front, front: true, side: -1 },
      { name: 'FR', x: SPEC.track / 2, z: SPEC.front, front: true, side: 1 },
      { name: 'RL', x: -SPEC.track / 2, z: SPEC.rear, front: false, side: -1 },
      { name: 'RR', x: SPEC.track / 2, z: SPEC.rear, front: false, side: 1 },
    ].map(w => ({ ...w, omega: 0, spin: 0, comp: 0, prevComp: 0, contact: false, load: 0, slip: 0, slide: 0, surface: null, depth: 0 }));
    this.events = [];
    this.reset(0, 0, 0, 0);
  }

  reset(x, y, z, yaw) {
    this.pos = v3(x, y + 0.53, z);
    this.vel = v3();
    this.q = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
    this.angVel = v3();
    for (const w of this.wheels) { w.omega = 0; w.comp = 0.1; w.prevComp = 0.1; w.relax = 0; }
    this.steer = 0; this.steerTarget = 0;
    this.engine = this.engine || { rpm: 0, omega: 0, running: false, cranking: 0, stallTimer: 0, flooded: 0 };
    this.engine.omega = this.engine.running ? SPEC.idleRpm / RPM : 0;
    this.lever = this.lever || 'P';             // AT: P R N D 2 L
    this.odOff = this.odOff || false;
    this.gear = this.trans === 'AT' ? 0 : 0;     // AT: 0 = 1速 … 3 = 4速 / MT: -1 = R, 0 = N, 1..5
    this.atGear = 0;
    this.shiftTimer = 0;
    this.clutch = 1; this.clutchPedal = 0;
    this.locked = false;
    this.fuel = this.fuel ?? 6.5;
    this.temp = this.temp ?? 0.5;
    this.odo = this.odo ?? 128.734 * 1000;
    this.trip = this.trip ?? 0;
    this.speed = 0; this.speedSigned = 0; this.speedo = 0;
    this.throttle = 0; this.brake = 0;
    this.upsideTimer = 0;
    this.damage = this.damage || [];
  }

  // ---------------------------------------------------------- 向き
  up() { return qrot(this.q, v3(0, 1, 0)); }
  fwd() { return qrot(this.q, v3(0, 0, -1)); }
  right() { return qrot(this.q, v3(1, 0, 0)); }
  toWorld(p) { return add(this.pos, qrot(this.q, p)); }
  yaw() { const f = this.fwd(); return Math.atan2(-f.x, -f.z); }

  // ---------------------------------------------------------- 運転席の操作
  setTransmission(t) { this.trans = t; this.gear = 0; this.atGear = 0; this.lever = t === 'AT' ? 'P' : 'N'; }
  leverUp() {   // AT:奥へ(L → 2 → D → N → R → P)/ MT:シフトアップ
    if (this.trans === 'AT') { const L = ['P', 'R', 'N', 'D', '2', 'L']; const i = L.indexOf(this.lever); if (i > 0) this.moveLever(L[i - 1]); }
    else this.mtShift(+1);
  }
  leverDown() { // AT:手前へ(P → R → N → D → 2 → L)/ MT:シフトダウン
    if (this.trans === 'AT') { const L = ['P', 'R', 'N', 'D', '2', 'L']; const i = L.indexOf(this.lever); if (i < L.length - 1) this.moveLever(L[i + 1]); }
    else this.mtShift(-1);
  }
  moveLever(to) {
    // P と R には止まっているときしか入らない(本物の車と同じ)
    const kmh = Math.abs(this.speed * 3.6);
    if ((to === 'P' || to === 'R') && kmh > 6) { this.events.push({ type: 'refuse' }); return; }
    if (this.lever === 'R' && to === 'N' && kmh > 6 && this.speedSigned > 0) { /* 前に動いていても N へは入る */ }
    this.lever = to;
    this.events.push({ type: 'lever', to });
  }
  toggleOD() { this.odOff = !this.odOff; this.events.push({ type: 'click' }); }
  mtShift(d) {
    const ng = clamp(this.gear + d, -1, 5);
    if (ng === this.gear) return;
    if (ng === -1 && this.speedSigned > 2) { this.events.push({ type: 'refuse' }); return; }
    // クラッチを踏んでいないとギアが入らない(自動クラッチなら自動で切る)
    if (!this.autoClutch && this.clutch > 0.35 && ng !== 0 && this.engine.running) { this.events.push({ type: 'grind' }); return; }
    this.gear = ng;
    this.shiftTimer = this.autoClutch ? 0.28 : 0;
    this.locked = false;
    this.events.push({ type: 'shift' });
  }

  // キー:オフ → オン → スタート
  ignition(hold) {
    const e = this.engine;
    if (hold) {
      if (e.running) return;
      // AT は P か N、MT はクラッチを踏むか N のときだけ回る
      const okAT = this.trans === 'AT' && (this.lever === 'P' || this.lever === 'N');
      const okMT = this.trans === 'MT' && (this.gear === 0 || this.clutch < 0.2 || this.autoClutch);
      if (!okAT && !okMT) { if (!e.warned) { this.events.push({ type: 'noStart' }); e.warned = true; } return; }
      e.cranking = 1;
    } else {
      e.cranking = 0; e.warned = false;
    }
  }
  engineOff() {
    if (this.engine.running) { this.engine.running = false; this.events.push({ type: 'engineOff' }); }
  }

  // ---------------------------------------------------------- 1 フレーム
  update(dt, input) {
    const N = Math.max(1, Math.min(8, Math.round(dt / (1 / 240))));
    const h = dt / N;
    this.controls(dt, input);
    for (let i = 0; i < N; i++) this.substep(h);
    this.after(dt);
  }

  controls(dt, input) {
    const kmh = Math.abs(this.speed) * 3.6;
    // ハンドル:キーボードは速いほど切れ角を小さく、ゆっくり動かす(運転しやすくするため)
    const lim = SPEC.maxSteer / (1 + kmh / (input.analogSteer ? 70 : 45));
    this.steerTarget = clamp(input.steer, -1, 1) * lim;
    const rate = (Math.sign(this.steerTarget - this.steer) === Math.sign(this.steer) || this.steerTarget === 0 ? 1.9 : 1.3) * (input.analogSteer ? 2.4 : 1);
    const dS = this.steerTarget - this.steer;
    this.steer += clamp(dS, -rate * dt, rate * dt);
    // ペダル
    const tRate = input.throttle > this.throttle ? 3.0 : 6;
    this.throttle += clamp(input.throttle - this.throttle, -tRate * dt, tRate * dt);
    const bRate = input.brake > this.brake ? 4.0 : 8;
    this.brake += clamp(input.brake - this.brake, -bRate * dt, bRate * dt);
    this.handbrake = input.handbrake ? 1 : 0;
    // クラッチペダル(手動のとき)。離すときはゆっくり
    const target = input.clutch ? 1 : 0;
    const cr = target > this.clutchPedal ? 7 : 1.6;
    this.clutchPedal += clamp(target - this.clutchPedal, -cr * dt, cr * dt);
  }

  // AT の変速の決まり(速度 km/h と、アクセルの踏み具合)
  atLogic(dt) {
    const kmh = this.speedSigned * 3.6;
    const th = this.throttle;
    const maxG = this.lever === 'L' ? 0 : this.lever === '2' ? 1 : this.odOff ? 2 : 3;
    // 低いレンジに入れても、回りすぎる速さでは下のギアに落とさない
    const safeDown = (g) => (kmh / 3.6) / SPEC.radius * SPEC.at.gears[g] * SPEC.at.final * RPM < 6300;
    if (this.shiftTimer > 0) { this.shiftTimer -= dt; return; }
    const up = [[16, 50], [32, 92], [52, 135]];
    let g = this.atGear;
    if (g > maxG) { if (safeDown(g - 1)) { g--; } }
    else if (g < maxG && g < 3) {
      const [a, b] = up[g];
      if (kmh > a + (b - a) * th) g++;
    }
    if (g === this.atGear && g > 0) {
      const [a, b] = up[g - 1];
      const down = (a + (b - a) * th) * 0.62 - 3;
      const kick = th > 0.92 && safeDown(g - 1) && kmh < b * 0.92;
      if (kmh < down || kick) g--;
    }
    if (g !== this.atGear) { this.atGear = g; this.shiftTimer = 0.4; this.events.push({ type: 'atShift', gear: g }); }
  }

  driveRatio() {
    if (this.trans === 'AT') {
      if (this.lever === 'R') return -SPEC.at.reverse * SPEC.at.final;
      if (this.lever === 'P' || this.lever === 'N') return 0;
      return SPEC.at.gears[this.atGear] * SPEC.at.final;
    }
    if (this.gear === 0) return 0;
    if (this.gear < 0) return -SPEC.mt.reverse * SPEC.mt.final;
    return SPEC.mt.gears[this.gear - 1] * SPEC.mt.final;
  }

  substep(h) {
    const e = this.engine;
    const up = this.up(), fwd = this.fwd(), right = this.right();
    let F = v3(0, -9.81 * SPEC.mass, 0), Tq = v3();
    const applyAt = (f, p) => { F = add(F, f); Tq = add(Tq, cross(sub(p, this.pos), f)); };

    // ---- エンジンのトルク
    const rpm = e.omega * RPM;
    e.rpm = rpm;
    let th = this.throttle;
    if (this.fuel <= 0 || e.flooded > 0) th = 0;
    if (e.running) {
      // アイドリングを保つ
      const idleT = clamp((SPEC.idleRpm + 60 - rpm) / 350, 0, 0.4);
      th = Math.max(th, idleT);
      if (rpm > SPEC.limiter) th = 0;
      if (this.fuel < 0.25 && Math.random() < 0.08) th = 0; // 燃料が少ないとむせる
    } else th = 0;
    const fric = -(12 + 0.065 * Math.abs(e.omega)) * Math.sign(e.omega || 1) * (e.omega > 0.5 ? 1 : 0);
    let Te = th * torqueAt(rpm) + fric;
    if (e.cranking && !e.running) Te += rpm < 320 ? 70 : 10;
    // 変速中は少し力が抜ける
    if (this.shiftTimer > 0 && this.trans === 'AT') Te *= 0.6;

    // ---- 変速機
    const ratio = this.driveRatio();
    const RL = this.wheels[2], RR = this.wheels[3];
    const wIn = (RL.omega + RR.omega) / 2 * ratio;  // 変速機の入り口の回転
    let driveT = 0;                                // 後ろの車軸にかかるトルク(合計)
    let extraInertia = 0;
    if (this.trans === 'AT') {
      if (ratio !== 0) {
        const we = e.omega, wt = wIn;
        let Tp = SPEC.at.tcK * (we * Math.abs(we) - wt * Math.abs(wt));
        const sr = we > 1 ? wt / we : 1;
        const tr = 1 + 1.1 * Math.max(0, 1 - sr / 0.85);
        Tp = clamp(Tp, -220, 260);
        driveT = Tp * (Tp > 0 ? tr : 1) * ratio * 0.9;
        e.omega += (Te - Tp) / SPEC.engineInertia * h;
      } else e.omega += Te / SPEC.engineInertia * h;
      this.clutch = 1;
    } else {
      // 自動クラッチ:変速のときと、回転が低いときに切る
      let c;
      if (this.autoClutch) {
        if (this.shiftTimer > 0) c = 0;
        else {
          const slipUp = e.omega - Math.abs(wIn);
          const launch = clamp((rpm - 1050) / 1500, 0, 1) * clamp(0.35 + this.throttle, 0, 1);
          c = Math.abs(wIn) * RPM > 1300 ? 1 : (this.throttle < 0.05 && Math.abs(wIn) * RPM < 1100 ? 0 : Math.max(launch, slipUp < 15 ? 1 : 0));
        }
        this.clutch += clamp(c - this.clutch, -8 * h, 4 * h);
      } else this.clutch = 1 - this.clutchPedal;
      c = this.clutch;
      if (ratio === 0 || c < 0.02) {
        this.locked = false;
        e.omega += Te / SPEC.engineInertia * h;
      } else {
        const cap = SPEC.mt.clutchCap * c;
        if (this.locked) {
          if (c < 0.9 || Math.abs(Te) > cap * 1.1) this.locked = false;
        } else if (c > 0.9 && Math.abs(e.omega - wIn) < 2.5) this.locked = true;
        if (this.locked) {
          e.omega = wIn;
          driveT = Te * ratio * 0.92;
          extraInertia = SPEC.engineInertia * ratio * ratio / 2;
        } else {
          const Tc = cap * Math.tanh((e.omega - wIn) / 4);
          e.omega += (Te - Tc) / SPEC.engineInertia * h;
          driveT = Tc * ratio * 0.92;
        }
      }
    }
    if (e.omega < 0) e.omega = 0;
    // エンスト
    if (e.running && e.omega * RPM < 380 && !e.cranking) { e.running = false; this.events.push({ type: 'stall' }); }
    if (e.cranking && !e.running && e.omega * RPM > 300 && this.fuel > 0 && e.flooded <= 0) {
      e.crankTime = (e.crankTime || 0) + h;
      if (e.crankTime > 0.55) { e.running = true; e.crankTime = 0; this.events.push({ type: 'start' }); }
    }

    // ---- 4つのタイヤ
    let compF = [0, 0], compR = [0, 0];
    for (const w of this.wheels) {
      const attach = this.toWorld(v3(w.x, SPEC.attachY, w.z));
      const g = groundAt(attach.x, attach.z);
      const upY = Math.max(0.2, up.y);
      // 真下ではなく車の下向きに伸ばしたときの、地面までの長さ
      let dist = (attach.y - g.h) / upY;
      const maxLen = SPEC.restLen + SPEC.radius;
      w.groundH = g.h;
      if (dist > maxLen || dist < -0.4) {
        w.contact = false; w.comp = Math.max(0, w.comp - h * 3); w.load = 0;
        w.omega *= 1 - 0.3 * h;
        if (w.front === false) w.omega += driveT / 2 / 1.2 * h * 0.2;
        continue;
      }
      w.contact = true;
      const comp = clamp(maxLen - dist, 0, 0.45);
      const k = w.front ? SPEC.springF : SPEC.springR;
      const vComp = (comp - w.comp) / h;
      w.comp = comp;
      let Fs = k * comp + (vComp > 0 ? SPEC.bump : SPEC.rebound) * vComp;
      if (comp > 0.2) Fs += 220000 * (comp - 0.2);
      (w.front ? compF : compR)[w.side < 0 ? 0 : 1] = comp;
      Fs = Math.max(0, Fs);
      w.load = Fs;
      // 地面の向き
      const n = this.groundNormal(attach.x, attach.z, g.h);
      const contact = sub(attach, mul(up, dist));
      // タイヤの向き(前輪はハンドルの角度。内側を少し多く切る)
      let delta = 0;
      if (w.front) {
        const s = this.steer;
        delta = s * (1 + 0.13 * (Math.sign(s) === w.side ? -1 : 1) * Math.min(1, Math.abs(s) * 3));
      }
      const cd = Math.cos(delta), sd = Math.sin(delta);
      let wf = add(mul(fwd, cd), mul(right, sd));
      wf = norm(sub(wf, mul(n, dot(wf, n))));
      const ws = cross(wf, n); // タイヤの右
      const r = sub(contact, this.pos);
      const vc = add(this.vel, cross(this.angVel, r));
      const vLong = dot(vc, wf), vLat = dot(vc, ws);
      // 路面
      const surf = surfaceAt(contact.x, contact.z, g);
      w.surface = surf.type; w.depth = surf.depth;
      let mu = surf.grip;
      if (g.nr && g.nr.tunnel) mu = 1.0;           // トンネルの中は乾いている
      else if (surf.type === 'asphalt') mu = this.wetGrip(mu, contact, vLong);
      if (surf.depth > 0.05) mu *= clamp(1 - surf.depth * 1.2, 0.35, 1);
      // でこぼこ
      if (surf.bump > 0) Fs *= 1 + Math.sin(contact.x * 3.1 + contact.z * 2.3) * Math.sin(contact.z * 4.7 - contact.x * 1.3) * surf.bump * 8 * clamp(Math.abs(vLong) / 8, 0, 1);
      const Fz = Fs * Math.max(0.3, dot(up, n));
      // すべり
      const R = SPEC.radius;
      const denom = Math.max(Math.abs(vLong), 2.0);
      const kappa = (w.omega * R - vLong) / denom;
      // 横のすべりは少し遅れて立ち上がる(低速でふらつかないように)
      const alpha = Math.atan2(vLat, Math.max(Math.abs(vLong), 1.0));
      w.relax += (alpha - w.relax) * clamp(Math.abs(vLong) * h / 0.35 + 0.02, 0, 1);
      const sx = kappa / 0.09, sy = Math.tan(w.relax) / 0.13;
      const sMag = Math.hypot(sx, sy);
      let fx = 0, fy = 0;
      if (sMag > 1e-6) {
        const Fmax = mu * Fz * tireCurve(sMag);
        fx = Fmax * sx / sMag;
        fy = -Fmax * sy / sMag;
      }
      // 止まりかけのときは、横すべりを直接止める
      const lowV = clamp(1 - Math.hypot(vLong, vLat) / 2.5, 0, 1);
      if (lowV > 0) fy = fy * (1 - lowV) + clamp(-vLat * Fz * 0.9, -mu * Fz, mu * Fz) * lowV;
      w.slip = kappa; w.slide = Math.hypot(Math.max(0, Math.abs(kappa) - 0.12), Math.max(0, Math.abs(Math.tan(w.relax)) - 0.18)) * Math.min(1, Math.abs(vLong) / 4);
      // 転がり抵抗と水の抵抗
      const roll = (surf.roll + surf.depth * 0.6) * Fz;
      // 力をかける
      const Fn = mul(n, Fs);
      const Ft = add(mul(wf, fx), mul(ws, fy));
      applyAt(add(Fn, Ft), contact);
      // タイヤの回転
      let I = w.front ? 1.1 : 1.25 + extraInertia;
      let T = -fx * R - Math.sign(w.omega) * roll * R;
      if (!w.front) T += driveT / 2;
      w.omega += T / I * h;
      // ブレーキ(ABS:ロックしかけたら弱める)
      let Tb = (w.front ? SPEC.brakeF : SPEC.brakeR) * this.brake;
      if (!w.front) Tb += SPEC.handbrake * this.handbrake;
      if (this.abs && this.brake > 0 && kappa < -0.14 && Math.abs(vLong) > 2) Tb *= 0.35;
      if (!w.front && this.trans === 'AT' && this.lever === 'P') Tb += 6000;
      const dB = Tb / I * h;
      if (Math.abs(w.omega) <= dB) w.omega = 0;
      else w.omega -= Math.sign(w.omega) * dB;
      // 止まっていてブレーキを踏んでいるときは、坂でも動かない
      if (Tb > 400 && Math.abs(vLong) < 0.6 && Math.abs(w.omega) < 1) {
        const hold = clamp(-vLong * Fz * 2.5, -mu * Fz, mu * Fz);
        applyAt(mul(wf, hold), contact);
      }
    }
    // スタビライザー(左右の沈みの差を減らす)
    for (const [cmp, k, ia, ib] of [[compF, SPEC.arbF, 0, 1], [compR, SPEC.arbR, 2, 3]]) {
      const d = (cmp[0] - cmp[1]) * k;
      const a = this.wheels[ia], b = this.wheels[ib];
      if (a.contact) applyAt(mul(up, -d), this.toWorld(v3(a.x, 0, a.z)));
      if (b.contact) applyAt(mul(up, d), this.toWorld(v3(b.x, 0, b.z)));
    }
    // 空気の抵抗
    const sp = len(this.vel);
    F = add(F, mul(this.vel, -0.42 * sp));
    // 水の抵抗(車体が水につかると強い)
    const depthF = Math.max(this.wheels[0].depth, this.wheels[1].depth);
    if (depthF > 0.15) F = add(F, mul(this.vel, -sp * depthF * 900));

    // ---- 車体と地面(ひっくり返ったときや、段差でこすったとき)
    const hull = [];
    for (const x of [-0.8, 0.8]) for (const y of [-0.28, 0.75]) for (const z of [-2.0, 2.0]) hull.push(v3(x, y, z));
    for (const p of hull) {
      const wp = this.toWorld(p);
      const gh = groundAt(wp.x, wp.z).h;
      const pen = gh - wp.y;
      if (pen > 0) {
        const r = sub(wp, this.pos);
        const vp = add(this.vel, cross(this.angVel, r));
        const fn = Math.max(0, 180000 * pen - 9000 * vp.y);
        const vt = v3(vp.x, 0, vp.z), vtl = len(vt);
        let f = v3(0, fn, 0);
        if (vtl > 0.01) f = add(f, mul(vt, -Math.min(0.6 * fn, vtl * SPEC.mass * 8) / vtl));
        applyAt(f, wp);
        if (vp.y < -2.5) this.events.push({ type: 'scrape', v: -vp.y });
      }
    }

    // ---- 積分
    this.vel = add(this.vel, mul(F, h / SPEC.mass));
    const tl = qinvrot(this.q, Tq);
    const wl = qinvrot(this.q, this.angVel);
    const I = SPEC.inertia;
    // ジャイロ効果は小さいので省く
    const al = v3(tl.x / I.x, tl.y / I.y, tl.z / I.z);
    this.angVel = add(this.angVel, mul(qrot(this.q, al), h));
    this.angVel = mul(this.angVel, 1 - 0.4 * h);
    this.pos = add(this.pos, mul(this.vel, h));
    const ww = this.angVel;
    const dq = { x: ww.x * h / 2, y: ww.y * h / 2, z: ww.z * h / 2, w: 0 };
    const qq = qmul(dq, this.q);
    this.q = { x: this.q.x + qq.x, y: this.q.y + qq.y, z: this.q.z + qq.z, w: this.q.w + qq.w };
    const ql = Math.hypot(this.q.x, this.q.y, this.q.z, this.q.w);
    this.q = { x: this.q.x / ql, y: this.q.y / ql, z: this.q.z / ql, w: this.q.w / ql };

    // ---- 木・壁・ガードレールにぶつかる
    this.collide();

    // ---- タイヤの回った角度(見た目用)と距離
    for (const w of this.wheels) w.spin += w.omega * h;
    const dRear = (RL.omega + RR.omega) / 2 * SPEC.radius * h;
    this.odo += Math.abs(dRear); this.trip += Math.abs(dRear);
    this.speedo = (RL.omega + RR.omega) / 2 * SPEC.radius;
    // 燃料(仕事率から)
    if (e.running) {
      const P = Math.max(0, th * torqueAt(rpm) * e.omega) / 1000; // kW
      this.fuel = Math.max(0, this.fuel - (P * 255 / 3600 + 0.22) / 740 * h); // g/s → L
      if (this.fuel <= 0) { e.running = false; this.events.push({ type: 'outOfFuel' }); }
    }
  }

  wetGrip(mu, p, vLong) {
    // 水たまりでは、速いほどタイヤが浮く(ハイドロプレーニング)
    const pud = puddleAt(p.x, p.z, this.wet ?? 1) * (this.wet ?? 1);
    if (pud <= 0) return mu;
    const kmh = Math.abs(vLong) * 3.6;
    const plane = clamp((kmh - 55) / 45, 0, 0.75) * pud;
    return mu * (1 - pud * 0.22) * (1 - plane);
  }

  groundNormal(x, z, h0) {
    const e = 0.5;
    const hx = groundAt(x + e, z).h, hz = groundAt(x, z + e).h;
    if (Math.abs(hx - h0) > 1.5 || Math.abs(hz - h0) > 1.5) return v3(0, 1, 0);
    return norm(v3(-(hx - h0) / e, 1, -(hz - h0) / e));
  }

  collide() {
    // 車体のまわりの点(バンパーと横腹)
    const pts = [[-0.82, -2.06], [0.82, -2.06], [0, -2.1], [-0.82, 2.04], [0.82, 2.04], [0, 2.08], [-0.86, -1.0], [0.86, -1.0], [-0.86, 0.2], [0.86, 0.2], [-0.86, 1.2], [0.86, 1.2]];
    const near = C.nearby(this.pos.x, this.pos.z, 3.5);
    if (!near.size) return;
    for (const [lx, lz] of pts) {
      const wp = this.toWorld(v3(lx, 0.05, lz));
      for (const o of near) {
        if (wp.y < o.y0 || wp.y - 0.5 > o.y1) continue;
        const c = C.contact(o, wp.x, wp.z, 0.06);
        if (!c) continue;
        const n = v3(c.nx, 0, c.nz);
        // めりこみを押し戻す
        this.pos = add(this.pos, mul(n, c.pen * 0.9));
        const r = sub(wp, this.pos);
        const vp = add(this.vel, cross(this.angVel, r));
        const vn = dot(vp, n);
        if (vn >= 0) continue;
        const rn = cross(r, n);
        const Il = qinvrot(this.q, rn);
        const k = 1 / SPEC.mass + dot(rn, qrot(this.q, v3(Il.x / SPEC.inertia.x, Il.y / SPEC.inertia.y, Il.z / SPEC.inertia.z)));
        const j = -(1 + 0.18) * vn / k;
        // 横向きのこすれ(摩擦)
        const vt = sub(vp, mul(n, vn));
        const vtl = len(vt);
        let J = mul(n, j);
        if (vtl > 0.01) J = add(J, mul(vt, -Math.min(0.35 * j, vtl / k) / vtl));
        this.vel = add(this.vel, mul(J, 1 / SPEC.mass));
        const tl = qinvrot(this.q, cross(r, J));
        this.angVel = add(this.angVel, qrot(this.q, v3(tl.x / SPEC.inertia.x, tl.y / SPEC.inertia.y, tl.z / SPEC.inertia.z)));
        if (-vn > 1.2) this.events.push({ type: 'hit', v: -vn, lx, lz, tag: o.tag });
      }
    }
  }

  after(dt) {
    const e = this.engine;
    const f = this.fwd();
    this.speedSigned = this.vel.x * f.x + this.vel.y * f.y + this.vel.z * f.z;
    // 車から見た加速度(運転席の頭の揺れに使う)
    const pv = this.prevVel || this.vel;
    this.lastAcc = qinvrot(this.q, v3((this.vel.x - pv.x) / dt, (this.vel.y - pv.y) / dt, (this.vel.z - pv.z) / dt));
    this.prevVel = { ...this.vel };
    this.speed = len(this.vel);
    if (this.trans === 'AT') this.atLogic(dt);
    else if (this.shiftTimer > 0) this.shiftTimer -= dt;
    // 水を吸いこむとエンジンが止まる(しばらくかからない)
    const depth = Math.max(this.wheels[0].depth, this.wheels[1].depth);
    if (e.running && depth > 0.45) { e.running = false; e.flooded = 6; this.events.push({ type: 'flooded' }); }
    if (e.running && depth > 0.3 && this.speed > 6 && Math.random() < dt * 0.6) { e.running = false; e.flooded = 4; this.events.push({ type: 'flooded' }); }
    if (e.flooded > 0 && depth < 0.25) e.flooded -= dt;
    // 水温:高い回転が続くと少し上がる
    const target = e.running ? 0.5 + clamp((e.rpm - 4500) / 6000, 0, 0.25) : 0.5;
    this.temp += (target - this.temp) * dt * 0.02;
    // ひっくり返った
    if (this.up().y < 0.25) this.upsideTimer += dt; else this.upsideTimer = 0;
  }

  gearLabel() {
    if (this.trans === 'AT') return this.lever;
    return this.gear < 0 ? 'R' : this.gear === 0 ? 'N' : String(this.gear);
  }
  rpm() { return this.engine.omega * RPM; }
}
