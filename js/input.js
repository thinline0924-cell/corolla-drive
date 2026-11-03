// 操作:キーボード(PC)と、画面のスライダー・ペダル(スマホ)
export const KEYS = [
  ['W / ↑', 'アクセル'], ['S / ↓', 'ブレーキ'], ['A D / ← →', 'ハンドル'], ['Space', 'サイドブレーキ'],
  ['K(長押し)', 'エンジンをかける / 押すと止める'], ['E / Q', 'レバーを手前へ / 奥へ(MT:シフトアップ / ダウン)'],
  ['O', 'O/D OFF(AT)'], ['Shift', 'クラッチ(MT・手動クラッチのとき)'],
  ['L', 'ライト(消す → 車幅灯 → 前照灯)'], ['H', 'ハイビーム'], ['X', 'ワイパー(切 → 間欠 → 低速 → 高速)'],
  ['F', '曇り止め'], ['R', '室内灯'], ['C(押しているあいだ)', 'コマ図を見る'], ['T', 'トリップメーターを 0 に戻す'],
  ['V', '視点(運転席 → ボンネット → 車の後ろ)'], ['Backspace', '少し手前からやり直す'], ['Tab', '操作表を出す / しまう'], ['Esc', '一時停止'],
];

// 運転中に出す操作表(短く、まとめて)。mt = MT のとき、manual = 手動クラッチのとき
export function keyCard(mt, manual) {
  return [
    ['運転', [['W  S', 'アクセル / ブレーキ'], ['A  D', 'ハンドル'], ['Space', 'サイドブレーキ']]],
    ['エンジンと変速', [
      ['K', '長押しでかける / 押すと止める'],
      mt ? ['E  Q', 'シフトアップ / ダウン'] : ['E  Q', 'レバーを手前 / 奥へ(P R N D 2 L)'],
      mt ? (manual ? ['Shift', 'クラッチ'] : ['', 'クラッチは自動']) : ['O', 'O/D OFF'],
    ]],
    ['装備', [['L  H', 'ライト / ハイビーム'], ['X', 'ワイパー'], ['F', '曇り止め'], ['R', '室内灯']]],
    ['見る', [['C', 'コマ図(押しているあいだ)'], ['T', 'トリップを 0 に'], ['V', '視点']]],
    ['そのほか', [['Backspace', '少し手前からやり直す'], ['Esc', '一時停止'], ['Tab', 'この表をしまう']]],
  ];
}
export const TOUCH_CARD = [
  ['運転', [['左下のつまみ', 'ハンドル(左右に動かす)'], ['右下のペダル', 'ブレーキ / アクセル(上を押すほど強い)'], ['▲ ▼', 'レバー(MT はシフト)']]],
  ['ボタン', [['エンジン', '長押しでかける / 押すと止める'], ['ライト', '消す → 車幅灯 → 前照灯'], ['ワイパー', '切 → 間欠 → 低速 → 高速'], ['曇り止め', 'ガラスのくもりを取る'], ['室内灯', '夜にコマ図を読む'], ['コマ図', '押しているあいだ手元を見る'], ['視点', '運転席 → ボンネット → 後ろ']]],
];

export class Input {
  constructor() {
    this.down = new Set();
    this.handlers = {};
    this.touch = { steer: 0, throttle: 0, brake: 0, active: false };
    this.enabled = false;
    addEventListener('keydown', e => {
      if (e.repeat) { if (this.enabled && this.isGameKey(e.code)) e.preventDefault(); return; }
      this.down.add(e.code);
      if (this.enabled && this.isGameKey(e.code)) e.preventDefault();
      this.fire('down', e.code);
    });
    addEventListener('keyup', e => { this.down.delete(e.code); this.fire('up', e.code); });
    addEventListener('blur', () => { this.down.clear(); });
  }
  isGameKey(c) { return /^(Arrow|Space|Backspace|Tab|Key[A-Z]|Shift)/.test(c); }
  on(type, fn) { (this.handlers[type] ||= []).push(fn); }
  fire(type, code) { for (const f of this.handlers[type] || []) f(code); }
  has(...codes) { return codes.some(c => this.down.has(c)); }

  // 運転の入力(キーボードとスマホを合わせる)
  read() {
    const k = (a, b) => this.has(a, b) ? 1 : 0;
    let steer = k('KeyD', 'ArrowRight') - k('KeyA', 'ArrowLeft');
    let throttle = k('KeyW', 'ArrowUp'), brake = k('KeyS', 'ArrowDown');
    let analog = false;
    if (this.touch.active) {
      if (Math.abs(this.touch.steer) > 0.02) { steer = this.touch.steer; analog = true; }
      throttle = Math.max(throttle, this.touch.throttle);
      brake = Math.max(brake, this.touch.brake);
    }
    return {
      steer, throttle, brake, analogSteer: analog,
      handbrake: this.has('Space') || this.touch.handbrake,
      clutch: this.has('ShiftLeft', 'ShiftRight'),
    };
  }

  // スマホの操作部品をつなぐ
  bindTouch(root, actions) {
    const slider = root.querySelector('[data-t=steer]'), thumb = slider.querySelector('.thumb');
    let steerId = null;
    const setSteer = (x) => {
      const r = slider.getBoundingClientRect();
      const v = Math.max(-1, Math.min(1, ((x - r.left) / r.width) * 2 - 1));
      this.touch.steer = Math.sign(v) * Math.min(1, Math.abs(v) * 1.1);
      thumb.style.transform = `translateX(${v * (r.width / 2 - thumb.offsetWidth / 2)}px)`;
    };
    slider.addEventListener('pointerdown', e => { steerId = e.pointerId; slider.setPointerCapture(e.pointerId); setSteer(e.clientX); this.touch.active = true; });
    slider.addEventListener('pointermove', e => { if (e.pointerId === steerId) setSteer(e.clientX); });
    const release = e => { if (e.pointerId !== steerId) return; steerId = null; this.touch.steer = 0; thumb.style.transform = ''; };
    slider.addEventListener('pointerup', release); slider.addEventListener('pointercancel', release);
    for (const [name, key] of [['gas', 'throttle'], ['brake', 'brake']]) {
      const el = root.querySelector(`[data-t=${name}]`);
      const set = (v) => { this.touch[key] = v; el.classList.toggle('on', v > 0); };
      el.addEventListener('pointerdown', e => {
        el.setPointerCapture(e.pointerId); this.touch.active = true;
        // 上のほうを押すほど強く
        const r = el.getBoundingClientRect();
        set(Math.min(1, 0.45 + (1 - (e.clientY - r.top) / r.height) * 0.75));
      });
      el.addEventListener('pointermove', e => {
        if (!this.touch[key]) return;
        const r = el.getBoundingClientRect();
        set(Math.min(1, Math.max(0.3, 0.45 + (1 - (e.clientY - r.top) / r.height) * 0.75)));
      });
      const off = () => set(0);
      el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off);
    }
    for (const el of root.querySelectorAll('[data-a]')) {
      const a = el.dataset.a;
      el.addEventListener('pointerdown', e => { e.preventDefault(); el.classList.add('on'); actions(a, true); });
      const up = () => { el.classList.remove('on'); actions(a, false); };
      el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('pointerleave', up);
    }
  }
}
