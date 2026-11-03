// 音(すべてプログラムで作る)
//
// エンジン:電子音の波(のこぎり波など)は使わない。燃焼1回ごとの「ボッ」という音を、排気管の響き(いくつかの共鳴)に
// 通した数秒の音を、回転数ごとに前もって作っておく。走っているときは、いまの回転数に近い2つを混ぜ、再生の速さで合わせる
// (録音した音を使うときと同じやり方。あとで録音に差し替えるときは ENGINE_BASES の音を置きかえる)
// 雨・道路・風:ピンクノイズ(自然の音に近い、低い音の多いざわざわ)を使う

const ENGINE_BASES = [900, 1800, 3200, 5200];   // 用意する回転数

export class Audio {
  constructor() {
    this.ctx = null;
    this.vol = 0.6;
  }

  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const C = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    const sr = C.sampleRate;
    // 全体:急に大きな音が出ないように、コンプレッサー(音量をならす装置)を通す
    this.comp = C.createDynamicsCompressor();
    this.comp.threshold.value = -20; this.comp.knee.value = 18; this.comp.ratio.value = 4;
    this.master = C.createGain(); this.master.gain.value = this.vol * 0.55;
    this.comp.connect(this.master); this.master.connect(C.destination);
    // 車内:高い音がこもる
    this.cabin = C.createBiquadFilter(); this.cabin.type = 'lowpass'; this.cabin.frequency.value = 2200; this.cabin.Q.value = 0.5;
    this.cabin.connect(this.comp);

    // ---- ピンクノイズ(3秒、くり返し)
    const pink = C.createBuffer(1, sr * 3, sr), pd = pink.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < pd.length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      pd[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
    }
    loopFade(pd, sr * 0.05);
    this.pink = pink;
    // 雨粒が当たる音のもと(とても短い音)
    const grain = C.createBuffer(1, Math.floor(sr * 0.012), sr), gd = grain.getChannelData(0);
    for (let i = 0; i < gd.length; i++) gd[i] = (Math.random() * 2 - 1) * Math.exp(-i / (gd.length * 0.12));
    this.grainBuf = grain;

    const bed = (type, freq, q, to) => {
      const s = C.createBufferSource(); s.buffer = pink; s.loop = true;
      s.loopStart = Math.random() * 2;
      const f = C.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = C.createGain(); g.gain.value = 0;
      s.connect(f); f.connect(g); g.connect(to);
      s.start(0, Math.random() * 2);
      return { s, f, g };
    };

    // ---- エンジン
    const E = this.engine = { layers: [] };
    E.out = C.createGain(); E.out.gain.value = 0;
    E.tone = C.createBiquadFilter(); E.tone.type = 'lowpass'; E.tone.frequency.value = 1500; E.tone.Q.value = 0.4;
    E.tone.connect(E.out); E.out.connect(this.cabin);
    for (const base of ENGINE_BASES) {
      const layer = { base };
      for (const load of [1, 0]) {
        const buf = C.createBuffer(1, sr * 3, sr);
        synthEngine(buf.getChannelData(0), sr, base, load);
        const s = C.createBufferSource(); s.buffer = buf; s.loop = true;
        const g = C.createGain(); g.gain.value = 0;
        s.connect(g); g.connect(E.tone); s.start(0, Math.random() * 2);
        layer[load ? 'on' : 'off'] = { s, g };
      }
      E.layers.push(layer);
    }
    // セルモーター(キュルキュル+圧縮の重い音)
    const st = C.createBuffer(1, sr * 2, sr);
    synthStarter(st.getChannelData(0), sr);
    E.starter = C.createBufferSource(); E.starter.buffer = st; E.starter.loop = true;
    E.starterG = C.createGain(); E.starterG.gain.value = 0;
    E.starter.connect(E.starterG); E.starterG.connect(this.cabin); E.starter.start();
    E.load = 0;

    // ---- 雨(遠くのざわざわ+屋根とガラスに当たる粒)
    this.rain = bed('bandpass', 1400, 0.35, this.comp);
    this.rainLow = bed('lowpass', 500, 0.5, this.comp);
    this.dropAcc = 0;
    // 道路(濡れた路面のシャー)と風
    this.road = bed('bandpass', 900, 0.6, this.cabin);
    this.wind = bed('lowpass', 420, 0.5, this.cabin);
    this.squeal = bed('bandpass', 1100, 6, this.cabin);
    // ワイパーのモーター(小さなうなり)
    this.wiper = bed('lowpass', 260, 1.5, this.cabin);
    this.nextCicada = 4; this.nextFrog = 6;
    this.t = 0;
  }

  setVolume(v) { this.vol = v; if (this.master) this.master.gain.value = v * 0.55; }

  // 短い音(ノイズかサイン波を、フィルターに通す)
  burst({ freq = 200, dur = 0.15, gain = 0.3, type = 'noise', filter = 'lowpass', fq = 800, q = 0.7, to = this.cabin, pitchTo = null, when = 0 }) {
    const C = this.ctx; if (!C) return;
    const t0 = C.currentTime + when;
    const g = C.createGain();
    g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(gain, t0 + Math.min(0.006, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let src;
    if (type === 'noise') { src = C.createBufferSource(); src.buffer = this.pink; src.playbackRate.value = 0.7 + Math.random() * 0.6; src.start(t0, Math.random() * 2); }
    else { src = C.createOscillator(); src.type = type; src.frequency.setValueAtTime(freq, t0); if (pitchTo) src.frequency.exponentialRampToValueAtTime(pitchTo, t0 + dur); src.start(t0); }
    const f = C.createBiquadFilter(); f.type = filter; f.frequency.value = fq; f.Q.value = q;
    src.connect(f); f.connect(g); g.connect(to);
    src.stop(t0 + dur + 0.05);
  }
  // スイッチのカチッ(プラスチックの小さな音)
  click() { this.burst({ dur: 0.03, gain: 0.12, fq: 2600, filter: 'bandpass', q: 1.2 }); this.burst({ dur: 0.02, gain: 0.05, fq: 5000, filter: 'highpass', when: 0.012 }); }
  clunk() { this.burst({ type: 'sine', freq: 110, pitchTo: 55, dur: 0.12, gain: 0.18 }); this.burst({ dur: 0.05, gain: 0.08, fq: 900 }); }
  impact(v) {
    const k = Math.min(1, v / 12);
    this.burst({ dur: 0.18 + k * 0.3, gain: 0.25 + k * 0.45, fq: 500 + k * 1500 });
    this.burst({ type: 'sine', freq: 85, pitchTo: 40, dur: 0.25, gain: 0.2 + k * 0.35 });
    if (k > 0.5) this.burst({ dur: 0.5, gain: 0.08, fq: 4000, filter: 'highpass', when: 0.04 });
  }
  splash(k) { this.burst({ dur: 0.6, gain: Math.min(0.4, k * 0.6), fq: 1000, filter: 'bandpass', q: 0.5, to: this.comp }); }
  pump() { this.burst({ dur: 1.4, gain: 0.05, fq: 300, filter: 'bandpass', q: 3 }); }

  update(dt, s) {
    const C = this.ctx; if (!C) return;
    const now = C.currentTime;
    this.t += dt;
    const set = (p, v, tc = 0.05) => p.setTargetAtTime(v, now, tc);
    set(this.cabin.frequency, s.inside ? 2200 : 7000, 0.15);

    // ---- エンジン:いまの回転数に近い2つの音を混ぜる
    const E = this.engine;
    const rpm = Math.max(0, s.rpm);
    const on = s.running || rpm > 80;
    E.load += ((s.running ? Math.max(0.12, s.throttle) : 0) - E.load) * Math.min(1, dt * 6);
    const lr = Math.log(Math.max(300, rpm));
    const B = ENGINE_BASES.map(Math.log);
    for (let i = 0; i < E.layers.length; i++) {
      const L = E.layers[i];
      // 三角の重み(対数で)
      let w = 0;
      if (i > 0 && lr >= B[i - 1] && lr <= B[i]) w = (lr - B[i - 1]) / (B[i] - B[i - 1]);
      else if (i < B.length - 1 && lr >= B[i] && lr <= B[i + 1]) w = 1 - (lr - B[i]) / (B[i + 1] - B[i]);
      else if ((i === 0 && lr < B[0]) || (i === B.length - 1 && lr > B[B.length - 1])) w = 1;
      const rate = Math.max(0.2, rpm / L.base);
      set(L.on.s.playbackRate, rate, 0.03); set(L.off.s.playbackRate, rate, 0.03);
      set(L.on.g.gain, w * E.load, 0.05);
      set(L.off.g.gain, w * (1 - E.load) * 0.8, 0.05);
    }
    set(E.tone.frequency, 600 + rpm * 0.18 + E.load * 900 + (s.inside ? 0 : 1200), 0.08);
    set(E.out.gain, on ? 0.5 * Math.min(1, rpm / 500) * (s.inTunnel ? 1.4 : 1) : 0, 0.08);
    set(E.starterG.gain, s.cranking ? 0.28 : 0, 0.03);

    // ---- 雨
    const r = s.inTunnel ? 0.03 : s.rain;
    set(this.rain.g.gain, r * (s.inside ? 0.05 : 0.09), 0.4);
    set(this.rainLow.g.gain, r * (s.inside ? 0.07 : 0.05), 0.4);
    // 屋根とガラスに当たる粒(車内でいちばん大きく聞こえる雨の音)
    if (!s.inTunnel) {
      this.dropAcc += dt * r * (s.inside ? 90 : 40);
      while (this.dropAcc > 1) {
        this.dropAcc--;
        const src = C.createBufferSource(); src.buffer = this.grainBuf; src.playbackRate.value = 0.35 + Math.random() * 0.9;
        const g = C.createGain(); g.gain.value = (0.012 + Math.random() * Math.random() * 0.05) * (s.inside ? 1 : 0.5);
        const f = C.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = (s.inside ? 700 : 1800) + Math.random() * 1600; f.Q.value = 0.9;
        src.connect(f); f.connect(g); g.connect(this.comp);
        src.start(now + Math.random() * dt);
      }
    }
    // ---- 道路と風
    const v = s.speed;
    set(this.road.g.gain, Math.min(1, v / 25) * (0.05 + s.wet * 0.07) * (s.offroad ? 1.5 : 1), 0.15);
    set(this.road.f.frequency, s.offroad ? 260 : 500 + v * 14, 0.3);
    set(this.wind.g.gain, Math.min(0.12, (v / 30) ** 2 * 0.06), 0.3);
    set(this.squeal.g.gain, Math.min(0.06, s.slide * 0.08) * (s.wet > 0.5 ? 0.5 : 1), 0.05);
    set(this.wiper.g.gain, s.wiperMoving ? 0.035 : 0, 0.06);
    if (s.wiperTurn) { this.burst({ type: 'sine', freq: 75, pitchTo: 55, dur: 0.07, gain: 0.05 }); this.burst({ dur: 0.05, gain: 0.02, fq: 2400, filter: 'bandpass', q: 3 }); }

    // ---- ヒグラシ(夕方)とカエル(夜)。遠くで小さく
    this.nextCicada -= dt;
    if (this.nextCicada <= 0) {
      this.nextCicada = 8 + Math.random() * 14;
      if (s.daylight > 0.45 && !s.inTunnel && s.rain < 0.85) this.cicada(0.018 * s.daylight * (1 - s.rain * 0.6) * (s.inside ? 0.6 : 1));
    }
    this.nextFrog -= dt;
    if (this.nextFrog <= 0) {
      this.nextFrog = 2 + Math.random() * 5;
      if (s.daylight < 0.6 && !s.inTunnel) this.frog(0.02 * (1 - s.daylight) * (s.inside ? 0.6 : 1));
    }
  }

  // カナカナカナ…(高い音がふるえながら少しずつ下がって弱くなる。遠くの木から)
  cicada(gain) {
    const C = this.ctx, t0 = C.currentTime + 0.05;
    const out = C.createGain(); out.gain.value = gain;
    const lp = C.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5200;
    const pan = C.createStereoPanner ? C.createStereoPanner() : null;
    out.connect(lp);
    if (pan) { pan.pan.value = Math.random() * 1.4 - 0.7; lp.connect(pan); pan.connect(this.comp); } else lp.connect(this.comp);
    const n = 12 + Math.floor(Math.random() * 10);
    const base = 4200 + Math.random() * 500;
    for (let i = 0; i < n; i++) {
      const t = t0 + i * (0.15 + Math.random() * 0.02);
      const f0 = base * (1 - i / n * 0.1);
      // 音のもと:ノイズを細いバンドパスに通す(笛のような純音より自然)
      const src = C.createBufferSource(); src.buffer = this.pink; src.playbackRate.value = 2;
      const bp = C.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 28;
      bp.frequency.setValueAtTime(f0 * 1.03, t); bp.frequency.exponentialRampToValueAtTime(f0 * 0.94, t + 0.12);
      const g = C.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime((1 - i / n * 0.75) * 6, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
      src.connect(bp); bp.connect(g); g.connect(out);
      src.start(t, Math.random() * 2); src.stop(t + 0.15);
    }
  }
  // カエル(低い「ゲロッ」を数回)
  frog(gain) {
    const C = this.ctx, t0 = C.currentTime + 0.02;
    const out = C.createGain(); out.gain.value = gain;
    const pan = C.createStereoPanner ? C.createStereoPanner() : null;
    if (pan) { pan.pan.value = Math.random() * 1.4 - 0.7; out.connect(pan); pan.connect(this.comp); } else out.connect(this.comp);
    const n = 2 + Math.floor(Math.random() * 4), f = 420 + Math.random() * 260;
    for (let i = 0; i < n; i++) {
      const t = t0 + i * (0.2 + Math.random() * 0.05);
      const src = C.createBufferSource(); src.buffer = this.pink; src.playbackRate.value = 1;
      const bp = C.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 9; bp.frequency.setValueAtTime(f, t); bp.frequency.linearRampToValueAtTime(f * 0.82, t + 0.1);
      // ふるえ(25回/秒)
      const am = C.createOscillator(); am.frequency.value = 26; const amg = C.createGain(); amg.gain.value = 0.5;
      const g = C.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(4, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      am.connect(amg); amg.connect(g.gain);
      src.connect(bp); bp.connect(g); g.connect(out);
      src.start(t, Math.random() * 2); src.stop(t + 0.14); am.start(t); am.stop(t + 0.14);
    }
  }
}

// ---------------------------------------------------------------- 音を前もって作る

// くり返したときにつなぎ目で「プツッ」といわないように、終わりと始まりを重ねる
function loopFade(d, n) {
  n = Math.floor(n);
  for (let i = 0; i < n; i++) {
    const t = i / n;
    d[i] = d[i] * t + d[d.length - n + i] * (1 - t);
  }
  // 最後の n サンプルは使わない代わりに、始まりとそっくりにしておく
  for (let i = 0; i < n; i++) d[d.length - n + i] = d[i];
}

// 2次のフィルター(共鳴)をかける
function resonate(src, sr, f, q, gain) {
  const w = 2 * Math.PI * f / sr, alpha = Math.sin(w) / (2 * q), cw = Math.cos(w);
  const a0 = 1 + alpha;
  const b0 = alpha / a0, b2 = -alpha / a0, a1 = -2 * cw / a0, a2 = (1 - alpha) / a0;
  const out = new Float32Array(src.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < src.length; i++) {
    const x = src[i];
    const y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    out[i] = y * gain;
  }
  return out;
}

// 4気筒エンジン:1回転に2回の燃焼。燃焼ごとに強さと間隔が少しずつちがう(機械らしい不ぞろい)
export function synthEngine(d, sr, rpm, load) {
  const n = d.length;
  const ex = new Float32Array(n);
  const interval = 60 / rpm / 2;
  const cyl = [1.0, 0.86, 0.95, 0.9];
  let t = 0, k = 0;
  while (t * sr < n) {
    const i0 = Math.floor(t * sr);
    const amp = (load ? 1 : 0.38) * cyl[k % 4] * (0.85 + Math.random() * 0.3);
    const len = Math.floor(sr * (load ? 0.006 : 0.004));
    for (let j = 0; j < len && i0 + j < n; j++) {
      const env = Math.exp(-j / (len * 0.25));
      ex[i0 + j] += amp * env * ((Math.random() * 2 - 1) * (load ? 0.75 : 0.5) + (j < len * 0.15 ? 1 : 0));
    }
    // アクセルを離しているときは、ときどき「パラッ」と小さくはじける
    if (!load && Math.random() < 0.025) {
      const p = i0 + Math.floor(Math.random() * interval * sr);
      for (let j = 0; j < sr * 0.003 && p + j < n; j++) ex[p + j] += (Math.random() * 2 - 1) * 0.5 * Math.exp(-j / (sr * 0.0008));
    }
    t += interval * (1 + (Math.random() - 0.5) * 0.035);
    k++;
  }
  // 排気管と車体の響き(回転数によらず決まった高さで響く)
  const parts = load
    ? [[85, 2.2, 1.0], [160, 3, 0.75], [310, 4, 0.45], [620, 3, 0.25], [1300, 2, 0.12]]
    : [[80, 2.5, 1.0], [150, 3, 0.6], [290, 4, 0.28], [600, 3, 0.1]];
  for (let i = 0; i < n; i++) d[i] = 0;
  for (const [f, q, g] of parts) {
    const r = resonate(ex, sr, f, q, g);
    for (let i = 0; i < n; i++) d[i] += r[i];
  }
  // こもった低い音(エンジンの重さ)
  let lp = 0;
  for (let i = 0; i < n; i++) { lp += (ex[i] - lp) * 0.02; d[i] += lp * 2.5; }
  // 大きさをそろえる
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(d[i]));
  const s = (load ? 0.8 : 0.55) / (peak || 1);
  for (let i = 0; i < n; i++) d[i] = Math.tanh(d[i] * s * 1.3) * 0.8;
  loopFade(d, sr * 0.04);
}

// セルモーター:モーターのうなり+ピストンが空気を押しつぶす周期(1秒に約8回)
export function synthStarter(d, sr) {
  const n = d.length;
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const comp = 0.55 + 0.45 * Math.sin(2 * Math.PI * 8.3 * t) ** 2;
    ph += 2 * Math.PI * (190 + 25 * Math.sin(2 * Math.PI * 8.3 * t)) / sr;
    d[i] = (Math.sin(ph) * 0.25 + Math.sin(ph * 2.01) * 0.12 + (Math.random() * 2 - 1) * 0.18) * comp;
  }
  const r = resonate(d, sr, 420, 1.2, 1);
  const r2 = resonate(d, sr, 120, 2, 0.8);
  for (let i = 0; i < n; i++) d[i] = (r[i] + r2[i]) * 0.9;
  loopFade(d, sr * 0.04);
}
