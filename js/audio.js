// 音(すべてプログラムで合成)。あとで録音したエンジン音に差し替えられるように、エンジンは1か所にまとめている
export class Audio {
  constructor() {
    this.ctx = null;
    this.vol = 0.8;
  }
  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const C = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = C.createGain(); this.master.gain.value = this.vol; this.master.connect(C.destination);
    // 車内は高い音がこもる
    this.cabin = C.createBiquadFilter(); this.cabin.type = 'lowpass'; this.cabin.frequency.value = 2600;
    this.cabin.connect(this.master);
    // ノイズの素
    const nb = C.createBuffer(1, C.sampleRate * 2, C.sampleRate), d = nb.getChannelData(0);
    let b = 0;
    for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; b = (b + 0.02 * w) / 1.02; d[i] = w * 0.5 + b * 3; }
    this.noiseBuf = nb;
    const grain = C.createBuffer(1, Math.floor(C.sampleRate * 0.03), C.sampleRate), gd = grain.getChannelData(0);
    for (let i = 0; i < gd.length; i++) gd[i] = (Math.random() * 2 - 1) * Math.exp(-i / (gd.length * 0.15));
    this.grainBuf = grain;
    const noise = (filterType, freq, q = 0.7) => {
      const s = C.createBufferSource(); s.buffer = nb; s.loop = true; s.playbackRate.value = 0.8 + Math.random() * 0.4;
      const f = C.createBiquadFilter(); f.type = filterType; f.frequency.value = freq; f.Q.value = q;
      const g = C.createGain(); g.gain.value = 0;
      s.connect(f); f.connect(g); s.start();
      return { s, f, g };
    };

    // ---- エンジン:点火の音(4気筒なので 1回転に2回)を、のこぎり波と矩形波とノイズで作る
    const E = this.engine = {};
    E.out = C.createGain(); E.out.gain.value = 0;
    E.shaper = C.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 2.2); }
    E.shaper.curve = curve;
    E.lp = C.createBiquadFilter(); E.lp.type = 'lowpass'; E.lp.Q.value = 1.2;
    E.mix = C.createGain(); E.mix.gain.value = 0.5;
    E.mix.connect(E.shaper); E.shaper.connect(E.lp); E.lp.connect(E.out); E.out.connect(this.cabin);
    E.o1 = C.createOscillator(); E.o1.type = 'sawtooth';
    E.o2 = C.createOscillator(); E.o2.type = 'square';
    E.o3 = C.createOscillator(); E.o3.type = 'sawtooth';
    E.g1 = C.createGain(); E.g1.gain.value = 0.5; E.g2 = C.createGain(); E.g2.gain.value = 0.22; E.g3 = C.createGain(); E.g3.gain.value = 0.18;
    E.o1.connect(E.g1); E.o2.connect(E.g2); E.o3.connect(E.g3);
    E.g1.connect(E.mix); E.g2.connect(E.mix); E.g3.connect(E.mix);
    // 燃焼のざらつき(点火の周期でふるえるノイズ)
    const en = noise('bandpass', 900, 1.5);
    E.noise = en; E.am = C.createGain(); E.am.gain.value = 0;
    en.g.gain.value = 1; en.g.disconnect(); en.g.connect(E.am); E.am.connect(E.mix);
    E.lfo = C.createOscillator(); E.lfo.type = 'square'; E.lfoG = C.createGain(); E.lfoG.gain.value = 0.3;
    E.lfo.connect(E.lfoG); E.lfoG.connect(E.am.gain);
    for (const o of [E.o1, E.o2, E.o3, E.lfo]) o.start();
    // セルモーター
    E.starter = C.createOscillator(); E.starter.type = 'sawtooth'; E.starter.frequency.value = 150;
    E.starterG = C.createGain(); E.starterG.gain.value = 0;
    E.starterLfo = C.createOscillator(); E.starterLfo.frequency.value = 11; const sl = C.createGain(); sl.gain.value = 0.5;
    E.starterLfo.connect(sl); sl.connect(E.starterG.gain);
    const sf = C.createBiquadFilter(); sf.type = 'lowpass'; sf.frequency.value = 700;
    E.starter.connect(sf); sf.connect(E.starterG); E.starterG.connect(this.cabin);
    E.starter.start(); E.starterLfo.start();

    // ---- 雨(屋根とガラスを打つ音)、道路のシャー音、風
    this.rain = noise('lowpass', 2400); this.rain.g.connect(this.master);
    this.rainHi = noise('highpass', 3500); this.rainHi.g.connect(this.master);
    this.road = noise('bandpass', 700, 0.8); this.road.g.connect(this.cabin);
    this.wind = noise('lowpass', 380); this.wind.g.connect(this.cabin);
    this.squeal = C.createOscillator(); this.squeal.type = 'triangle'; this.squeal.frequency.value = 820;
    this.squealG = C.createGain(); this.squealG.gain.value = 0; this.squeal.connect(this.squealG); this.squealG.connect(this.cabin); this.squeal.start();
    this.dropAcc = 0;
    // ワイパーのモーター
    this.wiper = C.createOscillator(); this.wiper.type = 'sawtooth'; this.wiper.frequency.value = 72;
    const wf = C.createBiquadFilter(); wf.type = 'lowpass'; wf.frequency.value = 260;
    this.wiperG = C.createGain(); this.wiperG.gain.value = 0;
    this.wiper.connect(wf); wf.connect(this.wiperG); this.wiperG.connect(this.cabin); this.wiper.start();
    this.nextCicada = 3; this.nextFrog = 5;
    this.t = 0;
  }

  setVolume(v) { this.vol = v; if (this.master) this.master.gain.value = v; }

  // 短い音
  burst({ freq = 200, dur = 0.15, gain = 0.4, type = 'noise', filter = 'lowpass', fq = 800, to = this.cabin, pitchTo = null, when = 0 }) {
    const C = this.ctx; if (!C) return;
    const t0 = C.currentTime + when;
    const g = C.createGain(); g.gain.setValueAtTime(gain, t0); g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    let src;
    if (type === 'noise') { src = C.createBufferSource(); src.buffer = this.noiseBuf; src.playbackRate.value = 0.6 + Math.random() * 0.8; }
    else { src = C.createOscillator(); src.type = type; src.frequency.setValueAtTime(freq, t0); if (pitchTo) src.frequency.exponentialRampToValueAtTime(pitchTo, t0 + dur); }
    const f = C.createBiquadFilter(); f.type = filter; f.frequency.value = fq;
    src.connect(f); f.connect(g); g.connect(to);
    src.start(t0); src.stop(t0 + dur + 0.05);
  }
  click() { this.burst({ type: 'square', freq: 1800, dur: 0.025, gain: 0.08, fq: 4000, filter: 'lowpass' }); }
  clunk() { this.burst({ type: 'sine', freq: 140, pitchTo: 60, dur: 0.12, gain: 0.35 }); this.burst({ dur: 0.06, gain: 0.15, fq: 1500 }); }
  impact(v) {
    const k = Math.min(1, v / 12);
    this.burst({ dur: 0.25 + k * 0.3, gain: 0.3 + k * 0.6, fq: 600 + k * 1800 });
    this.burst({ type: 'sine', freq: 90, pitchTo: 40, dur: 0.3, gain: 0.5 * k + 0.2 });
    if (k > 0.5) this.burst({ dur: 0.6, gain: 0.15, fq: 5000, filter: 'highpass', when: 0.04 });
  }
  splash(k) { this.burst({ dur: 0.5, gain: Math.min(0.6, k), fq: 1200, to: this.master }); }
  pump() { this.burst({ type: 'sawtooth', freq: 95, dur: 1.2, gain: 0.08, fq: 400 }); }

  update(dt, s) {
    const C = this.ctx; if (!C) return;
    const now = C.currentTime;
    this.t += dt;
    const set = (p, v, tc = 0.05) => p.setTargetAtTime(v, now, tc);
    // 車内か外か
    set(this.cabin.frequency, s.inside ? 2400 : 9000, 0.1);
    // ---- エンジン
    const E = this.engine;
    const rpm = Math.max(0, s.rpm);
    const f = rpm / 60 * 2;
    const jit = 1 + (Math.random() - 0.5) * 0.02;
    set(E.o1.frequency, Math.max(4, f * jit), 0.02);
    set(E.o2.frequency, Math.max(2, f / 2 * jit), 0.02);
    set(E.o3.frequency, Math.max(4, f * 2.01), 0.02);
    set(E.lfo.frequency, Math.max(2, f), 0.02);
    set(E.noise.f.frequency, 500 + rpm * 0.35, 0.05);
    const load = s.running ? 0.35 + s.throttle * 0.65 : 0;
    set(E.lp.frequency, 180 + rpm * 0.22 + s.throttle * 900 + (s.inside ? 0 : 900), 0.05);
    set(E.mix.gain, 0.35 + s.throttle * 0.4, 0.05);
    const on = s.running || rpm > 60;
    set(E.out.gain, on ? (0.07 + load * 0.12) * Math.min(1, rpm / 600) * (s.inTunnel ? 1.5 : 1) : 0, 0.06);
    set(E.starterG.gain, s.cranking ? 0.12 : 0, 0.02);
    set(E.starter.frequency, 120 + rpm * 0.25, 0.05);

    // ---- 雨
    const r = s.inTunnel ? 0.05 : s.rain;
    set(this.rain.g.gain, r * (s.inside ? 0.22 : 0.3), 0.3);
    set(this.rainHi.g.gain, r * (s.inside ? 0.035 : 0.09), 0.3);
    // 屋根をたたく粒の音
    if (s.inside && !s.inTunnel) {
      this.dropAcc += dt * r * 70;
      while (this.dropAcc > 1) {
        this.dropAcc--;
        const src = C.createBufferSource(); src.buffer = this.grainBuf; src.playbackRate.value = 0.5 + Math.random() * 1.6;
        const g = C.createGain(); g.gain.value = 0.02 + Math.random() * 0.05;
        const f2 = C.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 900 + Math.random() * 2200;
        src.connect(f2); f2.connect(g); g.connect(this.master);
        src.start(now + Math.random() * dt);
      }
    }
    // ---- 道路と風
    const v = s.speed;
    set(this.road.g.gain, Math.min(0.5, v / 30) * (0.18 + s.wet * 0.2) * (s.offroad ? 1.6 : 1), 0.1);
    set(this.road.f.frequency, s.offroad ? 300 : 650 + v * 12, 0.2);
    set(this.wind.g.gain, Math.min(0.4, (v / 30) ** 2 * 0.25), 0.2);
    set(this.squealG.gain, Math.min(0.05, s.slide * 0.06) * (s.wet > 0.5 ? 0.4 : 1), 0.05);
    set(this.squeal.frequency, 760 + Math.sin(this.t * 31) * 25, 0.02);
    set(this.wiperG.gain, s.wiperMoving ? 0.05 : 0, 0.05);
    if (s.wiperTurn) this.burst({ type: 'sine', freq: 70, dur: 0.07, gain: 0.12 });

    // ---- ヒグラシ(夕方)とカエル(夜)
    this.nextCicada -= dt;
    if (this.nextCicada <= 0) {
      this.nextCicada = 6 + Math.random() * 12;
      if (s.daylight > 0.45 && !s.inTunnel && s.rain < 0.85) this.cicada(0.06 * s.daylight * (1 - s.rain * 0.6));
    }
    this.nextFrog -= dt;
    if (this.nextFrog <= 0) {
      this.nextFrog = 1.5 + Math.random() * 4;
      if (s.daylight < 0.6 && !s.inTunnel) this.frog(0.04 * (1 - s.daylight));
    }
  }

  // カナカナカナ…(高い音がふるえながら、少しずつ下がって弱くなる)
  cicada(gain) {
    const C = this.ctx, t0 = C.currentTime + 0.05;
    const pan = C.createStereoPanner ? C.createStereoPanner() : null;
    const out = C.createGain(); out.gain.value = gain;
    if (pan) { pan.pan.value = Math.random() * 1.6 - 0.8; out.connect(pan); pan.connect(this.master); } else out.connect(this.master);
    const n = 14 + Math.floor(Math.random() * 10);
    const base = 4300 + Math.random() * 500;
    for (let i = 0; i < n; i++) {
      const t = t0 + i * 0.16;
      const o = C.createOscillator(); o.type = 'sine';
      const f0 = base * (1 - i / n * 0.12);
      o.frequency.setValueAtTime(f0 * 1.04, t); o.frequency.exponentialRampToValueAtTime(f0 * 0.93, t + 0.12);
      const am = C.createOscillator(); am.frequency.value = 90; const amg = C.createGain(); amg.gain.value = 0.5;
      const g = C.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1 - i / n * 0.7, t + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
      am.connect(amg); amg.connect(g.gain);
      o.connect(g); g.connect(out);
      o.start(t); o.stop(t + 0.15); am.start(t); am.stop(t + 0.15);
    }
  }
  frog(gain) {
    const C = this.ctx, t0 = C.currentTime + 0.02;
    const out = C.createGain(); out.gain.value = gain;
    const pan = C.createStereoPanner ? C.createStereoPanner() : null;
    if (pan) { pan.pan.value = Math.random() * 1.6 - 0.8; out.connect(pan); pan.connect(this.master); } else out.connect(this.master);
    const n = 2 + Math.floor(Math.random() * 4), f = 380 + Math.random() * 300;
    for (let i = 0; i < n; i++) {
      const t = t0 + i * 0.22;
      const o = C.createOscillator(); o.type = 'square'; o.frequency.setValueAtTime(f, t); o.frequency.linearRampToValueAtTime(f * 0.8, t + 0.12);
      const lp = C.createBiquadFilter(); lp.type = 'bandpass'; lp.frequency.value = f * 2; lp.Q.value = 4;
      const g = C.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + 0.015); g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
      o.connect(lp); lp.connect(g); g.connect(out); o.start(t); o.stop(t + 0.16);
    }
  }
}
