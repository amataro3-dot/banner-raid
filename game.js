/* BANNER RAID 本体(キャラが相手の城へ攻めていくタイプ。ひとりで練習 = CPU対戦。v=7 からキャラ10体・Lv3まで)
   画面: home(ホーム)→ draft(キャラ選び)→ play(対戦)→ end(結果)
   - 戦場の計算は sim() だけ。1秒に30コマ(TICK)で進み、ランダムはシード付き(rng)。
     オンライン対戦では「何コマ目に・だれが・何を出したか」だけをやりとりして、2人のスマホで同じ計算をする予定。
   - 陣営: side 0 = 自分(下の城、道の 0)、side 1 = 相手(上の城、道の LANE)。 */

const $ = id => document.getElementById(id);
const app = $('app');
const LS = { get(k) { try { return localStorage.getItem(k) } catch (e) { return null } }, set(k, v) { try { localStorage.setItem(k, v) } catch (e) { } } };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const FOOT = () => `<p class="dim foot"><a href="${sitePath('/')}">${T("Muddy's Games トップ")}</a>・<a href="${sitePath('/privacy.html')}">${T('プライバシーポリシー')}</a></p>`;

/* 絵。?v= の番号は、この game.js を読んだときの番号と同じにする(キャッシュよけ) */
const ASSET_V = ((document.currentScript && document.currentScript.src.match(/\?v=([^&#]+)/)) || [])[1] || '0';
const IMG = {};
function img(key) {
  if (!IMG[key]) { const im = new Image(); im.src = (window.IMG_DATA && window.IMG_DATA[key]) || `img/${key}.png?v=${ASSET_V}`; IMG[key] = im; }
  return IMG[key];
}
const imgSrc = key => img(key).src;
UNIT_KEYS.forEach(k => UNITS[k].stats.forEach(st => img(st.img)));   // CPU軍(ゴブリンたち)の絵は v=10 から使っていない(しまってある)

/* ---------- 計算のきまり ---------- */
const TICK = 1 / 30;
function makeRng(seed) {   // mulberry32(同じ種なら、どのスマホでも同じ並び)
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const DIR = [1, -1];
const homeP = s => (s === 0 ? 0 : LANE);
const fromHome = (s, p) => (s === 0 ? p : LANE - p);   // 自分の城からの長さ

/* ---------- 対戦の状態 ---------- */
let B = null;
let picks = (LS.get('br-picks') || '').split(',').filter(k => UNITS[k]).slice(0, 4);
let cpuLevel = CPU_LEVELS[LS.get('br-cpu')] ? LS.get('br-cpu') : 'normal';
let laneCount = [1, 2, 3].includes(+LS.get('br-lanes')) ? +LS.get('br-lanes') : 2;   // 道の数(基本は2本。1本・3本も選べる)

/* 対戦に出る人(プレイヤー)は B.pl。1人ずつ、陣営・コイン・待ち時間・レベル・4体を持つ。
   陣営(side)は 0 と 1。城・城の一撃のゲージ・旗は陣営で共有(チーム戦では1つの陣営に何人もいる)。
   opt.online: { players: [{ side, deck }, ...], lanes } のときはオンライン対戦(CPU なし)。
   ひとりで練習: pl[0] = 自分(side 0)、pl[1] = CPU(side 1)。 */
function newBattle(seed, opt) {
  const on = opt && opt.online, lanes = on ? on.lanes : laneCount;
  const mk = (side, deck, coin, rate, kind) => ({ side, deck: deck.slice(), coin, rate, kind: kind || 'u', cd: {}, lv: {}, spent: 0 });
  const pl = on ? on.players.map(p => mk(p.side, p.deck, START_COIN, 1))
    : [mk(0, picks, START_COIN, 1), mk(1, [], START_COIN * 0.6, CPU_LEVELS[cpuLevel])];   // kind 'e' にすると CPU軍(ゴブリンたち)で戦う
  const size = [0, 1].map(sd => Math.max(1, pl.filter(p => p.side === sd).length));
  B = {
    tick: 0, t: 0, rng: makeRng(seed || 1), uid: 1, lanes, pl,
    castleMax: size.map(n => CASTLE_HP * n), castle: size.map(n => CASTLE_HP * n), gauge: [0, 0],
    flags: Array.from({ length: lanes }, () => ({ own: -1, prog: 0 })),   // prog: +1 で side 0、-1 で side 1 のもの
    cpu: !on, online: !!on,
    units: [], fx: [], over: null, kills: [0, 0],
    ai: { next: null, think: 0 },
    speed: 1, paused: false,
  };
  if (!on) pl[1].deck = cpuDeck(B.rng);
}
const sideOf = p => B.pl[p].side;
const lvOf = (p, k) => B.pl[p].lv[k] || 1;
/* いまのレベルの数値(CPU軍は HP・攻撃を ENEMY_LV 倍) */
function defOf(p, k) {
  if (B.pl[p].kind === 'u') return UNITS[k] && UNITS[k].stats[lvOf(p, k) - 1];
  const e = ENEMIES[k]; if (!e) return null;
  const m = ENEMY_LV[lvOf(p, k) - 1];
  return Object.assign({}, e, { hp: Math.round(e.hp * m), dmg: Math.round(e.dmg * m), img: 'e-' + k });
}
const upCost = (p, k) => (B.pl[p].kind === 'u' ? UNITS[k].up[lvOf(p, k) - 1] : Math.round(ENEMIES[k].cost * ENEMY_UP[lvOf(p, k) - 1]));
/* レベルアップ(これから出すキャラから強くなる) */
function levelUp(p, k) {
  const P = B.pl[p];
  if (B.over || !P || !P.deck.includes(k) || lvOf(p, k) >= LV_MAX) return false;
  const c = upCost(p, k);
  if (P.coin < c) return false;
  P.coin -= c; P.spent += c;
  P.lv[k] = lvOf(p, k) + 1;
  return true;
}

/* 出撃 */
function canSpawn(p, k) {
  const P = B.pl[p]; if (!P) return false;
  const d = defOf(p, k);
  return d && !B.over && P.deck.includes(k) && P.coin >= d.cost && !(P.cd[k] > 0);
}
function spawn(p, k, lane) {
  if (!canSpawn(p, k)) return false;
  const P = B.pl[p], d = defOf(p, k), side = P.side;
  P.coin -= d.cost; P.spent += d.cost;
  P.cd[k] = d.cd;
  lane = Math.max(0, Math.min(B.lanes - 1, lane | 0));
  B.units.push({ id: B.uid++, side, owner: p, k, d, lane, img: d.img, lv: lvOf(p, k), p: homeP(side) + DIR[side] * 3, hp: d.hp, max: d.hp, atkT: 0.3, slowT: 0, x: B.rng() * 2 - 1, hitT: 0, act: 0 });
  return true;
}

/* 城の一撃(陣営で1つのゲージ。チームのだれが撃ってもいい) */
function strike(side, lane) {
  if (B.over || B.gauge[side] < STRIKE.charge) return false;
  lane = Math.max(0, Math.min(B.lanes - 1, lane | 0));
  B.gauge[side] = 0;
  for (const u of B.units) if (u.side !== side && u.hp > 0 && u.lane === lane && fromHome(side, u.p) <= STRIKE.reach) {
    hurt(u, STRIKE.dmg, side);
    u.p += DIR[1 - side] * -STRIKE.push;   // 城から遠ざける
    u.p = Math.max(0, Math.min(LANE, u.p));
  }
  B.fx.push({ strike: side, l: lane, t: 0.6 });
  return true;
}

/* 倒したときのコインは、倒した陣営の人で分ける */
function hurt(u, v, bySide) {
  if (u.hp <= 0) return;
  u.hp -= v; u.hitT = 0.12;
  if (u.hp <= 0) {
    u.dead = true; B.kills[bySide]++;
    const team = B.pl.filter(P => P.side === bySide), c = Math.round(u.d.cost * KILL_BONUS / Math.max(1, team.length));
    for (const P of team) P.coin = Math.min(COIN_MAX, P.coin + c);
    B.fx.push({ boom: true, p: u.p, x: u.x, l: u.lane, t: 0.4 });
  }
}

/* ---------- 1コマ進める ---------- */
function sim() {
  if (B.over) return;
  const dt = TICK;
  B.tick++; B.t = B.tick * TICK;

  for (const s of [0, 1]) {
    let fix = 0, boost = 0;
    for (const u of B.units) if (u.side === s && u.hp > 0) { fix += u.d.repair || 0; boost += u.d.gauge || 0; }
    if (fix && B.castle[s] > 0) B.castle[s] = Math.min(B.castleMax[s], B.castle[s] + fix * dt);
    B.gauge[s] = Math.min(STRIKE.charge, B.gauge[s] + dt * (1 + Math.min(1, boost)));
  }
  // コインは1人ずつ(旗のぶんは、その陣営のみんなに)
  B.pl.forEach((P, i) => {
    let bonus = 0;
    for (const u of B.units) if (u.owner === i && u.hp > 0) bonus += u.d.coin || 0;
    for (const f of B.flags) if (f.own === P.side) bonus += FLAG.coin;
    P.coin = Math.min(COIN_MAX, P.coin + (COIN_PER_SEC * P.rate + bonus) * dt);
    for (const k in P.cd) if (P.cd[k] > 0) P.cd[k] -= dt;
  });
  flagStep(dt);
  if (B.cpu) cpuThink(dt);

  const live = B.units.filter(u => u.hp > 0);
  for (const u of live) {
    if (u.hp <= 0) continue;
    const d = u.d, s = u.side, dir = DIR[s], o = 1 - s;
    if (d.regen) u.hp = Math.min(u.max, u.hp + d.regen * dt);
    if (u.slowT > 0) u.slowT -= dt;
    if (u.hitT > 0) u.hitT -= dt;
    const slowF = u.slowT > 0 ? 1 - (u.slowP || 0.45) : 1;

    // 前にいる相手(前 = 自分の進む向き)。少しだけ重なっていても前とみなす
    let near = null, nd = Infinity;
    const foes = [];
    for (const v of live) if (v.side === o && v.hp > 0 && v.lane === u.lane) {
      const g = (v.p - u.p) * dir;
      if (g >= -1.5) { foes.push([v, g]); if (g < nd) { nd = g; near = v; } }
    }
    const castleGap = (homeP(o) - u.p) * dir;

    let haste = 1, hasteMove = 1;
    for (const b of live) if (b.side === s && b !== u && b.d.haste && b.hp > 0 && b.lane === u.lane && Math.abs(b.p - u.p) <= b.d.range) { haste = Math.max(haste, b.d.haste); hasteMove = Math.max(hasteMove, b.d.hasteMove || 1); }
    u.atkT -= dt * haste * (u.slowT > 0 ? 0.7 : 1);

    let stop = false;
    if (d.coin || d.repair) {
      stop = fromHome(s, u.p) >= d.stopAt || nd <= 3;
    } else if (d.heal) {
      stop = nd <= d.range || castleGap <= d.range;
      const hurtAllies = live.filter(a => a.side === s && a.hp > 0 && a.lane === u.lane && a.hp < a.max && Math.abs(a.p - u.p) <= d.range);
      if (hurtAllies.length && u.atkT <= 0) {
        if (d.healAll) hurtAllies.forEach(a => { a.hp = Math.min(a.max, a.hp + d.heal); B.fx.push({ ring: '#4caf50', p: a.p, x: a.x, l: u.lane, t: 0.35 }); });
        else { const a = hurtAllies.sort((a1, a2) => a1.hp / a1.max - a2.hp / a2.max || a1.id - a2.id)[0]; a.hp = Math.min(a.max, a.hp + d.heal); B.fx.push({ line: '#4caf50', p: u.p, x: u.x, p2: a.p, x2: a.x, l: u.lane, t: 0.25 }); }
        u.atkT = d.rate; u.act = 0.2;
      }
    } else if (d.haste) {
      stop = nd <= d.range || castleGap <= d.range;
      // バードも弱く攻撃する(いちばん近い相手、いなければ城)
      if (d.dmg && u.atkT <= 0) {
        const inR = foes.filter(([v, g]) => g <= d.range).sort((a1, a2) => a1[1] - a2[1] || a1[0].id - a2[0].id);
        if (inR.length) { hurt(inR[0][0], d.dmg, s); B.fx.push({ line: '#c9a6ff', p: u.p, x: u.x, p2: inR[0][0].p, x2: inR[0][0].x, l: u.lane, t: 0.15 }); u.atkT = d.rate; u.act = 0.2; }
        else if (castleGap <= d.range) { B.castle[o] = Math.max(0, B.castle[o] - d.dmg); u.atkT = d.rate; u.act = 0.2; }
      }
    } else if (d.slow) {
      stop = nd <= d.range || castleGap <= d.range;
      const inR = foes.filter(([v, g]) => g <= d.range);
      if (inR.length && u.atkT <= 0) {
        inR.forEach(([v]) => { v.slowT = 1.5; v.slowP = d.slow; hurt(v, d.dmg, s); });
        B.fx.push({ ring: '#7cc8ff', p: u.p, x: u.x, r: d.range, l: u.lane, t: 0.3 });
        u.atkT = d.rate; u.act = 0.2;
      }
    } else {
      // アタッカー・タンク・CPU軍: 射程に入った相手(または城)を攻撃
      const inR = foes.filter(([v, g]) => g <= d.range);
      const castleIn = castleGap <= d.range;
      stop = inR.length > 0 || castleIn;
      if (stop && u.atkT <= 0) {
        let tgt = null, dmg = d.dmg;
        if (d.crit && B.rng() < d.crit) { dmg *= 2; B.fx.push({ txt: '!!', p: u.p, x: u.x, l: u.lane, t: 0.5 }); }
        const slowIt = v => { if (d.slowOnHit) { v.slowT = 1.5; v.slowP = d.slowOnHit; } };
        if (d.sniper) tgt = castleIn ? 'castle' : inR.sort((a, b) => b[0].hp - a[0].hp || a[0].id - b[0].id)[0][0];
        else tgt = inR.length ? inR.sort((a, b) => a[1] - b[1] || a[0].id - b[0].id)[0][0] : 'castle';
        if (d.pierce && tgt !== 'castle') {
          const ts = inR.slice(0, d.pierce).map(a => a[0]);   // inR は近い順にならんでいる
          for (const v of ts) { hurt(v, dmg, s); slowIt(v); if (v.d.reflect) hurt(u, dmg * v.d.reflect, o); }
          B.fx.push({ line: '#fff', p: u.p, x: u.x, p2: ts[ts.length - 1].p, x2: ts[ts.length - 1].x, l: u.lane, t: 0.18 });
        } else if (tgt === 'castle') {
          B.castle[o] = Math.max(0, B.castle[o] - dmg);
          B.fx.push({ line: d.range > 8 ? '#ffd166' : '#fff', p: u.p, x: u.x, p2: homeP(o), x2: u.x * 0.3, l: u.lane, t: 0.15 });
        } else {
          hurt(tgt, dmg, s); slowIt(tgt);
          if (tgt.d.reflect) hurt(u, dmg * tgt.d.reflect, o);
          if (d.splash) {
            for (const [v] of foes) if (v !== tgt && Math.abs(v.p - tgt.p) <= d.splash) { hurt(v, dmg * 0.6, s); slowIt(v); }
            B.fx.push({ ring: '#b06cff', p: tgt.p, x: tgt.x, r: d.splash, l: u.lane, t: 0.3 });
          }
          B.fx.push({ line: d.range > 8 ? '#ffd166' : '#fff', p: u.p, x: u.x, p2: tgt.p, x2: tgt.x, l: u.lane, t: 0.15 });
        }
        u.atkT = d.rate; u.act = 0.2;
      }
    }
    if (u.act > 0) u.act -= dt;
    // 進む(相手の体を通りぬけない・城の前で止まる)
    if (!stop && nd > 2 && castleGap > 2) {
      u.p += dir * d.spd * slowF * hasteMove * dt;
      u.p = Math.max(0, Math.min(LANE, u.p));
    }
  }
  B.units = B.units.filter(u => u.hp > 0);
  for (const f of B.fx) f.t -= dt;
  B.fx = B.fx.filter(f => f.t > 0);

  if (B.castle[0] <= 0 || B.castle[1] <= 0) B.over = B.castle[1] <= 0 && B.castle[0] > 0 ? 'win' : B.castle[0] <= 0 && B.castle[1] > 0 ? 'lose' : 'draw';
  else if (B.t >= TIME_LIMIT) B.over = B.castle[0] > B.castle[1] ? 'win' : B.castle[0] < B.castle[1] ? 'lose' : 'draw';
}

/* 道のまん中の旗: 範囲にいるキャラが多いほうへかたむき、端まで行ったらその陣営のもの */
function flagStep(dt) {
  for (let l = 0; l < B.lanes; l++) {
    const f = B.flags[l]; let n0 = 0, n1 = 0;
    for (const u of B.units) if (u.hp > 0 && u.lane === l && !u.d.coin && !u.d.repair && Math.abs(u.p - FLAG.at) <= FLAG.zone) { if (u.side === 0) n0++; else n1++; }
    if (n0 !== n1) f.prog = Math.max(-1, Math.min(1, f.prog + Math.sign(n0 - n1) * dt / FLAG.capture));
    const was = f.own;
    if (f.prog >= 1) f.own = 0; else if (f.prog <= -1) f.own = 1;
    else if (f.own === 0 && f.prog <= 0) f.own = -1; else if (f.own === 1 && f.prog >= 0) f.own = -1;
    if (f.own !== was && f.own >= 0) B.fx.push({ flagGet: f.own, l, t: 0.8 });
  }
}

/* ---------- CPU(ひとりで練習) ---------- */
/* CPU の4体: 10体からランダム。戦わないキャラ(マーチャント・エンジニア)は1体まで、戦うキャラを最低1体は入れる */
function cpuDeck(rng) {
  const keys = UNIT_KEYS.slice(), out = [];
  while (out.length < 4) {
    const k = keys.splice(Math.floor(rng() * keys.length), 1)[0];
    const st = UNITS[k].stats[0], passive = !!(st.coin || st.repair);
    if (passive && out.some(o => UNITS[o].stats[0].coin || UNITS[o].stats[0].repair)) continue;
    out.push(k);
  }
  if (!out.some(k => UNITS[k].role === 'atk' || UNITS[k].role === 'tank')) out[3] = 'sword';
  return out;
}
/* 役割ごとの出しやすさ。戦わないキャラは、出ていないときだけ */
const AI_WEIGHT = { atk: 30, tank: 24, heal: 14, sup: 12 };
function cpuPick() {
  const ks = B.pl[1].deck.filter(k => {
    const st = UNITS[k].stats[0];
    if (st.coin || st.repair) return B.t > 15 && !B.units.some(u => u.side === 1 && u.k === k);
    if (st.heal || st.haste) return B.units.some(u => u.side === 1 && !u.d.heal && !u.d.haste && !u.d.coin && !u.d.repair);   // 前に立つ味方がいるときだけ
    return true;
  });
  if (!ks.length) return B.pl[1].deck[0];
  let sum = 0; for (const k of ks) sum += AI_WEIGHT[UNITS[k].role];
  let r = B.rng() * sum;
  for (const k of ks) { r -= AI_WEIGHT[UNITS[k].role]; if (r < 0) return k; }
  return ks[0];
}
/* 押されているときに急いで出す: いちばん安い、戦うキャラ */
const cpuCheap = () => B.pl[1].deck.filter(k => UNITS[k].role === 'atk' || UNITS[k].role === 'tank').sort((a, b) => UNITS[a].cost - UNITS[b].cost)[0];
function cpuThink(dt) {
  const A = B.ai;
  A.think -= dt; if (A.think > 0) return;
  if (B.t < CPU_WAIT) return;
  A.think = 0.5;
  // 城のまわりに相手が来たら、城の一撃
  if (B.gauge[1] >= STRIKE.charge) {
    for (let l = 0; l < B.lanes; l++) {
      const close = B.units.filter(u => u.side === 0 && u.lane === l && fromHome(1, u.p) <= STRIKE.reach);
      const closeHp = close.reduce((a, u) => a + u.hp, 0);
      if (close.length >= 3 || closeHp >= 900 || B.castle[1] < CASTLE_HP * 0.35 && close.length) { strike(1, l); break; }
    }
  }
  // 押されていたら、安いのを急いで出す
  const danger = B.units.some(u => u.side === 0 && fromHome(1, u.p) <= 30);
  const cheap = cpuCheap();
  if (danger && cheap && canSpawn(1, cheap) && B.rng() < 0.5) { spawn(1, cheap, cpuLane(true)); return; }
  if (!A.next || B.pl[1].cd[A.next] > 3) A.next = cpuPick();
  if (canSpawn(1, A.next)) { spawn(1, A.next, cpuLane(false)); A.next = null; return; }
  // コインがあまっていたら、ときどき強化
  if (B.t > 30 && B.rng() < 0.15) {
    const ks = B.pl[1].deck.filter(k => lvOf(1, k) < LV_MAX && B.pl[1].coin >= upCost(1, k) + 120);
    if (ks.length) levelUp(1, ks[Math.floor(B.rng() * ks.length)]);
  }
}
/* CPU が出す道: 押されている道を守る。ほかは、相手が強い道(+ランダム) */
function cpuLane(defend) {
  if (B.lanes === 1) return 0;
  let best = 0, bs = -Infinity;
  for (let l = 0; l < B.lanes; l++) {
    let threat = 0, mine = 0;
    for (const u of B.units) if (u.lane === l) { if (u.side === 0) threat += u.hp * (1 + (LANE - fromHome(1, u.p)) / LANE); else mine += u.hp; }
    const sc = (defend ? threat * 2 : threat) - mine + (B.flags[l].own === 0 ? 500 : B.flags[l].own === -1 ? 200 : 0) + B.rng() * 400;
    if (sc > bs) { bs = sc; best = l; }
  }
  return best;
}

/* ---------- 画面: ホーム ---------- */
function home() {
  stopLoop();
  app.innerHTML = `
  <h1 class="title">BANNER RAID</h1>
  <div class="dim">${T('キャラを出撃させて、相手の城を落とせ！')}</div>
  ${langSwitchHtml()}
  <div class="card left">
    <div class="lbl">${T('遊び方')}</div>
    <div>${T('① 10体のキャラから4体を選ぶ')}</div>
    <div>${T('⬆ でキャラのレベルを上げられる(Lv3まで)。4体は Lv3 で進化する')}</div>
    <div>${T('② コインは時間でたまる。キャラのボタンを道までドラッグして出撃')}</div>
    <div>${T('③ キャラは相手の城へ進み、ぶつかった敵と戦う')}</div>
    <div>${T('④ ゲージがたまったら「城の一撃」。道を1本選んで、城のまわりの敵を一気に攻撃')}</div>
    <div>${T('⑤ 道のまん中の旗のまわりに、相手より多くキャラがいると旗が取れる。取った旗の数だけコインが多くたまる')}</div>
    <div>${T('⑥ 相手の城のHPを先に0にしたほうが勝ち(5分たったら、城のHPが多いほうの勝ち)')}</div>
  </div>
  <button id="solo" class="wide">${T('ひとりで練習(CPU対戦)')}</button>
  ${window.NO_ONLINE ? `<button class="wide sub" disabled>${T('オンライン対戦は muddys-games.com で遊べます')}</button>` : `<button id="online" class="wide">${T('オンライン対戦(8人まで)')}</button>`}
  <div class="dim small">${T('試作版です。キャラの強さは、遊びながら調整します')}</div>
  ${FOOT()}`;
  langSwitchInit(() => { });
  $('solo').onclick = () => draft();
  if ($('online')) $('online').onclick = () => netHome();
}

/* ---------- 画面: キャラ選び ---------- */
/* online を渡すと、オンライン対戦のキャラ選び(CPU の強さ・道の数はなし。「決定」で net.js へ) */
function draft(online) {
  stopLoop();
  const cards = UNIT_KEYS.map(k => {
    const u = UNITS[k], on = picks.includes(k), a = u.stats[0], z = u.stats[2], evo = z.img !== a.img;
    return `<button class="ucard ${on ? 'on' : ''} r-${u.role}" data-k="${k}">
      <img src="${imgSrc(a.img)}" alt="">
      <span class="nm">${T(a.name)}</span>
      <span class="rl">${T(ROLE_NAME[u.role])}・${u.cost}</span>
      <span class="ds">${T(a.desc)}</span>
      <span class="ev">${evo ? `<img src="${imgSrc(z.img)}" alt="">${T('Lv3で{name}に進化', { name: T(z.name) })}` : `Lv3: ${T(z.desc)}`}</span>
    </button>`;
  }).join('');
  const lv = ['easy', 'normal', 'hard'].map(l => `<button class="sub mini ${l === cpuLevel ? 'on' : ''}" data-lv="${l}">${T({ easy: 'かんたん', normal: 'ふつう', hard: 'むずかしい' }[l])}</button>`).join('');
  const ln = [1, 2, 3].map(n => `<button class="sub mini ${n === laneCount ? 'on' : ''}" data-ln="${n}">${T('{n}本', { n })}</button>`).join('');
  app.innerHTML = `
  <h1>${T('キャラを4体選ぶ')}</h1>
  <div class="dim">${T('選んだ4体だけを、試合で出撃できます({n}/4)', { n: picks.length })}</div>
  <div class="ugrid">${cards}</div>
  ${online ? `<div class="dim small">${online.note || ''}</div>` : `<div class="seg"><span class="dim small">${T('CPUの強さ')}</span> ${lv}</div>
  <div class="seg"><span class="dim small">${T('道の数')}</span> ${ln}</div>`}
  <button id="go" class="wide" ${picks.length === 4 ? '' : 'disabled'}>${online ? T('これで決定') : T('出陣！')}</button>
  <button id="back" class="sub">${online ? T('部屋を出る') : T('もどる')}</button>`;
  app.querySelectorAll('.ucard').forEach(b => b.onclick = () => {
    const k = b.dataset.k;
    if (picks.includes(k)) picks = picks.filter(x => x !== k);
    else if (picks.length < 4) picks.push(k);
    else return;
    const y = window.scrollY; draft(online); window.scrollTo(0, y);
  });
  app.querySelectorAll('[data-lv]').forEach(b => b.onclick = () => { cpuLevel = b.dataset.lv; LS.set('br-cpu', cpuLevel); const y = window.scrollY; draft(); window.scrollTo(0, y); });
  app.querySelectorAll('[data-ln]').forEach(b => b.onclick = () => { laneCount = +b.dataset.ln; LS.set('br-lanes', laneCount); const y = window.scrollY; draft(); window.scrollTo(0, y); });
  $('go').onclick = () => { LS.set('br-picks', picks.join(',')); if (online) online.done(picks.slice()); else play(); };
  $('back').onclick = () => (online ? netLeave() : home());
}

/* ---------- 画面: 対戦 ---------- */
let cv, cx, W = 360, H = 480, raf = 0, lastT = 0, acc = 0, intro = 0;
let ME = 0, MS = 0;   // ME = 自分のプレイヤー番号(B.pl の何番目。観戦は -1)、MS = 自分の陣営(画面は MS の城が下になる)
const foeName = () => sideName(1 - MS);
/* 自分の操作: ひとりで練習ならすぐ、オンラインなら少しあとのコマで2人同時に(net.js) */
function act(a, k, lane) {
  if (B.online) return netSend(a, k, lane);
  if (a === 's') return spawn(0, k, lane);
  if (a === 'u') return levelUp(0, k);
  if (a === 'x') return strike(0, lane);
}
/* opt を渡すとオンライン対戦(newBattle の opt と同じ。opt.side が自分の陣営) */
function play(opt) {
  newBattle(opt ? opt.seed : (Date.now() & 0x7fffffff) | 1, opt && { online: opt });
  ME = opt ? opt.me : 0; MS = opt ? opt.view : 0;
  const spec = ME < 0, deck = spec ? [] : B.pl[ME].deck;   // 観戦のときは、出撃ボタンなし
  app.innerHTML = `
  <div class="hud">
    <div class="hp foe"><span>${T('相手の城')}</span><i><b id="hc"></b></i><em id="hcn"></em></div>
    <div class="dim" id="ht">5:00</div>
  </div>
  <div class="board"><canvas id="cv"></canvas><div id="toasts"></div><div id="intro" class="intro"></div></div>
  <div class="hud">
    <div class="hp me"><span>${T('自分の城')}</span><i><b id="hb"></b></i><em id="hbn"></em></div>
    <div class="coin">💰 <b id="hm">0</b></div>
  </div>
  ${spec ? `<div class="spec">${T('観戦中')}${opt && opt.specNote ? ' ・ ' + esc(opt.specNote) : ''}</div>` : ''}
  <div class="pal" ${spec ? 'hidden' : ''}>${deck.map(k => `<div class="slot"><button class="pb r-${UNITS[k].role}" data-k="${k}"><img src="${imgSrc(UNITS[k].stats[0].img)}" alt=""><span><b class="lvb">Lv1</b> ${UNITS[k].cost}</span><i class="cdv"></i></button><button class="up" data-up="${k}">⬆<small></small></button></div>`).join('')}</div>
  <div class="row">
    <div class="strikes" ${spec ? 'hidden' : ''}>${Array.from({ length: B.lanes }, (_, l) => `<button class="strike" data-sl="${l}"><i></i><span>${B.lanes === 1 ? T('城の一撃') : T('城の一撃') + ' ' + LANE_MARK[B.lanes][l]}</span></button>`).join('')}</div>
    ${B.online ? '' : `<button id="spd" class="sub mini">▶︎×1</button>
    <button id="pause" class="sub mini">⏸</button>`}
    <button id="quit" class="sub mini">✕</button>
  </div>`;
  cv = $('cv'); cx = cv.getContext('2d');
  resize();
  // 出撃: ボタンを押さえたまま道までドラッグして離す(道が1本のときは、タップでも出せる)
  app.querySelectorAll('.pb').forEach(b => {
    b.onpointerdown = ev => {
      const k = b.dataset.k;
      if (B.over || drag) return;
      if (B.pl[ME].coin < UNITS[k].cost) { toast(T('コインが足りない')); return; }
      if (B.pl[ME].cd[k] > 0) { toast(T('まだ出せない')); return; }
      ev.preventDefault();
      try { b.setPointerCapture(ev.pointerId); } catch (e) { }
      const g = document.createElement('img');
      g.src = imgSrc(UNITS[k].stats[lvOf(ME, k) - 1].img); g.className = 'ghost'; document.body.appendChild(g);
      drag = { k, id: ev.pointerId, g, lane: -1, x0: ev.clientX, y0: ev.clientY, moved: false };
      dragMove(ev);
    };
    b.onpointermove = ev => { if (drag && ev.pointerId === drag.id) dragMove(ev); };
    b.onpointerup = ev => { if (drag && ev.pointerId === drag.id) dragEnd(ev, true); };
    b.onpointercancel = ev => { if (drag && ev.pointerId === drag.id) dragEnd(ev, false); };
    b.oncontextmenu = ev => ev.preventDefault();
  });
  app.querySelectorAll('.up').forEach(b => b.onclick = () => {
    const k = b.dataset.up, before = UNITS[k].stats[lvOf(ME, k) - 1];
    if (lvOf(ME, k) >= LV_MAX) return;
    if (B.pl[ME].coin < upCost(ME, k)) { toast(T('コインが足りない')); return; }
    if (act('u', k, 0) === false) return;
    const after = UNITS[k].stats[lvOf(ME, k) - 1 + (B.online ? 1 : 0)];
    toast(after.img !== before.img ? T('{a} が {b} に進化！', { a: T(before.name), b: T(after.name) }) : T('{name} が Lv{n} に！', { name: T(after.name), n: lvOf(ME, k) + (B.online ? 1 : 0) }) + ' ' + T(after.desc));
  });
  app.querySelectorAll('[data-sl]').forEach(b => b.onclick = () => { if (B.gauge[MS] < STRIKE.charge) { toast(T('ゲージがたまっていない')); return; } act('x', null, VL(+b.dataset.sl)); });
  if (!B.online) {
    $('spd').onclick = () => { B.speed = B.speed === 1 ? 2 : 1; $('spd').textContent = '▶︎×' + B.speed; };
    $('pause').onclick = () => { B.paused = !B.paused; $('pause').textContent = B.paused ? '▶︎' : '⏸'; };
  }
  $('quit').onclick = () => {
    if (B.online && ME < 0) return netStopWatch();   // 観戦をやめて、試合の一覧へ
    if (B.online) { if ($('quit').classList.contains('sure')) netLeave(); else { $('quit').classList.add('sure'); $('quit').textContent = T('本当に出る？'); } } else B.over = 'quit';
  };
  // 最初に、おたがいの4体を見せる(タップか3秒で始まる)
  intro = 3;
  $('intro').innerHTML = `<div class="dim">${esc(foeName())}</div><div class="team foe">${teamImgs(1 - MS)}</div><div class="vs">VS</div><div class="team">${teamImgs(MS)}</div><div class="dim">${esc(sideName(MS))}</div><div class="small">${T('タップでスタート')}</div>`;
  $('intro').onclick = () => { intro = 0; };
  lastT = performance.now(); acc = 0;
  raf = requestAnimationFrame(loop);
}
let drag = null;
function dragMove(ev) {
  const d = drag, r = cv.getBoundingClientRect();
  d.g.style.left = ev.clientX + 'px'; d.g.style.top = ev.clientY + 'px';
  if (Math.hypot(ev.clientX - d.x0, ev.clientY - d.y0) > 12) d.moved = true;
  const inside = ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
  d.lane = inside ? Math.max(0, Math.min(B.lanes - 1, Math.floor((ev.clientX - r.left) / r.width * B.lanes))) : -1;
}
function dragEnd(ev, drop) {
  const d = drag; drag = null;
  d.g.remove();
  if (!drop) return;
  if (d.lane >= 0) trySpawn(d.k, d.lane);
  else if (!d.moved) { if (B.lanes === 1) trySpawn(d.k, 0); else toast(T('道までドラッグして出撃')); }
}
function trySpawn(k, lane) {
  lane = VL(lane);   // 画面の道 → 本当の道(相手側から見ているときは左右が逆)
  if (canSpawn(ME, k)) { act('s', k, lane); return; }
  if (B.pl[ME].coin < UNITS[k].cost) toast(T('コインが足りない'));
  else if (B.pl[ME].cd[k] > 0) toast(T('まだ出せない'));
}
let toasts = [];
function toast(msg) { toasts.push({ msg, t: 1.8 }); }

function resize() {
  W = Math.min(app.clientWidth || 360, 460);
  H = Math.max(300, Math.min(W * 1.45, window.innerHeight - 250));
  const dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  cv.style.width = W + 'px'; cv.style.height = H + 'px';
  cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cx.imageSmoothingEnabled = false;
}
window.addEventListener('resize', () => { if (B && cv && document.body.contains(cv)) resize(); });

function stopLoop() { if (raf) cancelAnimationFrame(raf); raf = 0; if (drag) { drag.g.remove(); drag = null; } }
function loop(now) {
  const dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
  if (intro > 0) { intro -= dt; if (intro <= 0 && $('intro')) $('intro').hidden = true; }
  else if ($('intro') && !$('intro').hidden) $('intro').hidden = true;
  if (B.online) { if (!B.over && intro <= 0) netStep(dt); }
  else if (!B.paused && !B.over && intro <= 0) { acc += dt * B.speed; while (acc >= TICK) { sim(); acc -= TICK; if (B.over) break; } }
  for (const f of B.fx) if (f.flagGet !== undefined && !f.told) { f.told = true; toast(f.flagGet === MS ? T('旗を取った！ コインが多くたまる') : T('旗を取られた…')); }
  for (const t of toasts) t.t -= dt;
  toasts = toasts.filter(t => t.t > 0);
  draw(); hud();
  if (B.over) { raf = 0; if (B.over === 'quit') home(); else setTimeout(end, 900); return; }
  if (B.online) netHud();
  raf = requestAnimationFrame(loop);
}

function hud() {
  const pc = (v, sd) => Math.max(0, v / B.castleMax[sd] * 100) + '%';
  $('hb').style.width = pc(B.castle[MS], MS); $('hc').style.width = pc(B.castle[1 - MS], 1 - MS);
  $('hbn').textContent = Math.ceil(B.castle[MS]); $('hcn').textContent = Math.ceil(B.castle[1 - MS]);
  $('hm').textContent = ME < 0 ? '-' : Math.floor(B.pl[ME].coin);
  const left = Math.max(0, Math.ceil(TIME_LIMIT - B.t));
  $('ht').textContent = Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
  if (ME >= 0) app.querySelectorAll('.pb').forEach(b => {
    const k = b.dataset.k, cd = B.pl[ME].cd[k] || 0;
    b.classList.toggle('poor', B.pl[ME].coin < UNITS[k].cost);
    b.classList.toggle('on', !!drag && drag.k === k);
    b.querySelector('.cdv').style.height = (cd > 0 ? cd / UNITS[k].cd * 100 : 0) + '%';
    // レベルが変わったら、絵と Lv を書きかえる
    const lv = lvOf(ME, k);
    if (b.dataset.lv !== String(lv)) {
      b.dataset.lv = lv;
      b.querySelector('img').src = imgSrc(UNITS[k].stats[lv - 1].img);
      b.querySelector('.lvb').textContent = 'Lv' + lv;
    }
  });
  if (ME >= 0) app.querySelectorAll('.up').forEach(b => {
    const k = b.dataset.up, max = lvOf(ME, k) >= LV_MAX;
    b.disabled = max || B.pl[ME].coin < upCost(ME, k) || (B.online && !!NET.pend['u' + k]);
    b.classList.toggle('max', max);
    b.querySelector('small').textContent = max ? 'MAX' : upCost(ME, k);
  });
  const g = B.gauge[MS] / STRIKE.charge;
  app.querySelectorAll('[data-sl]').forEach(b => { b.querySelector('i').style.width = g * 100 + '%'; b.classList.toggle('ready', g >= 1); });
  $('toasts').innerHTML = toasts.slice(-2).map(t => `<div class="toast">${esc(t.msg)}</div>`).join('');
}

/* ---------- 戦場をかく ---------- */
const TOP = () => H * 0.17, BOT = () => H * 0.9;
const VP = p => (MS ? LANE - p : p);                 // 相手側から見ているときは上下が逆
const VL = l => (MS && B ? B.lanes - 1 - l : l);     // 左右も逆(180度まわして見る)
const Y = p => BOT() - (VP(p) / LANE) * (BOT() - TOP());
const ROAD = () => W * (B.lanes === 1 ? 0.6 : B.lanes === 2 ? 0.38 : 0.28);
const laneX = l => W * (l + 0.5) / B.lanes;
const X = (x, l) => laneX(VL(l || 0)) + (MS ? -x : x) * ROAD() * 0.33;
const SPR = () => W * (B.lanes === 1 ? 0.27 : B.lanes === 2 ? 0.21 : 0.17);
function draw() {
  cx.fillStyle = '#5d8a4a'; cx.fillRect(0, 0, W, H);
  // 道
  for (let l = 0; l < B.lanes; l++) {
    const rx = laneX(l) - ROAD() / 2;
    const hot = drag && drag.lane === l;
    cx.fillStyle = hot ? '#e6c98f' : '#c9a66b'; cx.fillRect(rx, 0, ROAD(), H);
    cx.fillStyle = 'rgba(0,0,0,.07)';
    for (let i = 0; i < 12; i++) cx.fillRect(rx, (i * H) / 12, ROAD(), 2);
    if (drag) { cx.strokeStyle = hot ? '#fff' : 'rgba(255,255,255,.5)'; cx.setLineDash(hot ? [] : [6, 6]); cx.lineWidth = hot ? 3 : 2; cx.strokeRect(rx + 2, 2, ROAD() - 4, H - 4); cx.setLineDash([]); }
  }
  // 城の一撃が届く範囲(ゲージがたまっているとき)
  if (B.gauge[MS] >= STRIKE.charge) { cx.fillStyle = 'rgba(255,215,0,.16)'; const ry = Y(MS ? LANE - STRIKE.reach : STRIKE.reach); for (let l = 0; l < B.lanes; l++) cx.fillRect(laneX(l) - ROAD() / 2, ry, ROAD(), H - ry); }
  for (let l = 0; l < B.lanes; l++) flagDraw(l);
  castle(Y(homeP(1 - MS)), 1); castle(Y(homeP(MS)), 0);
  // キャラ(奥=上から順に)
  const us = B.units.slice().sort((a, b) => Y(a.p) - Y(b.p) || a.id - b.id);
  for (const u of us) {
    const im = img(u.img);
    const w = SPR() * (u.d.size || 1), h = w * 100 / 176;
    const x = X(u.x, u.lane), y = Y(u.p) - (u.act > 0 ? (u.side !== MS ? -3 : 3) : 0);
    // 足もとの影: 自分は青、相手は赤
    cx.fillStyle = u.side !== MS ? 'rgba(220,40,40,.55)' : 'rgba(40,130,230,.55)';
    cx.beginPath(); cx.ellipse(x - w * 0.08, y + h * 0.42, w * 0.26, h * 0.13, 0, 0, 7); cx.fill();
    if (u.slowT > 0) { cx.fillStyle = 'rgba(124,200,255,.35)'; cx.beginPath(); cx.ellipse(x, y, w * 0.3, h * 0.45, 0, 0, 7); cx.fill(); }
    if (im.complete && im.naturalWidth) {
      if (u.hitT > 0) cx.globalAlpha = 0.55;
      cx.drawImage(im, x - w / 2, y - h / 2, w, h);
      cx.globalAlpha = 1;
    }
    bar(x, y - h * 0.5 - 4, u.hp / u.max, u.side !== MS ? '#e74c3c' : '#3fa9f5', w * 0.5);
  }
  // 攻撃などの演出
  for (const f of B.fx) {
    cx.globalAlpha = Math.min(1, f.t * 4);
    if (f.line) { cx.strokeStyle = f.line; cx.lineWidth = 2; cx.beginPath(); cx.moveTo(X(f.x, f.l), Y(f.p)); cx.lineTo(X(f.x2, f.l), Y(f.p2)); cx.stroke(); }
    if (f.ring) { cx.strokeStyle = f.ring; cx.lineWidth = 2; cx.beginPath(); const r = (f.r ? f.r / LANE * (BOT() - TOP()) : W * 0.06); cx.ellipse(X(f.x, f.l), Y(f.p), Math.min(r, ROAD() * 0.5), r, 0, 0, 7); cx.stroke(); }
    if (f.txt) { cx.fillStyle = '#ffe066'; cx.font = `bold ${Math.round(SPR() * 0.22)}px sans-serif`; cx.textAlign = 'center'; cx.fillText(f.txt, X(f.x, f.l), Y(f.p) - SPR() * 0.35 - (0.5 - f.t) * 20); }
    if (f.boom) { cx.fillStyle = '#fff3'; cx.beginPath(); cx.arc(X(f.x, f.l), Y(f.p), SPR() * 0.25 * (1.4 - f.t), 0, 7); cx.fill(); }
    if (f.strike !== undefined) {
      const s = f.strike, y0 = Y(homeP(s)), y1 = Y(s === 0 ? STRIKE.reach : LANE - STRIKE.reach);
      cx.fillStyle = 'rgba(255,200,40,.5)'; cx.fillRect(laneX(VL(f.l)) - ROAD() / 2, Math.min(y0, y1), ROAD(), Math.abs(y1 - y0));
    }
    cx.globalAlpha = 1;
  }
}
const LANE_MARK = { 2: ['◀', '▶'], 3: ['◀', '▲', '▶'] };
const FLAG_COL = { '-1': '#f2efe6', 0: '#3fa9f5', 1: '#e74c3c' };
function flagDraw(l) {
  const f = B.flags[l], x = laneX(VL(l)), y = Y(FLAG.at), s = SPR(), prog = MS ? -f.prog : f.prog;
  // 取り合う範囲
  cx.fillStyle = 'rgba(255,255,255,.08)'; cx.fillRect(x - ROAD() / 2, Y(FLAG.at + FLAG.zone), ROAD(), Y(FLAG.at - FLAG.zone) - Y(FLAG.at + FLAG.zone));
  // 旗ざお と 旗
  const px = x + ROAD() * 0.42, top = y - s * 0.55;
  cx.strokeStyle = '#4a3a2a'; cx.lineWidth = 2; cx.beginPath(); cx.moveTo(px, y + s * 0.1); cx.lineTo(px, top); cx.stroke();
  cx.fillStyle = FLAG_COL[f.own < 0 ? -1 : f.own === MS ? 0 : 1]; cx.strokeStyle = 'rgba(0,0,0,.45)'; cx.lineWidth = 1;
  cx.beginPath(); cx.moveTo(px, top); cx.lineTo(px - s * 0.38, top + s * 0.13); cx.lineTo(px, top + s * 0.26); cx.closePath(); cx.fill(); cx.stroke();
  // どちらにかたむいているか(青 = 自分、赤 = 相手)
  const w = ROAD() * 0.5, bx = x - w / 2, by = y + s * 0.16;
  cx.fillStyle = 'rgba(0,0,0,.4)'; cx.fillRect(bx, by, w, 4);
  if (prog > 0) { cx.fillStyle = '#3fa9f5'; cx.fillRect(x, by, w / 2 * prog, 4); }
  if (prog < 0) { cx.fillStyle = '#e74c3c'; cx.fillRect(x + w / 2 * prog, by, -w / 2 * prog, 4); }
}
function castle(y, side) {
  const w = B.lanes === 1 ? W * 0.5 : W * 0.86, h = H * 0.07, x = W / 2 - w / 2, top = side ? y - h * 1.05 : y - h * 0.05;
  cx.fillStyle = side ? '#5a1e1e' : '#3d4f6b';
  cx.fillRect(x, top, w, h);
  for (let i = 0; i < 5; i++) cx.fillRect(x + i * w / 4.5, top - h * 0.25, w / 9, h * 0.3);
  cx.fillStyle = '#1b1410'; cx.fillRect(W / 2 - w * 0.08, top + h * 0.35, w * 0.16, h * 0.65);
  // 旗
  cx.strokeStyle = '#2b2018'; cx.lineWidth = 2; cx.beginPath(); cx.moveTo(W / 2, top - h * 0.25); cx.lineTo(W / 2, top - h * 0.85); cx.stroke();
  cx.fillStyle = side ? '#1a1a1a' : '#c62828'; cx.beginPath(); cx.moveTo(W / 2, top - h * 0.85); cx.lineTo(W / 2 + w * 0.22, top - h * 0.68); cx.lineTo(W / 2, top - h * 0.5); cx.fill();
}
function bar(x, y, p, col, w) {
  const h = 4, px = x - w / 2;
  cx.fillStyle = 'rgba(0,0,0,.5)'; cx.fillRect(px, y, w, h);
  cx.fillStyle = col; cx.fillRect(px, y, w * Math.max(0, Math.min(1, p)), h);
}

/* ---------- 画面: 結果 ---------- */
const teamImgs = side => B.pl.map((P, i) => P.side !== side ? '' : `<span class="tm">${P.deck.map(k => `<img src="${imgSrc(UNITS[k].stats[lvOf(i, k) - 1].img)}" alt="">`).join('')}</span>`).join('');
/* 陣営の名前: ひとりで練習は「自分」「CPU」、オンラインは参加した人の名前(net.js) */
const sideName = sd => (B && B.online ? netSideName(sd) : sd === 0 ? T('自分') : 'CPU');
function end() {
  if (!B || !B.over) return;
  const s = Math.floor(B.t), r0 = B.over;   // B.over は side 0 から見た勝ち負け('win' / 'lose' / 'draw')
  const spec = ME < 0;
  const r = MS && r0 === 'win' ? 'lose' : MS && r0 === 'lose' ? 'win' : r0;
  const winSide = r0 === 'win' ? 0 : r0 === 'lose' ? 1 : -1;
  const ttl = spec ? (winSide < 0 ? T('引き分け') : T('{name} の勝ち！', { name: sideName(winSide) })) : r === 'win' ? T('🏆 勝利！') : r === 'lose' ? T('🏳️ 敗北…') : T('引き分け');
  const why = B.forfeit ? T('相手がいなくなった') : B.castle[1 - MS] <= 0 ? T('相手の城を落とした！') : B.castle[MS] <= 0 ? T('城を落とされた…') : T('時間切れ。城のHPでくらべた');
  app.innerHTML = `
  <h1 class="title">${esc(ttl)}</h1>
  <div class="card">
    ${spec ? '' : `<div>${why}</div>`}
    <div class="dim">${esc(sideName(MS))} ${Math.ceil(B.castle[MS])} / ${esc(sideName(1 - MS))} ${Math.ceil(B.castle[1 - MS])}</div>
    <div class="dim">${T('時間 {m}分{s}秒・倒した敵 {k}', { m: Math.floor(s / 60), s: s % 60, k: B.kills[MS] })}</div>
    <div class="vsrow"><span class="dim small">${esc(sideName(MS))}</span><div class="team">${teamImgs(MS)}</div></div>
    <div class="vsrow"><span class="dim small">${esc(sideName(1 - MS))}</span><div class="team foe">${teamImgs(1 - MS)}</div></div>
  </div>
  ${B.online ? netEndButtons() : `<button id="again" class="wide">${T('同じキャラでもう一回')}</button>
  <button id="re" class="sub">${T('キャラを選びなおす')}</button>
  <button id="hm2" class="sub">${T('ホームへ')}</button>`}`;
  if (B.online) return netEndInit();
  $('again').onclick = () => play(); $('re').onclick = () => draft(); $('hm2').onclick = home;
}

/* テスト用(ブラウザのコンソールから: __br.B など) */
window.__br = { get B() { return B }, sim, spawn, strike, newBattle, setPicks(p) { picks = p }, setCpu(l) { cpuLevel = l }, setLanes(n) { laneCount = n }, levelUp, play, get ME() { return ME }, get MS() { return MS } };
