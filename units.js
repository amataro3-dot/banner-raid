/* BANNER RAID の数値(キャラ10体・Lv3まで。v=11 で強さを調整)。強さの調整はここだけ直せばよい。
   - 道の長さは 100(自分の城 0 → 相手の城 100)。range・spd もこの長さで数える(spd は 1秒に進む長さ)。
   - rate は「何秒に1回」。cd は出撃したあと、次に出せるまでの秒数。size は絵の大きさ(1 がふつう)。
   - キャラは lv[0]〜lv[2] が Lv1〜Lv3。Lv2・Lv3 は、前のレベルから変わるところだけ書く。
     img・name を書いたレベルで進化する(絵と名前が変わる)。
   - レベルは試合中にコインで上げる。上げたあとに出すキャラから強くなる(もう出ているキャラはそのまま)。 */

const LANE = 100;
const CASTLE_HP = 2500;
const START_COIN = 250;
const COIN_PER_SEC = 18;
const COIN_MAX = 2000;
const KILL_BONUS = 0.25;        // 敵を倒すと、その敵の値段 × これのコイン
const TIME_LIMIT = 300;         // 5分。すぎたら城のHPが多いほうの勝ち
const LV_MAX = 3;

/* 城の一撃: たまるまでの秒数、届く範囲(自分の城から)、ダメージ、押し返す長さ。道を1本選んで撃つ(v=9〜) */
const STRIKE = { charge: 30, reach: 25, dmg: 450, push: 8 };

/* 道のまん中の旗(v=9〜): 場所、取り合う範囲(旗から前後)、取るのにかかる秒数、取っているあいだ1秒にふえるコイン
   範囲の中にいるキャラ(戦わないキャラはのぞく)が多いほうへ、旗が少しずつかたむく */
const FLAG = { at: 50, zone: 12, capture: 3, coin: 6 };

/* role: atk アタッカー / tank タンク / heal ヒーラー / sup サポート
   up: [Lv2 にする値段, Lv3 にする値段]
   とくべつな力: crit(会心の確率) / pierce(前に並んだ何体まで当たる) / splash(まわりにも当たる長さ) / slowOnHit(当てた敵を遅くする)
   sniper(城とHPの多い敵をねらう) / reflect(受けたダメージをはね返す割合) / regen(1秒に回復) / heal・healAll(回復)
   haste(まわりの攻撃を速く) / hasteMove(まわりの歩きを速く) / coin(1秒にふえるコイン) / repair(1秒に城を直す) / gauge(城の一撃が速くたまる割合) / stopAt(城からこの長さで止まる) */
const UNITS = {
  sword: { role: 'atk', cost: 50, cd: 3, up: [50, 100], lv: [
    { name: 'ソード', img: 'sword', hp: 260, dmg: 45, rate: 1.0, range: 6, spd: 9, desc: '近接。1体に大ダメージ。HPは低い。安くてすぐ出せる' },
    { dmg: 60, desc: '攻撃力アップ' },
    { crit: 0.25, desc: 'ときどき2倍ダメージ(会心の一撃)' } ] },
  archer: { role: 'atk', cost: 65, cd: 4, up: [65, 130], lv: [
    { name: 'アーチャー', img: 'archer', hp: 150, dmg: 20, rate: 0.95, range: 22, spd: 8, desc: '遠くから速く撃つ' },
    { rate: 0.7, desc: '撃つのが速くなる' },
    { name: 'スナイパー', img: 'sniper', hp: 170, dmg: 130, rate: 2.6, range: 42, spd: 6, sniper: true, desc: '射程がとても長い。城やHPの多い敵をねらう' } ] },
  mage: { role: 'atk', cost: 100, cd: 8, up: [100, 200], lv: [
    { name: 'メイジ', img: 'mage', hp: 160, dmg: 45, rate: 1.8, range: 18, spd: 7, splash: 8, desc: 'まとめて攻撃。かたまった敵に強い' },
    { splash: 12, desc: '攻撃の範囲が広がる' },
    { name: 'フロスト', img: 'frost', hp: 180, rate: 1.6, slowOnHit: 0.45, desc: 'まとめて攻撃して、敵を遅くする' } ] },
  lancer: { role: 'atk', cost: 70, cd: 4, up: [70, 140], lv: [
    { name: 'ランサー', img: 'lancer', hp: 220, dmg: 32, rate: 1.1, range: 10, spd: 8, pierce: 2, desc: '少し遠くから突く。前に並んだ2体に当たる' },
    { dmg: 44, desc: '攻撃力アップ' },
    { pierce: 3, desc: '前に並んだ3体までつらぬく' } ] },
  knight: { role: 'tank', cost: 80, cd: 5, up: [80, 160], lv: [
    { name: 'ナイト', img: 'knight', hp: 700, dmg: 18, rate: 1.1, range: 6, spd: 7, desc: 'HPが高く、前で敵を止める。攻撃は弱い' },
    { hp: 950, desc: 'HPアップ' },
    { name: 'パラディン', img: 'paladin', hp: 1100, dmg: 26, reflect: 0.3, regen: 8, desc: '受けたダメージの一部をはね返す。少しずつ自分も回復' } ] },
  golem: { role: 'tank', cost: 130, cd: 14, up: [130, 260], lv: [
    { name: 'ゴーレム', img: 'golem', hp: 1900, dmg: 32, rate: 1.6, range: 6, spd: 5, size: 1.25, desc: 'HPがとても多い。歩くのは遅い' },
    { hp: 2500, desc: 'HPアップ' },
    { splash: 8, desc: '攻撃がまわりの敵にも当たる(地ならし)' } ] },
  cleric: { role: 'heal', cost: 85, cd: 9, up: [85, 170], lv: [
    { name: 'クレリック', img: 'cleric', hp: 150, heal: 70, rate: 1.6, range: 18, spd: 7, desc: '味方1体を大きく回復' },
    { heal: 95, desc: '回復量アップ' },
    { name: 'シャーマン', img: 'shaman', hp: 190, heal: 30, healAll: true, rate: 1.3, range: 16, desc: 'まわりの味方をみんな回復' } ] },
  bard: { role: 'sup', cost: 55, cd: 8, up: [55, 110], lv: [
    { name: 'バード', img: 'bard', hp: 160, range: 14, spd: 7, haste: 1.4, dmg: 12, rate: 1.0, desc: 'まわりの味方の攻撃を速くする。自分も弱く攻撃する' },
    { range: 20, desc: '効果の範囲が広がる' },
    { haste: 1.5, hasteMove: 1.3, desc: '攻撃だけでなく、歩く速さも上がる' } ] },
  merchant: { role: 'sup', cost: 100, cd: 15, up: [100, 200], lv: [
    { name: 'マーチャント', img: 'merchant', hp: 220, range: 0, spd: 3, coin: 5, stopAt: 10, desc: '戦わない。出撃しているあいだ、コインのたまる速さが上がる' },
    { coin: 8, desc: '稼ぐコインが増える' },
    { coin: 12, desc: 'さらに増える' } ] },
  engineer: { role: 'sup', cost: 80, cd: 12, up: [80, 160], lv: [
    { name: 'エンジニア', img: 'engineer', hp: 200, range: 0, spd: 3, repair: 12, stopAt: 6, desc: '戦わない。城のそばで、城を少しずつ直す' },
    { repair: 20, desc: '城を直す量が増える' },
    { gauge: 0.5, desc: '城の一撃のゲージも速くたまる' } ] },
};
const UNIT_KEYS = Object.keys(UNITS);
const ROLE_NAME = { atk: 'アタッカー', tank: 'タンク', heal: 'ヒーラー', sup: 'サポート' };

/* レベルごとの数値をまとめる(Lv1 から順に、変わるところを重ねる) */
for (const k of UNIT_KEYS) {
  const u = UNITS[k]; let cur = {};
  u.stats = u.lv.map(l => (cur = Object.assign({}, cur, l, { cost: u.cost, cd: u.cd, role: u.role })));
}

/* ひとりで練習の CPU 軍(絵: img/e-○○.png)。CPU もコインで強化する(HP・攻撃が Lv2 ×1.3 / Lv3 ×1.6) */
const ENEMIES = {
  goblin:   { name: 'ゴブリン',     cost: 40,  cd: 2.5, hp: 220,  dmg: 35, rate: 1.0, range: 6,  spd: 8 },
  wolf:     { name: 'オオカミ',     cost: 55,  cd: 3,   hp: 160,  dmg: 30, rate: 0.7, range: 6,  spd: 16 },
  orc:      { name: 'オーク',       cost: 145, cd: 10,  hp: 1100, dmg: 60, rate: 1.4, range: 7,  spd: 5, size: 1.2 },
  skeleton: { name: 'ガイコツ弓兵', cost: 75,  cd: 4,   hp: 150,  dmg: 22, rate: 1.0, range: 22, spd: 7 },
  assassin: { name: '刺客',         cost: 215, cd: 14,  hp: 900,  dmg: 90, rate: 0.9, range: 6,  spd: 11, size: 1.1 },
};
const ENEMY_LV = [1, 1.3, 1.6];
const ENEMY_UP = [1, 2];        // CPU が強化する値段 = 値段 × これ

/* CPU の強さ(コインのたまる速さの倍率)。CPU は最初の CPU_WAIT 秒は出撃しない */
const CPU_WAIT = 8;
const CPU_LEVELS = { easy: 0.6, normal: 0.85, hard: 1.1 };
