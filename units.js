/* BANNER RAID の数値(v=2: キャラが攻めていくタイプ)。強さの調整はここだけ直せばよい。
   - 道の長さは 100(自分の城 0 → 相手の城 100)。range・spd もこの長さで数える(spd は 1秒に進む長さ)。
   - rate は「何秒に1回」。cd は出撃したあと、次に出せるまでの秒数。
   - size は絵の大きさ(1 がふつう)。 */

const LANE = 100;
const CASTLE_HP = 5000;
const START_COIN = 250;
const COIN_PER_SEC = 18;
const COIN_MAX = 2000;
const KILL_BONUS = 0.25;        // 敵を倒すと、その敵の値段 × これのコイン
const TIME_LIMIT = 300;         // 5分。すぎたら城のHPが多いほうの勝ち

/* 城の一撃: たまるまでの秒数、届く範囲(自分の城から)、ダメージ、押し返す長さ */
const STRIKE = { charge: 30, reach: 25, dmg: 300, push: 8 };

/* role: atk アタッカー / tank タンク / heal ヒーラー / sup サポート */
const UNITS = {
  sword:    { name: 'ソード',     role: 'atk',  cost: 75,  cd: 3,  hp: 260,  dmg: 45, rate: 1.0, range: 6,  spd: 9,
              desc: '近接。1体に大ダメージ。安くてすぐ出せる' },
  archer:   { name: 'アーチャー', role: 'atk',  cost: 100, cd: 4,  hp: 150,  dmg: 20, rate: 0.8, range: 22, spd: 8,
              desc: '遠くから速く撃つ' },
  mage:     { name: 'メイジ',     role: 'atk',  cost: 150, cd: 8,  hp: 160,  dmg: 45, rate: 1.8, range: 18, spd: 7, splash: 8,
              desc: 'まとめて攻撃。かたまった敵に強い' },
  sniper:   { name: 'スナイパー', role: 'atk',  cost: 260, cd: 12, hp: 140,  dmg: 130, rate: 3.0, range: 42, spd: 6, sniper: true,
              desc: '射程がとても長い。城やHPの多い敵をねらう。撃つのは遅い' },
  knight:   { name: 'ナイト',     role: 'tank', cost: 120, cd: 5,  hp: 700,  dmg: 18, rate: 1.1, range: 6,  spd: 7,
              desc: 'かたくて、前で敵を止める' },
  golem:    { name: 'ゴーレム',   role: 'tank', cost: 240, cd: 14, hp: 1900, dmg: 32, rate: 1.6, range: 6,  spd: 4, size: 1.25,
              desc: 'HPがとても多い。歩くのは遅い' },
  paladin:  { name: 'パラディン', role: 'tank', cost: 180, cd: 10, hp: 1000, dmg: 26, rate: 1.1, range: 6,  spd: 6, reflect: 0.3, regen: 8,
              desc: '受けたダメージの一部をはね返す。少しずつ自分も回復' },
  cleric:   { name: 'クレリック', role: 'heal', cost: 130, cd: 9,  hp: 150,  heal: 70, rate: 1.6, range: 18, spd: 7,
              desc: '味方1体を大きく回復' },
  shaman:   { name: 'シャーマン', role: 'heal', cost: 130, cd: 9,  hp: 170,  heal: 18, rate: 1.3, range: 14, spd: 7, healAll: true,
              desc: 'まわりの味方をみんな少しずつ回復' },
  frost:    { name: 'フロスト',   role: 'sup',  cost: 120, cd: 8,  hp: 160,  dmg: 15,  rate: 1.0, range: 14, spd: 7, slow: 0.45,
              desc: 'まわりの敵をみんな遅くする' },
  bard:     { name: 'バード',     role: 'sup',  cost: 110, cd: 8,  hp: 160,  range: 14, spd: 7, haste: 1.5,
              desc: 'まわりの味方の攻撃を速くする' },
  merchant: { name: 'マーチャント', role: 'sup', cost: 150, cd: 15, hp: 220,  range: 0,  spd: 3, coin: 5, stopAt: 10,
              desc: '戦わない。出撃しているあいだ、コインのたまる速さが上がる' },
};
const UNIT_KEYS = Object.keys(UNITS);
const ROLE_NAME = { atk: 'アタッカー', tank: 'タンク', heal: 'ヒーラー', sup: 'サポート' };

/* ひとりで練習の CPU 軍(絵: img/e-○○.png) */
const ENEMIES = {
  goblin:   { name: 'ゴブリン',   cost: 60,  cd: 2.5,  hp: 220,  dmg: 35, rate: 1.0, range: 6,  spd: 8 },
  wolf:     { name: 'オオカミ',   cost: 80,  cd: 3,  hp: 160,  dmg: 30, rate: 0.7, range: 6,  spd: 16 },
  orc:      { name: 'オーク',     cost: 220, cd: 10, hp: 1100, dmg: 60, rate: 1.4, range: 7,  spd: 5, size: 1.2 },
  skeleton: { name: 'ガイコツ弓兵', cost: 110, cd: 4, hp: 150, dmg: 22, rate: 1.0, range: 22, spd: 7 },
  assassin: { name: '刺客',       cost: 320, cd: 14, hp: 900,  dmg: 90, rate: 0.9, range: 6,  spd: 11, size: 1.1 },
};

/* CPU の強さ(コインのたまる速さの倍率)。CPU は最初の CPU_WAIT 秒は出撃しない */
const CPU_WAIT = 8;
const CPU_LEVELS = { easy: 0.5, normal: 0.7, hard: 0.95 };
