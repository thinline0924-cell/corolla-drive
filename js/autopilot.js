// 道に沿って自動で走らせる(タイトル画面のデモと、動作確認用)
import { roadById } from './world.js';

export class Autopilot {
  constructor(legs, opt = {}) {
    this.legs = legs;          // [{ id, reverse }] の並び
    this.leg = 0;
    this.maxKmh = opt.maxKmh ?? 55;
    this.lane = opt.lane ?? -1.55;
    this.i = 0;
    this.done = false;
  }
  samples() {
    const L = this.legs[this.leg];
    const S = roadById[L.id].samples;
    return L.reverse ? S.slice().reverse() : S;
  }
  control(car) {
    if (this.done) return { throttle: 0, brake: 1, steer: 0 };
    let S = this.samples();
    const p = car.pos;
    // いまいる点(前にだけ進める)
    let best = 1e9, bi = this.i;
    for (let k = this.i; k < Math.min(S.length, this.i + 40); k++) {
      const d = (S[k].x - p.x) ** 2 + (S[k].z - p.z) ** 2;
      if (d < best) { best = d; bi = k; }
    }
    this.i = bi;
    if (bi >= S.length - 3) {
      if (this.leg < this.legs.length - 1) { this.leg++; this.i = 0; S = this.samples(); }
      else { this.done = true; return { throttle: 0, brake: 1, steer: 0 }; }
    }
    const v = Math.max(0, car.speedSigned);
    const look = 7 + v * 0.7;
    const ahead = (dist) => {
      let k = this.i, acc = 0;
      let SS = S, leg = this.leg;
      while (acc < dist) {
        if (k + 1 >= SS.length) {
          if (leg + 1 >= this.legs.length) break;
          leg++; const L = this.legs[leg]; const R = roadById[L.id].samples; SS = L.reverse ? R.slice().reverse() : R; k = 0;
        }
        acc += Math.hypot(SS[k + 1].x - SS[k].x, SS[k + 1].z - SS[k].z); k++;
      }
      return { o: SS[k], rev: this.legs[leg].reverse, kind: roadById[this.legs[leg].id].kindName };
    };
    const { o, rev, kind } = ahead(look);
    const lane = kind === 'pref' ? this.lane : 0;
    const sgn = rev ? -1 : 1;
    const tx = o.x + o.rx * lane * sgn, tz = o.z + o.rz * lane * sgn;
    const f = car.fwd(), r = car.right();
    const dx = tx - p.x, dz = tz - p.z;
    const lx = dx * r.x + dz * r.z, lz = dx * f.x + dz * f.z;
    const L2 = lx * lx + lz * lz;
    const curv = 2 * lx / Math.max(1, L2);
    const delta = Math.atan(curv * 2.43);
    const lim = car.steerLimit(true);
    const steer = Math.max(-1, Math.min(1, delta / lim));
    // 先のカーブの強さから速さを決める
    let maxCurv = 0;
    const a0 = ahead(5), a1 = ahead(25 + v * 1.5);
    const h0 = Math.atan2(a0.o.tx, a0.o.tz), h1 = Math.atan2(a1.o.tx, a1.o.tz);
    let dh = Math.abs(h1 - h0); if (dh > Math.PI) dh = 2 * Math.PI - dh;
    maxCurv = dh / (20 + v * 1.5);
    const vt = Math.min(this.maxKmh / 3.6, Math.sqrt(3.0 / Math.max(1e-4, maxCurv)));
    const err = vt - v;
    return {
      throttle: err > 0 ? Math.min(1, err * 0.35) : 0,
      brake: err < -1.5 ? Math.min(1, -err * 0.15) : 0,
      steer, analogSteer: true,
    };
  }
}

export const MAIN_ROUTE = [{ id: 'r1' }, { id: 'r3' }, { id: 'r5' }, { id: 'r6' }, { id: 'r7' }, { id: 'r9' }];
