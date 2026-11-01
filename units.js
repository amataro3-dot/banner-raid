/* BANNER RAID のキャラ・敵の数値。強さの調整はここだけ直せばよい。
   - 長さ(range・ブロックの届く距離)は「マス」。速さ(spd)は「マス/秒」。rate は「何秒に1回」。
   - block: 足止めできる敵の数(0 = 足止めしない)。
   - レベルは 1〜3。Lv が1上がるごとに 攻撃・回復 ×LV_POW、HP ×LV_HP。 */

const LV_MAX = 3;
const LV_POW = 1.4;
const LV_HP = 1.3;
const REVIVE_SEC = 12;          // 倒れてから自然に復活するまでの秒数
const REVIVE_COST = 0.3;        // すぐ復活の値段 = 置く値段 × これ
const LVUP_COST = 0.7;          // Lv を上げる値段 = 置く値段 × これ × 今の Lv
const SELL_BACK = 0.5;          // 下げると、使ったコインのこれだけ戻る

/* role: atk アタッカー / tank タンク / heal ヒーラー / sup サポート */
const UNITS = {
  sword:    { name: 'ソード',     icon: '🗡️', role: 'atk',  cost: 50, hp: 150, dmg: 28, rate: 0.8, range: 1.1, block: 1,
              desc: '近くの1体に大ダメージ。1体だけ足止めできる' },
  archer:   { name: 'アーチャー', icon: '🏹', role: 'atk',  cost: 50, hp: 70,  dmg: 10, rate: 0.45, range: 2.6, block: 0,
              desc: '遠くまで速く撃つ' },
  mage:     { name: 'メイジ',     icon: '🔮', role: 'atk',  cost: 70, hp: 70,  dmg: 16, rate: 1.3, range: 2.2, block: 0, splash: 0.9,
              desc: 'まとめて攻撃(当たったまわりにもダメージ)' },
  sniper:   { name: 'スナイパー', icon: '🎯', role: 'atk',  cost: 80, hp: 60,  dmg: 75, rate: 2.6, range: 5,   block: 0, target: 'maxhp',
              desc: '射程がとても長く、撃つのは遅い。HPの多い敵をねらう' },
  knight:   { name: 'ナイト',     icon: '🛡️', role: 'tank', cost: 60, hp: 330, dmg: 12,  rate: 1.0, range: 1.1, block: 2,
              desc: '敵を2体まで足止めする' },
  golem:    { name: 'ゴーレム',   icon: '🪨', role: 'tank', cost: 70, hp: 620, dmg: 8,  rate: 1.4, range: 1.1, block: 3, taunt: true,
              desc: 'HPがとても多い。3体まで足止めし、敵の攻撃を引きつける' },
  paladin:  { name: 'パラディン', icon: '⚜️', role: 'tank', cost: 80, hp: 380, dmg: 14, rate: 1.0, range: 1.1, block: 2, reflect: 0.3, regen: 4,
              desc: '受けたダメージの一部をはね返す。少しずつ自分も回復' },
  cleric:   { name: 'クレリック', icon: '➕', role: 'heal', cost: 60, hp: 80,  heal: 45, rate: 1.6, range: 2.1, block: 0,
              desc: 'いちばん弱っている1体を大きく回復' },
  shaman:   { name: 'シャーマン', icon: '🌿', role: 'heal', cost: 60, hp: 90,  heal: 12, rate: 1.5, range: 1.6, block: 0, healAll: true,
              desc: 'まわりの味方をみんな少しずつ回復' },
  frost:    { name: 'フロスト',   icon: '❄️', role: 'sup',  cost: 55, hp: 80,  dmg: 4,  rate: 0.9, range: 1.8, block: 0, slow: 0.45,
              desc: 'まわりの敵をみんな遅くする' },
  bard:     { name: 'バード',     icon: '🎵', role: 'sup',  cost: 55, hp: 80,  range: 1.6, block: 0, haste: 1.35,
              desc: 'まわりの味方の攻撃を速くする' },
  merchant: { name: 'マーチャント', icon: '💰', role: 'sup', cost: 60, hp: 60,  coin: 5, rate: 5, range: 0, block: 0,
              desc: '戦わないかわりに、時間でコインを稼ぐ' },
};
const UNIT_KEYS = Object.keys(UNITS);
const ROLE_NAME = { atk: 'アタッカー', tank: 'タンク', heal: 'ヒーラー', sup: 'サポート' };

/* 敵。dmg は足止めしたキャラへの攻撃、base は旗(基地)まで来たときのダメージ、coin は倒したときのコイン */
const ENEMIES = {
  goblin:   { icon: '👺', hp: 55,  spd: 0.9, dmg: 8,  rate: 1.0, base: 1, coin: 5 },
  wolf:     { icon: '🐺', hp: 40,  spd: 1.6, dmg: 6,  rate: 0.8, base: 1, coin: 5 },
  orc:      { icon: '👹', hp: 220, spd: 0.6, dmg: 20, rate: 1.2, base: 2, coin: 12 },
  skeleton: { icon: '💀', hp: 70,  spd: 0.8, dmg: 7,  rate: 1.2, base: 1, coin: 6, shoot: 1.8 },  // 歩きながら近くのキャラを撃つ
  assassin: { icon: '🥷', hp: 320, spd: 1.1, dmg: 22, rate: 0.9, base: 3, coin: 15 },           // 刺客
};

const START_COIN = 150;
const BANNER_HP = 20;
const PASSIVE_COIN = 2;         // 何もしなくても、2秒ごとにもらえるコイン
const ASSASSIN_COST = 40;       // 刺客を送る値段
const WAVE_SEC = 18;            // 野良の敵の波の間隔
const RAMP_SEC = 300;           // この秒数をすぎたら、敵がどんどん強くなる
