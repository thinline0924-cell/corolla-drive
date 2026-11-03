// 湯ノ沢まで:ゲームの本体(画面の切り替え、毎フレームの処理)
import * as THREE from 'three';
import { KEYS, Input, keyCard, TOUCH_CARD } from './input.js';
import { Audio } from './audio.js';

const $ = (s) => document.querySelector(s);
const wait = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const isTouch = matchMedia('(pointer: coarse)').matches;

// ------------------------------------------------------------ 設定(この端末だけに覚える)
const DEFAULTS = { trans: 'AT', autoClutch: true, abs: true, res: 360, vol: 0.6, hints: true };
const S = { ...DEFAULTS };
try { Object.assign(S, JSON.parse(localStorage.getItem('yunosawa-settings') || '{}')); } catch (e) { /* 保存できない環境 */ }
const save = () => { try { localStorage.setItem('yunosawa-settings', JSON.stringify(S)); } catch (e) { /* 何もしない */ } };
if (isTouch) S.autoClutch = true;

const loadBar = (p, text) => { $('#load-bar').style.width = (p * 100) + '%'; if (text) $('#load-text').textContent = text; };

// ------------------------------------------------------------ 起動
let W, C, scenery, carMod, cockpitMod, render, rainMod, skyMod, autop, T;
let step = '';
// このブラウザで 3D 表示(WebGL2)が使えるか
function webglSupport() {
  try {
    const c = document.createElement('canvas');
    if (c.getContext('webgl2')) return 2;
    if (c.getContext('webgl') || c.getContext('experimental-webgl')) return 1;
  } catch (e) { /* 使えない */ }
  return 0;
}
async function boot() {
  step = '3D表示の確認';
  const gl = webglSupport();
  if (gl < 2) throw Object.assign(new Error(gl === 1 ? 'WebGL2 not available (WebGL1 only)' : 'WebGL not available'), { kind: 'webgl', gl });
  step = '山のデータ';
  loadBar(0.05, '山を作っています');
  await wait();
  W = await import('./world.js');
  loadBar(0.4, '景色を並べています');
  await wait();
  step = 'プログラムの読み込み';
  [scenery, carMod, cockpitMod, render, rainMod, skyMod, autop, C, T] = await Promise.all([
    import('./scenery.js'), import('./carmodel.js'), import('./cockpit.js'), import('./render.js'),
    import('./rain.js'), import('./sky.js'), import('./autopilot.js'), import('./car.js'), import('./textures.js'),
  ]);
  step = '景色の組み立て';
  setup();
  loadBar(0.75, '車を用意しています');
  await wait();
  step = '車のモデル';
  await setupCar();
  step = 'タイトル画面';
  loadBar(1, '');
  await wait();
  $('#loading').classList.add('hidden');
  toTitle();
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------ 場面
let scene, world, sky, rain, R, camera, ckCam, car, model, ck, ws, headL, tailL, pool;
const input = new Input();
const audio = new Audio();
audio.setVolume(S.vol);
const PAINT = '#a3a6a5';

function setup() {
  scene = new THREE.Scene();
  world = scenery.buildWorld(scene);
  sky = skyMod.createSky(scene);
  rain = rainMod.createRain(scene);
  R = new render.Renderer($('#view'));
  camera = new THREE.PerspectiveCamera(56, 16 / 9, 0.08, 1400);
  ckCam = new THREE.PerspectiveCamera(56, 16 / 9, 0.02, 10);
  // 前照灯(左右2つ)とテールランプ、近くの明かり(3つを使い回す)
  headL = [-1, 1].map(() => { const L = new THREE.SpotLight('#ffe8c0', 0, 90, 0.42, 0.6, 1.3); scene.add(L, L.target); return L; });
  tailL = new THREE.PointLight('#ff2010', 0, 7, 2); scene.add(tailL);
  pool = [0, 1, 2].map(() => { const L = new THREE.PointLight('#ffffff', 0, 10, 1.6); scene.add(L); return L; });
  ws = new render.Windshield();
  addEventListener('resize', resize);
  resize();
}

function resize() {
  const w = innerWidth, h = innerHeight;
  R.resize(w, h, S.res);
  camera.aspect = ckCam.aspect = w / h;
  camera.updateProjectionMatrix(); ckCam.updateProjectionMatrix();
}

async function setupCar() {
  model = await carMod.loadCarModel('assets/car/e80.glb', PAINT);
  scene.add(model.group);
  ck = cockpitMod.buildCockpit(PAINT);
  R.setGlass(ck.glassGeo);
  const tex = T.komazuTexture({ name: 'No. 3 ― 湯ノ沢 行き' }, W.routeRows());
  ck.paperMat.map = tex; ck.paperMat.needsUpdate = true;
  car = new C.Car({ trans: S.trans, autoClutch: S.autoClutch, abs: S.abs });
  placeAtStart();
}

// ------------------------------------------------------------ ゲームの状態
const G = {
  state: 'loading', view: 0, clock: 18.4, rain: 0.6, rainTarget: 0.6, rainTimer: 20, flood: 0.15,
  fog: 0.1, defrost: false, room: false, lights: 0, high: false,
  wiperMode: 0, wiperAng: 0, wiperDir: 0, wiperWait: 0,
  komazu: 0, komazuHeld: false, keyOn: false, fade: 0, fadeTo: 0, onFade: null,
  crumbs: [], crumbT: 0, fallT: 0, shake: 0, startOdo: 0, startClock: 18.4, realTime: 0,
  tunnel: 0, refuel: 0, out: false, hinted: {}, titleT: 0, head: new THREE.Vector3(),
};

function placeAtStart() {
  const S0 = W.roadById.r1.samples, o = S0[5];
  car.reset(o.x - o.rx * 1.6, o.y, o.z - o.rz * 1.6, Math.atan2(-o.tx, -o.tz));
  car.engine.running = false; car.engine.omega = 0;
  car.setTransmission(S.trans); car.autoClutch = S.autoClutch; car.abs = S.abs;
  car.fuel = 3.2; car.trip = 0; car.odo = 128734 + Math.random() * 200;
  // 車体のへこみを直す
  const p = model.meshes.paint; p.geometry.attributes.position.array.set(p.userData.orig); p.geometry.attributes.position.needsUpdate = true; p.geometry.computeVertexNormals();
  for (let i = 0; i < 90; i++) car.update(1 / 60, { steer: 0, throttle: 0, brake: 1 });
}

function newDrive() {
  placeAtStart();
  Object.assign(G, {
    camQ: null, clock: 18.4, rain: 0.55, rainTarget: 0.6, rainTimer: 25, flood: 0.15, fog: 0.12, defrost: false, room: false,
    lights: 0, high: false, wiperMode: 0, wiperAng: 0, wiperDir: 0, komazu: 0, keyOn: false, crumbs: [], fallT: 0,
    startOdo: car.odo, startClock: 18.4, realTime: 0, refuel: 0, out: false, hinted: {}, view: 0,
  });
  ws.drops.length = 0;
  for (let i = 0; i < 380; i++) { const b = Math.random(); ws.drops.push({ u: Math.random(), v: Math.random(), r: 0.003 + b * b * b * 0.011, vy: 0, age: 0 }); }
  world.block.set(Math.random() < 0.5);
  if (world.block.active) { /* 落石あり:旧道へ回る */ }
}

// ------------------------------------------------------------ 画面の切り替え
function show(id, on) { $(id).classList.toggle('hidden', !on); }
function toTitle() {
  G.state = 'title';
  input.enabled = false;
  show('#title', true); show('#pause', false); show('#hud', false); show('#touch', false); show('#ending', false);
  $('#ending').classList.remove('show');
  closePanel();
  newDrive();
  selectMenu($('#title-menu'), 0);
}
function startDrive() {
  audio.start();
  G.state = 'drive';
  input.enabled = true;
  show('#title', false); show('#hud', true); show('#touch', isTouch); show('#pause', false);
  closePanel();
  G.fade = 1; G.fadeTo = 0;
  setTimeout(() => hint('engine'), 1200);
}
function pause(on) {
  if (G.state !== 'drive' && G.state !== 'pause') return;
  G.state = on ? 'pause' : 'drive';
  show('#pause', on); show('#touch', !on && isTouch);
  if (on) selectMenu($('#pause-menu'), 0); else closePanel();
  if (audio.ctx) on ? audio.ctx.suspend() : audio.ctx.resume();
}

// メニュー(キーボードの ↑↓ Enter でも選べる)
function selectMenu(menu, i) {
  const b = [...menu.querySelectorAll('button')];
  b.forEach((x, k) => x.classList.toggle('sel', k === i));
  menu.dataset.sel = i;
}
function activeMenu() {
  if (!$('#panel').classList.contains('hidden')) return null;
  if (G.state === 'title') return $('#title-menu');
  if (G.state === 'pause') return $('#pause-menu');
  if (G.state === 'ending') return $('#ending .menu');
  return null;
}
function menuGo(go) {
  audio.start();
  if (go === 'start') startDrive();
  else if (go === 'settings') openPanel('settings');
  else if (go === 'help') openPanel('help');
  else if (go === 'credits') openPanel('credits');
  else if (go === 'resume') pause(false);
  else if (go === 'respawn') { pause(false); respawn(); }
  else if (go === 'quit' || go === 'title') { if (audio.ctx) audio.ctx.resume(); toTitle(); }
}
for (const b of document.querySelectorAll('[data-go]')) b.addEventListener('click', () => menuGo(b.dataset.go));

// ---- パネル(設定・操作・クレジット)
function openPanel(kind) {
  show('#panel', true);
  const body = $('#panel-body');
  body.innerHTML = '';
  if (kind === 'settings') {
    $('#panel-title').textContent = '設定';
    const seg = (label, key, opts, note) => {
      const row = document.createElement('div'); row.className = 'row';
      row.innerHTML = `<div class="label">${label}</div><div class="seg"></div>` + (note ? `<div class="note">${note}</div>` : '');
      const s = row.querySelector('.seg');
      for (const [v, t] of opts) {
        const b = document.createElement('button'); b.textContent = t; b.classList.toggle('on', S[key] === v);
        b.onclick = () => { S[key] = v; save(); applySettings(key); openPanel('settings'); };
        s.appendChild(b);
      }
      body.appendChild(row);
    };
    seg('変速機', 'trans', [['AT', 'AT(4速)'], ['MT', 'MT(5速)']], '止まっているときに切り替わります');
    if (!isTouch) seg('クラッチ(MT)', 'autoClutch', [[true, '自動'], [false, '手動(Shift)']]);
    seg('ABS', 'abs', [[true, 'あり'], [false, 'なし']], 'なしにすると、強く踏んだときにタイヤがロックします');
    seg('画面の粗さ', 'res', [[240, '粗い'], [360, '標準'], [540, '細かい']], '細かくすると、古い端末では重くなります');
    seg('ヒント', 'hints', [[true, '表示'], [false, '表示しない']]);
    const row = document.createElement('div'); row.className = 'row';
    row.innerHTML = '<div class="label">音量</div><input type="range" min="0" max="1" step="0.05">';
    const r = row.querySelector('input'); r.value = S.vol;
    r.oninput = () => { S.vol = +r.value; audio.setVolume(S.vol); save(); };
    body.appendChild(row);
  } else if (kind === 'help') {
    $('#panel-title').textContent = '操作';
    body.innerHTML = '<div class="keys">' + KEYS.map(([k, t]) => `<div class="key">${k}</div><div>${t}</div>`).join('') + '</div>' +
      `<h3>TOUCH</h3><p>左下のつまみを左右に動かしてハンドル。右下のペダルは、上のほうを押すほど強く踏みます。▲▼ でレバー。上のボタンでエンジン・ライト・ワイパーなど。「コマ図」は押しているあいだ手元を見ます。</p>
       <h3>HOW TO</h3><p>エンジンをかけ、レバーを D に入れて走り出します。道案内はダッシュボードのコマ図だけです。トリップメーター(距離)と、雨の中に見える目印をたよりに、分かれ道を選んでください。湯ノ沢に着いたら車を止めて、エンジンを切ると終わります。</p>
       <p>暗くなったらライト、曇ったら曇り止め、夜のコマ図は室内灯で。燃料は少なめです。道をまちがえて遠回りが続くと、ガソリンが心配になります。</p>`;
  } else {
    $('#panel-title').textContent = 'クレジット';
    body.innerHTML = `<h3>CAR MODEL</h3><p>"low-poly Toyota Corolla E80 Sedan" by D_U<br>
      <a href="https://sketchfab.com/3d-models/low-poly-toyota-corolla-e80-sedan-6254cf268d9b46f79dd2a6511e153891" target="_blank" rel="noopener">sketchfab.com</a> · CC BY 4.0<br>
      ゲームで使うために、色・部品の分け方・ライトを変えています。</p>
      <h3>LIBRARY</h3><p>three.js(MIT License)</p>
      <h3>FONTS</h3><p>BIZ UDPGothic / Barlow Condensed(SIL Open Font License)</p>
      <h3>OTHER</h3><p>山・道・建物・雨・音・メーターは、すべてプログラムで作っています。</p>`;
  }
}
function closePanel() { show('#panel', false); }
$('#panel-close').onclick = closePanel;
function applySettings(key) {
  if (key === 'res') resize();
  if (key === 'trans' && Math.abs(car.speed) < 0.5) { car.setTransmission(S.trans); }
  if (key === 'autoClutch') car.autoClutch = S.autoClutch;
  if (key === 'abs') car.abs = S.abs;
}

// ---- ヒントと知らせ
const HINTS = {
  engine: ['<b>K</b> を長押しして、エンジンをかける', 'エンジン を長押しして、エンジンをかける'],
  lever: ['<b>E</b> でレバーを D へ(P → R → N → D)', '▼ でレバーを D へ'],
  leverMT: ['<b>E</b> で 1速へ。<b>W</b> でアクセル', '▲ で 1速へ'],
  komazu: ['<b>C</b> を押しているあいだ、コマ図を見る', 'コマ図 を押しているあいだ、手元を見る'],
  lights: ['暗くなってきた。<b>L</b> でライト', '暗くなってきた。ライト を押す'],
  wiper: ['雨が強い。<b>X</b> でワイパー', '雨が強い。ワイパー を押す'],
  fog: ['ガラスが曇ってきた。<b>F</b> で曇り止め', 'ガラスが曇ってきた。曇り止め を押す'],
  room: ['暗くてコマ図が読めないときは、<b>R</b> で室内灯', '暗いときは 室内灯 でコマ図を照らす'],
};
let hintTimer = 0;
function hint(key, force) {
  if (!S.hints || (G.hinted[key] && !force) || G.state !== 'drive') return;
  G.hinted[key] = true;
  G.hintKey = key;
  $('#hint').innerHTML = HINTS[key][isTouch ? 1 : 0];
  $('#hint').classList.add('on');
  hintTimer = 7;
}
let msgTimer = 0;
function msg(text, sub = '', dur = 3) {
  $('#msg').innerHTML = text + (sub ? `<small>${sub}</small>` : '');
  $('#msg').classList.add('on');
  msgTimer = dur;
}

// ------------------------------------------------------------ 操作表(運転中にいつでも出せる)
function renderKeyCard() {
  const groups = isTouch ? TOUCH_CARD : keyCard(!isAT(), !car.autoClutch);
  const mode = `${isAT() ? 'AT' : 'MT'}${!isAT() ? (car.autoClutch ? ' · 自動クラッチ' : ' · 手動クラッチ') : ''} · ABS ${car.abs ? 'あり' : 'なし'}`;
  $('#keys-card').innerHTML = groups.map(([h, rows]) => `<h4>${h}</h4>` + rows.map(([k, t]) => `<div class="kr"><span>${k}</span><span>${t}</span></div>`).join('')).join('')
    + `<div class="mode">${mode}</div>`;
}
function toggleKeys(force) {
  const el = $('#keys-card');
  const on = force ?? el.classList.contains('hidden');
  if (on) renderKeyCard();
  el.classList.toggle('hidden', !on);
  $('#keys-tag').classList.toggle('hidden', on);
  const b = document.querySelector('#touch [data-a=keys]'); if (b) b.classList.toggle('on', on);
}

// ------------------------------------------------------------ 操作
const isAT = () => car.trans === 'AT';
function action(a, down) {
  if (G.state !== 'drive') return;
  if (a === 'komazu') { G.komazuHeld = down; return; }
  if (a === 'engine') {
    if (down) {
      if (car.engine.running) { car.engineOff(); G.keyOn = false; audio.click(); }
      else { G.keyOn = true; car.ignition(true); G.cranking = true; }
    } else { car.ignition(false); G.cranking = false; }
    return;
  }
  if (!down) return;
  switch (a) {
    case 'leverUp': car.leverUp(); break;
    case 'leverDown': car.leverDown(); break;
    case 'od': if (isAT()) { car.toggleOD(); audio.click(); } break;
    case 'lights': G.lights = (G.lights + 1) % 3; audio.click(); break;
    case 'high': if (G.lights === 2) { G.high = !G.high; audio.click(); } break;
    case 'wiper': G.wiperMode = (G.wiperMode + 1) % 4; audio.click(); break;
    case 'defrost': G.defrost = !G.defrost; audio.click(); break;
    case 'room': G.room = !G.room; audio.click(); if (G.room) setTimeout(() => hint('room'), 0); break;
    case 'view': G.view = (G.view + 1) % 3; break;
    case 'trip': car.trip = 0; audio.click(); break;
    case 'respawn': respawn(); break;
    case 'pause': pause(true); break;
    case 'keys': toggleKeys(); break;
  }
}
const KEYMAP = { KeyE: 'leverDown', KeyQ: 'leverUp', KeyO: 'od', KeyL: 'lights', KeyH: 'high', KeyX: 'wiper', KeyF: 'defrost', KeyR: 'room', KeyV: 'view', KeyT: 'trip', Backspace: 'respawn' };
input.on('down', code => {
  const m = activeMenu();
  if (m && (code === 'ArrowDown' || code === 'ArrowUp' || code === 'KeyS' || code === 'KeyW')) {
    const n = m.querySelectorAll('button').length;
    selectMenu(m, ((+m.dataset.sel || 0) + (code === 'ArrowDown' || code === 'KeyS' ? 1 : -1) + n) % n); return;
  }
  if (m && (code === 'Enter' || code === 'Space')) { m.querySelectorAll('button')[+m.dataset.sel || 0].click(); return; }
  if (G.state === 'title' && /^Digit[1-4]$/.test(code)) { $('#title-menu').querySelectorAll('button')[+code.slice(5) - 1].click(); return; }
  if (code === 'Escape') {
    if (!$('#panel').classList.contains('hidden')) { closePanel(); return; }
    if (G.state === 'drive') pause(true); else if (G.state === 'pause') pause(false);
    return;
  }
  if (G.state === 'drive' && G.out && code === 'Enter') { refuelRestart(); return; }
  if (code === 'Tab') { if (G.state === 'drive') toggleKeys(); return; }
  if (code === 'KeyK') action('engine', true);
  if (code === 'KeyC') action('komazu', true);
  // MT はシフトアップが E(手前ではなく上へ)
  if (!isAT() && (code === 'KeyE' || code === 'KeyQ')) { action(code === 'KeyE' ? 'leverUp' : 'leverDown', true); return; }
  if (KEYMAP[code]) action(KEYMAP[code], true);
});
input.on('up', code => {
  if (code === 'KeyK') action('engine', false);
  if (code === 'KeyC') action('komazu', false);
});
input.bindTouch($('#touch'), (a, down) => {
  if (a === 'leverUp' || a === 'leverDown') { if (down) { if (isAT()) action(a, true); else action(a === 'leverUp' ? 'leverUp' : 'leverDown', true); } return; }
  action(a, down);
});

// ------------------------------------------------------------ やり直し・給油・到着
function fadeThen(fn) { G.fadeTo = 1; G.onFade = () => { fn(); G.fadeTo = 0; }; }
function respawn() {
  if (G.state !== 'drive') return;
  fadeThen(() => {
    const c = G.crumbs.length > 1 ? G.crumbs[G.crumbs.length - 2] : G.crumbs[0];
    if (c) car.reset(c.x, c.y, c.z, c.yaw);
    else placeAtStart();
    car.vel = { x: 0, y: 0, z: 0 };
    G.camQ = null;
    msg('少し手前から', '', 2);
  });
}
function refuelRestart() {
  G.out = false;
  fadeThen(() => {
    const g = world.gasStation;
    const o = W.nearestRoad(g.x, g.z, 40);
    car.reset(o.px - o.rx * 1.6, o.y, o.pz - o.rz * 1.6, Math.atan2(o.tx, o.tz) + Math.PI);
    car.fuel = 20; G.clock += 0.33; // 20分おくれる
    G.camQ = null;
    msg('ガソリンスタンドから', '20分たった', 3);
  });
}
function ending() {
  G.state = 'ending';
  input.enabled = false;
  show('#hud', false); show('#touch', false); show('#ending', true);
  requestAnimationFrame(() => $('#ending').classList.add('show'));
  const km = (car.odo - G.startOdo) / 1000;
  const hh = Math.floor(G.clock), mm = Math.floor((G.clock - hh) * 60);
  const rm = Math.floor(G.realTime / 60), rs = Math.floor(G.realTime % 60);
  $('#end-stats').innerHTML = `着いた時刻<span>${hh}:${String(mm).padStart(2, '0')}</span><br>走った距離<span>${km.toFixed(1)}</span>km<br>かかった時間<span>${rm}:${String(rs).padStart(2, '0')}</span>`;
  selectMenu($('#ending .menu'), 0);
}

// ------------------------------------------------------------ 毎フレーム
let last = performance.now();
let frameFailed = false;
function frame(now) {
  requestAnimationFrame(frame);
  if (frameFailed) return;
  try { frameBody(now); } catch (e) { frameFailed = true; showError(e, '動いている途中'); }
}
function frameBody(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!car) return;
  if (G.state === 'pause') { draw(0); return; }
  if (G.state === 'title') titleFrame(dt);
  else if (G.state === 'drive' || G.state === 'ending') driveFrame(dt);
  draw(dt);
}

function titleFrame(dt) {
  G.titleT += dt;
  car.update(dt, { steer: 0, throttle: 0, brake: 1 });
  G.clock = 18.45;
  updateWorld(dt);
}

function driveFrame(dt) {
  const ending = G.state === 'ending';
  G.realTime += ending ? 0 : dt;
  let inp = ending ? { steer: 0, throttle: 0, brake: 0.3 } : input.read();
  if (G.komazu > 0.5) inp = { ...inp, steer: inp.steer * 0.5 };
  if (G.cranking) car.ignition(true);
  car.wet = 1;
  car.update(dt, inp);
  G.clock += dt * 2.5 / 3600;
  handleEvents();
  updateWorld(dt);
  if (ending) return;

  // 足あと(やり直す場所)
  G.crumbT -= dt;
  const nr = W.nearestRoad(car.pos.x, car.pos.z, 30);
  if (G.crumbT <= 0 && nr && Math.abs(nr.lateral) < nr.road.kind.half && car.up().y > 0.9 && car.speed > 2) {
    G.crumbT = 2;
    const f = car.fwd(), sgn = f.x * nr.tx + f.z * nr.tz > 0 ? 1 : -1;
    G.crumbs.push({ x: nr.px + nr.rx * nr.lateral, y: nr.y, z: nr.pz + nr.rz * nr.lateral, yaw: Math.atan2(-nr.tx * sgn, -nr.tz * sgn) });
    if (G.crumbs.length > 40) G.crumbs.shift();
  }
  // 落ちた・ひっくり返った・深い水
  const fell = nr ? (car.pos.y < nr.y - 4 && Math.abs(nr.lateral) > nr.road.kind.half + 2) : car.pos.y < W.terrainHeight(car.pos.x, car.pos.z) - 2;
  const deep = Math.max(car.wheels[0].depth, car.wheels[2].depth) > 0.9;
  const outMap = Math.abs(car.pos.x) > 1580 || Math.abs(car.pos.z) > 1580;
  if (car.upsideTimer > 2.5 || fell || deep || outMap) G.fallT += dt; else G.fallT = 0;
  if (G.fallT > 2.2 && G.fadeTo === 0) { G.fallT = 0; respawn(); }

  // 給油(スタンドの屋根の下で止まってエンジンを切る)
  const gs = world.gasStation;
  if (Math.hypot(car.pos.x - gs.x, car.pos.z - gs.z) < gs.r && car.speed < 0.3 && !car.engine.running && car.fuel < 40) {
    if (G.refuel <= 0) { msg('給油しています', 'レギュラー', 2.5); audio.pump(); }
    G.refuel += dt;
    car.fuel = Math.min(40, car.fuel + dt * 2.5);
    if (car.fuel >= 40) msg('満タンになりました', '', 2);
  } else G.refuel = 0;

  // 到着
  const goal = world.goal;
  if (Math.hypot(car.pos.x - goal.x, car.pos.z - goal.z) < goal.r && car.speed < 0.4 && !car.engine.running && G.keyOn === false && car.engine.omega < 5) ending();

  // ヒント
  if (car.engine.running && car.speed < 0.5) hint(isAT() ? 'lever' : 'leverMT');
  if (car.trip > 60) hint('komazu');
  if (sky.state.light < 0.7 && G.lights < 2) hint('lights');
  if (G.rain > 0.75 && G.wiperMode === 0) hint('wiper');
  if (G.fog > 0.4 && !G.defrost) hint('fog');
  // 言われたことを済ませたら、ヒントを消す
  const done = { engine: car.engine.running, lever: ['D', '2', 'L'].includes(car.lever), leverMT: car.gear > 0, komazu: G.komazuHeld,
    lights: G.lights === 2, wiper: G.wiperMode > 0, fog: G.defrost, room: false }[G.hintKey];
  if (done && hintTimer > 0.6) hintTimer = 0.6;
  hintTimer -= dt; if (hintTimer <= 0) $('#hint').classList.remove('on');
  msgTimer -= dt; if (msgTimer <= 0) $('#msg').classList.remove('on');
}

function handleEvents() {
  for (const e of car.events) {
    switch (e.type) {
      case 'start': hint(isAT() ? 'lever' : 'leverMT'); break;
      case 'stall': msg('エンスト', isTouch ? 'エンジン を長押しでかけ直す' : 'K を長押しでかけ直す'); G.keyOn = true; break;
      case 'flooded': msg('水を吸いこんで、エンジンが止まった', '水から出て、しばらく待ってからかけ直す', 4); audio.splash(0.6); break;
      case 'outOfFuel': msg('ガソリンがなくなった', isTouch ? '画面をタップ:ガソリンスタンドからやり直す' : 'Enter:ガソリンスタンドからやり直す', 9); G.out = true; break;
      case 'hit': audio.impact(e.v); carMod.dent(model, e.lx, e.lz, e.v); G.shake = Math.min(1, e.v / 10); break;
      case 'scrape': audio.burst({ dur: 0.2, gain: 0.2, fq: 500 }); break;
      case 'refuse': msg(isAT() ? '止まってから' : 'クラッチを踏んで', '', 1.5); break;
      case 'grind': msg('クラッチを踏んで(Shift)', '', 1.5); audio.burst({ dur: 0.3, gain: 0.2, fq: 3000, filter: 'highpass' }); break;
      case 'noStart': msg(isAT() ? 'レバーを P か N に' : 'クラッチを踏むか、N に', '', 2); break;
      case 'lever': case 'shift': audio.click(); break;
      case 'atShift': audio.burst({ type: 'sine', freq: 90, dur: 0.08, gain: 0.05 }); break;
    }
  }
  car.events.length = 0;
}
if (isTouch) $('#msg').addEventListener('pointerdown', () => { if (G.out) refuelRestart(); });
document.addEventListener('pointerdown', () => { if (G.out && isTouch) refuelRestart(); });

// ------------------------------------------------------------ 世界の更新(雨・時刻・光)
const tmpV = new THREE.Vector3();
function updateWorld(dt) {
  // 雨の強さ:ときどき変わる
  G.rainTimer -= dt;
  if (G.rainTimer <= 0) {
    G.rainTimer = 25 + Math.random() * 40;
    const r = Math.random();
    G.rainTarget = r < 0.18 ? 1.0 : r < 0.45 ? 0.35 + Math.random() * 0.2 : 0.55 + Math.random() * 0.3;
  }
  G.rain += (G.rainTarget - G.rain) * Math.min(1, dt * 0.06);
  G.flood += ((G.rain > 0.85 ? 0.42 : G.rain * 0.28) - G.flood) * Math.min(1, dt * 0.012);
  W.setFloodLevel(G.flood);
  world.ford.mesh.position.y = world.ford.base + G.flood;
  world.river.position.y = W.RIVER_LEVEL + G.flood * 1.5;
  for (const f of world.animated) f(performance.now() / 1000);

  // トンネルの中か
  const nr = W.nearestRoad(car.pos.x, car.pos.z, 12);
  const inT = nr && nr.tunnel && Math.abs(nr.lateral) < nr.road.kind.half + 1.5 ? 1 : 0;
  G.tunnel += (inT - G.tunnel) * Math.min(1, dt * 3);

  // ワイパー
  const mode = G.wiperMode;
  const speeds = [1.1, 2.6, 2.6, 4.2];
  const MAX = 1.85;
  const prevAng = G.wiperAng;
  let turn = false;
  if (G.wiperDir === 0) {
    G.wiperWait -= dt;
    if (mode > 0 && G.wiperWait <= 0) G.wiperDir = 1;
  }
  if (G.wiperDir !== 0) {
    G.wiperAng += G.wiperDir * speeds[mode || 1] * dt;
    if (G.wiperAng >= MAX) { G.wiperAng = MAX; G.wiperDir = -1; turn = true; }
    if (G.wiperAng <= 0) { G.wiperAng = 0; G.wiperDir = 0; G.wiperWait = mode === 1 ? 3.5 : 0; turn = true; }
  }
  const wipers = ck.wipers.map(w => ({ u: w.s / cockpitMod.GLASS.W + 0.5, v: 0.02, ang: G.wiperAng, prevAng, len: w.len }));
  ws.update(dt, G.rain, Math.max(0, car.speedSigned), wipers, G.tunnel > 0.5);
  for (const w of ck.wipers) w.rot.rotation.z = G.wiperAng;
  G.wiperTurn = turn;
  // くもり
  G.fog = clamp(G.fog + dt * (G.defrost ? -0.06 : 0.0045 * (0.5 + G.rain)), 0, 0.8);

  // 光
  const light = sky.state.light;
  const night = 1 - light;
  sky.update(G.clock, G.rain, camera.position, G.tunnel);
  W.puddleAt && (car.wet = 1);
  const headOn = G.lights === 2;
  headL.forEach((L, i) => {
    const sx = i ? 0.55 : -0.55;
    const p = car.toWorld({ x: sx, y: 0.12, z: -1.95 });
    const t = car.toWorld({ x: sx * 0.5 + (G.high ? 0 : -0.25), y: G.high ? -0.2 : -0.62, z: G.high ? -60 : -28 });
    L.position.set(p.x, p.y, p.z); L.target.position.set(t.x, t.y, t.z); L.target.updateMatrixWorld();
    L.intensity = headOn ? (G.high ? 1100 : 650) : 0;
    L.distance = G.high ? 150 : 80; L.angle = G.high ? 0.32 : 0.45;
  });
  const tp = car.toWorld({ x: 0, y: 0.1, z: 2.2 });
  tailL.position.set(tp.x, tp.y, tp.z);
  tailL.intensity = (G.lights > 0 ? 1.2 : 0) + (car.brake > 0.1 ? 3 : 0);
  // 近くの明かり3つ
  const cx = car.pos.x, cz = car.pos.z;
  const near = [];
  for (const e of world.emitters) {
    if (e.intensity <= 0) continue;
    const d = (e.x - cx) ** 2 + (e.z - cz) ** 2;
    if (d < 6400) near.push([d, e]);
  }
  near.sort((a, b) => a[0] - b[0]);
  pool.forEach((L, i) => {
    const e = near[i] && near[i][1];
    if (!e) { L.intensity = 0; return; }
    L.position.set(e.x, e.y, e.z); L.color.setHex(e.color); L.distance = e.dist;
    L.intensity = e.intensity * (e.night ? smooth(night * 1.6) : 1) * (e.tunnel ? 1 : 0.6 + night * 0.4);
  });
  world.windowMat.color.setRGB(0.16 + night * 1.1, 0.16 + night * 0.85, 0.17 + night * 0.5);
  for (const m of world.nightLit || []) m.color.setRGB(0.3 + night * 0.9, 0.28 + night * 0.7, 0.24 + night * 0.4);
  world.reflector.emissive.set(headOn ? '#8a3c00' : '#000000');
  scenery.LINE_GLOW.value = headOn ? (G.high ? 1.3 : 1) * (0.3 + night * 0.7) : 0;
  carMod.updateCarModel(model, car, { head: headOn ? 1 : 0, high: G.high, small: G.lights > 0, brake: car.brake > 0.1, reverse: car.gearLabel() === 'R' });
  model.group.position.set(car.pos.x, car.pos.y, car.pos.z);
  model.group.quaternion.set(car.q.x, car.q.y, car.q.z, car.q.w);

  // 雨の線とはね返り
  const hp = car.toWorld({ x: 0, y: 0.1, z: -2 }), f = car.fwd();
  rain.update(dt, {
    cam: camera.position, carVel: G.view === 2 ? { x: 0, y: 0, z: 0 } : car.vel, intensity: G.rain * (1 - G.tunnel),
    head: tmpV.set(hp.x, hp.y, hp.z), headDir: new THREE.Vector3(f.x, f.y - 0.05, f.z).normalize(), headOn: headOn ? 1 : 0,
    ambient: 0.05 + light * 0.4, fog: scene.fog, car, wet: 1 - G.tunnel,
    lamp: near[0] ? { x: near[0][1].x, y: near[0][1].y, z: near[0][1].z, dist: near[0][1].dist * 0.8 } : null,
  });
  scenery.cullWorld(world, camera.position.x, camera.position.z, 380 + light * 80, 260 + light * 60);

  // 音
  const surf = car.wheels[2].surface;
  audio.update(dt, {
    rpm: car.rpm(), throttle: car.throttle, running: car.engine.running, cranking: G.cranking && !car.engine.running,
    rain: G.rain, inside: G.view === 0, inTunnel: G.tunnel > 0.5, speed: car.speed, wet: 1 - G.tunnel,
    offroad: !['asphalt', 'shoulder'].includes(surf), slide: Math.max(...car.wheels.map(w => w.slide)),
    wiperMoving: G.wiperDir !== 0, wiperTurn: turn, daylight: light,
  });
}
const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };

// ------------------------------------------------------------ カメラと描画
const qCar = new THREE.Quaternion(), eul = new THREE.Euler();
const headOff = new THREE.Vector3();
function draw(dt) {
  if (!R) return;
  qCar.set(car.q.x, car.q.y, car.q.z, car.q.w);
  let cockpit = null, glassOn = false;
  // 画面の切り替えのフェード
  G.fade += (G.fadeTo - G.fade) * Math.min(1, dt * 4);
  if (G.fadeTo === 1 && G.fade > 0.97 && G.onFade) { const f = G.onFade; G.onFade = null; f(); }

  if (G.state === 'title') {
    const t = G.titleT * 0.06;
    const c = car.pos;
    camera.position.set(c.x + Math.cos(t) * 7.5, c.y + 1.4 + Math.sin(t * 0.7) * 0.3, c.z + Math.sin(t) * 7.5);
    camera.lookAt(c.x, c.y + 0.4, c.z);
    camera.fov = 42;
    const w = innerWidth, h = innerHeight;
    if (w > h) camera.setViewOffset(w, h, -w * 0.17, 0, w, h); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    model.group.visible = true;
  } else if (G.view === 0) {
    camera.clearViewOffset();
    // 運転席:頭は少し遅れて揺れる(加速・カーブで)
    const a = car.lastAcc || { x: 0, z: 0 };
    headOff.x += (clamp(-a.x * 0.003, -0.025, 0.025) - headOff.x) * Math.min(1, dt * 4);
    headOff.z += (clamp(-a.z * 0.002, -0.02, 0.02) - headOff.z) * Math.min(1, dt * 4);
    // 頭は車体の細かい揺れを首で吸収する:車の向きをゆっくり追いかけ、半分だけ車に合わせる
    if (!G.camQ) G.camQ = qCar.clone();
    G.camQ.slerp(qCar, 1 - Math.exp(-dt / 0.2));
    const qHead = G.camQ.clone().slerp(qCar, 0.5);
    const qRel = qCar.clone().invert().multiply(qHead); // 車から見た頭の傾き
    const k = G.komazu;
    G.komazu += ((G.komazuHeld ? 1 : 0) - G.komazu) * Math.min(1, dt * 7);
    const eye = new THREE.Vector3(0.37 + headOff.x - 0.07 * k, 0.615 - 0.01 * k, 0.15 + headOff.z - 0.03 * k);
    camera.position.copy(eye).applyQuaternion(qCar).add(new THREE.Vector3(car.pos.x, car.pos.y, car.pos.z));
    // 前を見るときの下向きと、コマ図を見るときの向き
    const kz = new THREE.Vector3(); ck.komazu.getWorldPosition(kz);
    const lookFwd = new THREE.Vector3(-0.06, -0.085, -1).normalize();
    const lookK = kz.clone().sub(new THREE.Vector3(-0.07, cockpitMod.EYE_Y - 0.01, -0.03)).normalize();
    const dir = lookFwd.lerp(lookK, smooth(k)).normalize();
    const qLook = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
    const sh = G.shake; G.shake *= Math.exp(-dt * 8);
    const qShake = new THREE.Quaternion().setFromEuler(eul.set((Math.random() - 0.5) * sh * 0.03, (Math.random() - 0.5) * sh * 0.03, 0));
    camera.quaternion.copy(qHead).multiply(qLook).multiply(qShake);
    camera.fov = 56 - 33 * smooth(k); camera.updateProjectionMatrix();
    // 車内のカメラ(車内の物は車に固定。頭の傾きの分だけ回す)
    ckCam.position.set(-0.07 * k + headOff.x, cockpitMod.EYE_Y - 0.01 * k, -0.03 * k + headOff.z);
    ckCam.quaternion.copy(qRel).multiply(qLook).multiply(qShake);
    ckCam.fov = camera.fov; ckCam.updateProjectionMatrix();
    cockpit = ck.scene; glassOn = true;
    model.group.visible = false;
  } else if (G.view === 1) {
    camera.clearViewOffset();
    const p = car.toWorld({ x: 0, y: 0.42, z: -1.75 });
    camera.position.set(p.x, p.y, p.z);
    camera.quaternion.copy(qCar).multiply(new THREE.Quaternion().setFromEuler(eul.set(-0.05, 0, 0)));
    camera.fov = 60; camera.updateProjectionMatrix();
    model.group.visible = false;
  } else {
    camera.clearViewOffset();
    const f = car.fwd();
    const want = new THREE.Vector3(car.pos.x - f.x * 6.2, car.pos.y + 2.3, car.pos.z - f.z * 6.2);
    camera.position.lerp(want, Math.min(1, dt * 5));
    const gh = W.groundAt(camera.position.x, camera.position.z).h;
    if (camera.position.y < gh + 0.6) camera.position.y = gh + 0.6;
    camera.lookAt(car.pos.x + f.x * 3, car.pos.y + 0.6, car.pos.z + f.z * 3);
    camera.fov = 55; camera.updateProjectionMatrix();
    model.group.visible = true;
  }

  if (cockpit) updateCockpitView(dt);
  // 速さの表示(運転席以外)
  if (G.state === 'drive' && G.view !== 0) {
    $('#readout').innerHTML = `<div class="spd">${Math.round(Math.abs(car.speedo) * 3.6)}<span class="u">km/h</span></div><div class="g">${car.gearLabel()}${isAT() && car.lever === 'D' ? ' ' + (car.atGear + 1) : ''}</div>`;
  } else $('#readout').innerHTML = '';
  $('#t-gear').textContent = car.gearLabel();

  if (glassOn) R.drawDrops(ws.drops);
  R.render({
    scene, camera, cockpit, cockCamera: ckCam, glassOn, fog: G.fog, room: G.room ? 1 : 0,
    glow: G.lights > 0 ? 1 : 0, fade: Math.max(G.fade, G.state === 'ending' ? 0 : 0),
  });
}

function updateCockpitView(dt) {
  const night = 1 - sky.state.light;
  const ign = G.keyOn || car.engine.running;
  cockpitMod.updateCockpit(ck, {
    lit: G.lights > 0, mt: !isAT(), shift: car.gearLabel(), odOff: car.odOff && isAT(),
    blinkL: false, blinkR: false, highBeam: G.lights === 2 && G.high,
    brakeLamp: ign && (car.handbrake > 0 || !car.engine.running), oilLamp: ign && !car.engine.running, battLamp: ign && !car.engine.running,
    fuelLamp: ign && car.fuel < 5, engineLamp: ign && !car.engine.running,
    daylight: sky.state.light * (1 - G.tunnel * 0.6),
    rpm: car.rpm(), kmh: Math.abs(car.speedo) * 3.6, temp: ign ? car.temp : 0, fuel: ign ? car.fuel / 50 : 0,
    odoKm: car.odo / 1000, tripKm: car.trip / 1000, clock: G.clock, power: ign,
  });
  // 車内の明るさ:外の光・トンネルの橙・室内灯・メーターの照明
  const L = sky.state.light;
  ck.ambient.intensity = 0.18 + L * 1.6 + G.tunnel * 0.6;
  ck.skyLight.intensity = L * 0.9 * (1 - G.tunnel);
  ck.ambient.color.set(G.tunnel > 0.5 ? '#d89850' : '#8a9597');
  ck.roomLight.intensity = G.room ? 2.4 : 0;
  ck.roomLampMat.color.set(G.room ? '#fff1d0' : '#3a3a36');
  ck.clusterGlow.intensity = G.lights > 0 ? 0.03 : 0;
  ck.paperMat.emissive.setRGB(0.03, 0.03, 0.025);
  ck.defrostLamp.color.set(G.defrost ? '#ffa040' : '#2a2a28');
  ck.paint.color.set(PAINT);
  const mk = 0.08 + L * 0.5 + (G.lights > 0 ? 0.04 : 0);
  ck.mirrorFace.color.setRGB(mk, mk, mk);
  ck.doorMirror.color.setRGB(mk, mk, mk);
  // ハンドル(タイヤの角度の約15倍)
  ck.wheel.rotation.z = -car.steer * 15;
  // シフトレバー
  if (isAT()) {
    const i = ['P', 'R', 'N', 'D', '2', 'L'].indexOf(car.lever);
    ck.lever.position.set(-0.35, 0.53, -0.42 + i * 0.022);
  } else {
    const g = car.gear;
    const col = g === -1 ? 0.03 : g === 0 ? 0 : [-0.03, -0.03, 0, 0, 0.03][g - 1];
    const row = g === 0 ? 0 : g === -1 ? 0.03 : (g % 2 ? -0.03 : 0.03);
    ck.lever.position.set(-0.35 + col, 0.53, -0.36 + row);
  }
}

// ---- 開発用:?auto=1 で自動運転(動作確認のため)。?view=2 ?clock=19 ?leg=2 ?wiper=2 ?lights=2 ?room=1 ?komazu=1
const DEV = new URLSearchParams(location.search);
let pilot = null;
function devStart() {
  if (!DEV.get('auto')) return;
  startDrive();
  G.fade = 0; G.fadeTo = 0;
  S.hints = DEV.get('hints') === '1';
  G.view = +(DEV.get('view') || 0);
  G.clock = +(DEV.get('clock') || 18.4);
  G.lights = +(DEV.get('lights') || 0);
  G.wiperMode = +(DEV.get('wiper') || 0);
  G.room = DEV.get('room') === '1';
  G.komazuHeld = DEV.get('komazu') === '1';
  if (DEV.get('rain')) { G.rain = G.rainTarget = +DEV.get('rain'); G.rainTimer = 1e9; }
  if (DEV.get('block')) world.block.set(DEV.get('block') === '1');
  const legs = autop.MAIN_ROUTE.slice(+(DEV.get('leg') || 0));
  if (DEV.get('leg')) {
    const S1 = W.roadById[legs[0].id].samples, o = S1[Math.min(S1.length - 1, +(DEV.get('s') || 10) >> 1)];
    car.reset(o.x - o.rx * 1.55, o.y, o.z - o.rz * 1.55, Math.atan2(-o.tx, -o.tz));
  }
  car.engine.running = true; car.engine.omega = 85; G.keyOn = true;
  if (isAT()) car.moveLever('D'); else car.mtShift(1);
  pilot = new autop.Autopilot(legs, { maxKmh: +(DEV.get('kmh') || 50) });
  input.read = () => pilot.control(car);
  window.__dbg = { ck, G, car, headL, scene, R, THREE };
  window.DEV_STATE = () => ({ x: car.pos.x, z: car.pos.z, kmh: car.speedSigned * 3.6, trip: car.trip, leg: pilot.leg, clock: G.clock, fps: window.FPS });
}
let fpsAcc = 0, fpsN = 0;
setInterval(() => { window.FPS = fpsN; fpsN = 0; }, 1000);
requestAnimationFrame(function c() { fpsN++; requestAnimationFrame(c); });

// 起動できなかったときの説明(原因と、どうすれば直るか)
function showError(e, where) {
  console.error(e);
  const m = String((e && e.message) || e);
  let reason, fix;
  if (e && e.kind === 'webgl' || /WebGL|webgl|context/.test(m)) {
    reason = e && e.gl === 1
      ? 'このブラウザでは、新しい 3D 表示(WebGL2)が使えません。'
      : 'このブラウザでは、3D 表示(WebGL)が使えません。';
    fix = 'Chrome:設定 → システム →「グラフィック アクセラレーションが使用可能な場合は使用する」をオンにして、Chrome を再起動してください。'
      + 'Safari(iPhone・Mac)は、OS を最新にしてください。ほかのブラウザ(Chrome / Edge / Safari の最新版)でも試せます。';
  } else if (/fetch|Failed to fetch|import|404|NetworkError|load/i.test(m)) {
    reason = 'ファイルを読みこめませんでした(通信が切れたか、公開の途中です)。';
    fix = '少し待ってから、ページを再読み込みしてください。Render の公開(Deploy)が終わっているかも確かめてください。';
  } else if (/memory|Array buffer|allocation/i.test(m)) {
    reason = '端末のメモリが足りませんでした。';
    fix = 'ほかのアプリやタブを閉じてから、もう一度開いてください。';
  } else {
    reason = 'プログラムの途中で問題が起きました。';
    fix = 'ページを再読み込みしてください。直らないときは、下の「くわしい内容」を知らせてください。';
  }
  const ua = navigator.userAgent.replace(/\s+/g, ' ');
  $('#loading').classList.remove('hidden');
  $('#loading').innerHTML = `<div class="load-box error-box">
    <div class="eyebrow">ERROR</div>
    <div class="err-title">起動できませんでした</div>
    <p>${reason}</p><p class="fix">${fix}</p>
    <div class="detail">くわしい内容<br>段階:${where || step}<br>内容:${m.replace(/</g, '&lt;')}<br>ブラウザ:${ua}</div>
    <button onclick="location.reload()">再読み込み</button></div>`;
}
boot().then(devStart).catch(e => showError(e));
