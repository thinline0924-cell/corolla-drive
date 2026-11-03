// 道のデータ。座標はメートル(x = 東、z = 南。北へ進むと z が減る)
//
// 点の書き方: [x, z] または [x, z, 'しるし']
//   'b' … ここから次の 'b' までは橋
//   't' … ここから次の 't' まではトンネル
//   'f' … ここから次の 'f' までは沢を渡る低い所(大雨で水につかる)
//
// kind: 'pref' = 2車線の県道(舗装、センターライン) / 'narrow' = 1車線の舗装路 / 'gravel' = じゃり道(林道・旧道)
//
// 下の数字は下書きの座標。SCALE 倍して使う(山全体の大きさを変えるときは SCALE だけを変える)
export const SCALE = 1.6;

const NODES_RAW = {
  start:   [-300, 838],   // 酒屋の前(出発)
  yJunc:   [465, 655],    // Y字の分かれ道
  gas:     [760, 650],    // ガソリンスタンド
  torii:   [215, 238],    // 赤い鳥居の分かれ道
  oldA:    [-30, 150],    // 旧道の入口
  tunS:    [-118, 22],    // トンネル 南口
  tunN:    [-92, -262],   // トンネル 北口
  oldB:    [-40, -330],   // 旧道の出口
  cross:   [70, -592],    // バス停の先の十字路
  onsen:   [372, -668],   // 湯ノ沢(目的地)
};

const ROADS_RAW = [
  // 1. 出発 → Y字(川の南の県道)
  { id: 'r1', kind: 'pref', from: 'start', to: 'yJunc', pts: [
    [-300, 838], [-230, 846], [-150, 834], [-70, 842], [10, 826], [90, 800], [150, 806],
    [215, 786], [262, 748], [320, 735], [385, 700], [465, 655],
  ] },
  // 2. Y字 → 左:川ぞいにガソリンスタンド、その先は行き止まり
  { id: 'r2', kind: 'pref', from: 'yJunc', to: 'gas', pts: [
    [465, 655], [540, 648], [610, 660], [690, 646], [760, 650],
  ] },
  { id: 'r2b', kind: 'gravel', from: 'gas', to: null, pts: [
    [760, 650], [820, 628], [858, 586], [870, 530], [850, 480],
  ] },
  // 3. Y字 → 右:橋をわたって山をのぼる(本線)
  { id: 'r3', kind: 'pref', from: 'yJunc', to: 'torii', pts: [
    [465, 655], [452, 618], [440, 596, 'b'], [430, 560], [420, 528, 'b'], [400, 500], [340, 470],
    [300, 430], [318, 384], [372, 350], [372, 312], [320, 290], [262, 262], [215, 238],
  ] },
  // 4. 鳥居をまっすぐ:林道。展望台で行き止まり
  { id: 'r4', kind: 'gravel', from: 'torii', to: null, pts: [
    [215, 238], [196, 196], [214, 150], [262, 120], [300, 70], [292, 20], [330, -20],
  ] },
  // 5. 鳥居を左:トンネルへ(本線)。途中に沢をわたる低い所
  { id: 'r5', kind: 'pref', from: 'torii', to: 'tunS', pts: [
    [215, 238], [160, 236], [110, 214], [64, 196, 'f'], [36, 184], [14, 170, 'f'], [-30, 150],
    [-70, 120], [-110, 82], [-122, 50], [-118, 22],
  ] },
  // 6. トンネル(長い)
  { id: 'r6', kind: 'pref', from: 'tunS', to: 'tunN', pts: [
    [-118, 22, 't'], [-112, -60], [-100, -160], [-92, -262, 't'],
  ] },
  // 7. トンネル北口 → 下って、バス停の先の十字路へ(本線)
  { id: 'r7', kind: 'pref', from: 'tunN', to: 'cross', pts: [
    [-92, -262], [-80, -300], [-40, -330], [10, -372], [12, -420], [-40, -452], [-62, -500],
    [-30, -545], [20, -572], [70, -592],
  ] },
  // 8. 旧道:トンネルを使わず峠を越える細いじゃり道(落石で本線がふさがったときの回り道)
  { id: 'r8', kind: 'gravel', from: 'oldA', to: 'oldB', pts: [
    [-30, 150], [0, 110], [36, 80], [30, 40], [-6, 10], [10, -30], [52, -60], [40, -110],
    [10, -150], [40, -200], [20, -250], [-10, -290], [-40, -330],
  ] },
  // 9. 十字路 → 右:湯ノ沢へ(本線)
  { id: 'r9', kind: 'pref', from: 'cross', to: 'onsen', pts: [
    [70, -592], [130, -606], [190, -630], [250, -640], [310, -650], [372, -668],
  ] },
  // 10. 十字路 → まっすぐ:ダムへの道(行き止まり)
  { id: 'r10', kind: 'narrow', from: 'cross', to: null, pts: [
    [70, -592], [86, -650], [80, -720], [110, -790], [100, -860],
  ] },
  // 11. 十字路 → 左:田んぼの中の道(行き止まり)
  { id: 'r11', kind: 'narrow', from: 'cross', to: null, pts: [
    [70, -592], [10, -612], [-60, -640], [-140, -650], [-220, -676], [-300, -690],
  ] },
  // 12. 集落の中の細い道
  { id: 'r12', kind: 'narrow', from: 'onsen', to: null, pts: [
    [372, -668], [420, -700], [470, -712], [520, -706],
  ] },
  // 13. 出発の集落の裏道
  { id: 'r13', kind: 'narrow', from: 'start', to: null, pts: [
    [-300, 838], [-340, 800], [-380, 790], [-430, 806],
  ] },
];

export const ROAD_KIND = {
  pref:   { half: 3.1, shoulder: 0.8, surface: 'asphalt', lines: true },
  narrow: { half: 1.9, shoulder: 0.5, surface: 'asphalt', lines: false },
  gravel: { half: 1.8, shoulder: 0.4, surface: 'gravel', lines: false },
};

// コマ図の道のり(本線)。距離はゲームが道のデータから計算して書き込む
export const ROUTE = {
  name: 'No. 3 ― 湯ノ沢 行き',
  legs: ['r1', 'r3', 'r5', 'r6', 'r7', 'r9'],
  rows: [
    { at: 'start', kind: 'start',  memo: ['酒屋の前から', '出発'] },
    { at: 'yJunc', kind: 'yright', memo: ['Y字を右', '橋をわたる'] },
    { at: 'torii', kind: 'tleft',  memo: ['赤い鳥居を左', '自販機あり'] },
    { at: 'tunS',  kind: 'tunnel', memo: ['トンネル', '(長い)'] },
    { at: 'cross', kind: 'xright', memo: ['バス停の先', '十字路を右'] },
    { at: 'onsen', kind: 'goal',   memo: ['湯ノ沢', '車を止めて終わり'] },
  ],
};

// 川(西へ流れる)。z = riverZ(x)
export function riverZ(x) {
  const u = x / SCALE;
  return SCALE * (560 + 26 * Math.sin(u / 210) + 14 * Math.sin(u / 77 + 1.3));
}

// 集落(木を生やさない所)
const VILLAGES_RAW = [
  { name: '酒屋のある集落', x: -300, z: 840, r: 110 },
  { name: 'ガソリンスタンド', x: 760, z: 650, r: 40 },
  { name: '湯ノ沢', x: 400, z: -680, r: 130 },
  { name: 'バス停', x: 40, z: -580, r: 30 },
];

// 田んぼ(どろ)
const FIELDS_RAW = [
  { x: -170, z: -660, rx: 120, rz: 50 },
  { x: -330, z: 760, rx: 60, rz: 40 },
];

// ---- SCALE 倍する
export const NODES = Object.fromEntries(Object.entries(NODES_RAW).map(([k, [x, z]]) => [k, [x * SCALE, z * SCALE]]));
export const ROADS = ROADS_RAW.map(r => ({ ...r, pts: r.pts.map(([x, z, tag]) => tag ? [x * SCALE, z * SCALE, tag] : [x * SCALE, z * SCALE]) }));
export const VILLAGES = VILLAGES_RAW.map(v => ({ ...v, x: v.x * SCALE, z: v.z * SCALE, r: v.r * SCALE }));
export const FIELDS = FIELDS_RAW.map(f => ({ x: f.x * SCALE, z: f.z * SCALE, rx: f.rx * SCALE, rz: f.rz * SCALE }));

// 分かれ道の高さを決めておく所(谷の集落など)。ほかは山の形と前後の道から決める
export const NODE_HEIGHT = { start: 16, yJunc: 14, gas: 17, cross: 50, onsen: 47 };
// トンネルの入口は山の斜面の途中に(まわりの山より下げる量)
export const NODE_SINK = { tunS: 30, tunN: 30 };
