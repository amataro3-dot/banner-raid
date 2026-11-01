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
UNIT_KEYS.forEach(k => UNITS[k].stats.forEach(st => img(st.img))); Object.keys(ENEMIES).forEach(k => img('e-' + k));

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

function newBattle(seed) {
  B = {
    tick: 0, t: 0, rng: makeRng(seed || 1), uid: 1, lanes: laneCount,
    coin: [START_COIN, START_COIN * 0.6], castle: [CASTLE_HP, CASTLE_HP], gauge: [0, 0],
    flags: Array.from({ length: laneCount }, () => ({ own: -1, prog: 0 })),   // prog: +1 で自分、-1 で相手のもの
    cd: [{}, {}], lv: [{}, {}], deck: [picks.slice(), Object.keys(ENEMIES)], kind: ['u', 'e'],
    rate: [1, CPU_LEVELS[cpuLevel]],
    units: [], fx: [], over: null, kills: [0, 0], spent: [0, 0],
    ai: { next: null, think: 0 },
    speed: 1, paused: false,
  };
}
const lvOf = (side, k) => B.lv[side][k] || 1;
/* いまのレベルの数値(CPU軍は HP・攻撃を ENEMY_LV 倍) */
function defOf(side, k) {
  if (B.kind[side] === 'u') return UNITS[k] && UNITS[k].stats[lvOf(side, k) - 1];
  const e = ENEMIES[k]; if (!e) return null;
  const m = ENEMY_LV[lvOf(side, k) - 1];
  return Object.assign({}, e, { hp: Math.round(e.hp * m), dmg: Math.round(e.dmg * m), img: 'e-' + k });
}
const upCost = (side, k) => (B.kind[side] === 'u' ? UNITS[k].up[lvOf(side, k) - 1] : Math.round(ENEMIES[k].cost * ENEMY_UP[lvOf(side, k) - 1]));
/* レベルアップ(これから出すキャラから強くなる) */
function levelUp(side, k) {
  if (B.over || !B.deck[side].includes(k) || lvOf(side, k) >= LV_MAX) return false;
  const c = upCost(side, k);
  if (B.coin[side] < c) return false;
  B.coin[side] -= c; B.spent[side] += c;
  B.lv[side][k] = lvOf(side, k) + 1;
  return true;
}

/* 出撃 */
function canSpawn(side, k) {
  const d = defOf(side, k);
  return d && !B.over && B.deck[side].includes(k) && B.coin[side] >= d.cost && !(B.cd[side][k] > 0);
}
function spawn(side, k, lane) {
  if (!canSpawn(side, k)) return false;
  const d = defOf(side, k);
  B.coin[side] -= d.cost; B.spent[side] += d.cost;
  B.cd[side][k] = d.cd;
  lane = Math.max(0, Math.min(B.lanes - 1, lane | 0));
  B.units.push({ id: B.uid++, side, k, d, lane, img: d.img, lv: lvOf(side, k), p: homeP(side) + DIR[side] * 3, hp: d.hp, max: d.hp, atkT: 0.3, slowT: 0, x: B.rng() * 2 - 1, hitT: 0, act: 0 });
  return true;
}

/* 城の一撃 */
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

function hurt(u, v, bySide) {
  if (u.hp <= 0) return;
  u.hp -= v; u.hitT = 0.12;
  if (u.hp <= 0) { u.dead = true; B.kills[bySide]++; B.coin[bySide] = Math.min(COIN_MAX, B.coin[bySide] + Math.round(u.d.cost * KILL_BONUS)); B.fx.push({ boom: true, p: u.p, x: u.x, l: u.lane, t: 0.4 }); }
}

/* ---------- 1コマ進める ---------- */
function sim() {
  if (B.over) return;
  const dt = TICK;
  B.tick++; B.t = B.tick * TICK;

  for (const s of [0, 1]) {
    let bonus = 0, fix = 0, boost = 0;
    for (const u of B.units) if (u.side === s && u.hp > 0) { bonus += u.d.coin || 0; fix += u.d.repair || 0; boost += u.d.gauge || 0; }
    for (const f of B.flags) if (f.own === s) bonus += FLAG.coin;
    B.coin[s] = Math.min(COIN_MAX, B.coin[s] + (COIN_PER_SEC * B.rate[s] + bonus) * dt);
    if (fix && B.castle[s] > 0) B.castle[s] = Math.min(CASTLE_HP, B.castle[s] + fix * dt);
    B.gauge[s] = Math.min(STRIKE.charge, B.gauge[s] + dt * (1 + Math.min(1, boost)));
    for (const k in B.cd[s]) if (B.cd[s][k] > 0) B.cd[s][k] -= dt;
  }
  flagStep(dt);
  if (B.cpu !== false) cpuThink(dt);

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
const AI_WEIGHT = { goblin: 30, wolf: 18, skeleton: 22, orc: 16, assassin: 12 };
function cpuPick() {
  const ks = Object.keys(AI_WEIGHT).filter(k => B.t > 40 || k !== 'assassin');
  let sum = 0; for (const k of ks) sum += AI_WEIGHT[k];
  let r = B.rng() * sum;
  for (const k of ks) { r -= AI_WEIGHT[k]; if (r < 0) return k; }
  return ks[0];
}
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
  if (danger && canSpawn(1, 'goblin') && B.rng() < 0.5) { spawn(1, 'goblin', cpuLane(true)); return; }
  if (!A.next || B.cd[1][A.next] > 3) A.next = cpuPick();
  if (canSpawn(1, A.next)) { spawn(1, A.next, cpuLane(false)); A.next = null; return; }
  // コインがあまっていたら、ときどき強化
  if (B.t > 30 && B.rng() < 0.15) {
    const ks = B.deck[1].filter(k => lvOf(1, k) < LV_MAX && B.coin[1] >= upCost(1, k) + 120);
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
  <button class="wide sub" disabled>${T('オンライン対戦(準備中)')}</button>
  <div class="dim small">${T('試作版です。キャラの強さは、遊びながら調整します')}</div>
  ${FOOT()}`;
  langSwitchInit(() => { });
  $('solo').onclick = draft;
}

/* ---------- 画面: キャラ選び ---------- */
function draft() {
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
  <div class="seg"><span class="dim small">${T('CPUの強さ')}</span> ${lv}</div>
  <div class="seg"><span class="dim small">${T('道の数')}</span> ${ln}</div>
  <button id="go" class="wide" ${picks.length === 4 ? '' : 'disabled'}>${T('出陣！')}</button>
  <button id="back" class="sub">${T('もどる')}</button>`;
  app.querySelectorAll('.ucard').forEach(b => b.onclick = () => {
    const k = b.dataset.k;
    if (picks.includes(k)) picks = picks.filter(x => x !== k);
    else if (picks.length < 4) picks.push(k);
    else return;
    const y = window.scrollY; draft(); window.scrollTo(0, y);
  });
  app.querySelectorAll('[data-lv]').forEach(b => b.onclick = () => { cpuLevel = b.dataset.lv; LS.set('br-cpu', cpuLevel); const y = window.scrollY; draft(); window.scrollTo(0, y); });
  app.querySelectorAll('[data-ln]').forEach(b => b.onclick = () => { laneCount = +b.dataset.ln; LS.set('br-lanes', laneCount); const y = window.scrollY; draft(); window.scrollTo(0, y); });
  $('go').onclick = () => { LS.set('br-picks', picks.join(',')); play(); };
  $('back').onclick = home;
}

/* ---------- 画面: 対戦 ---------- */
let cv, cx, W = 360, H = 480, raf = 0, lastT = 0, acc = 0;
function play() {
  newBattle((Date.now() & 0x7fffffff) | 1);
  app.innerHTML = `
  <div class="hud">
    <div class="hp foe"><span>${T('相手の城')}</span><i><b id="hc"></b></i><em id="hcn"></em></div>
    <div class="dim" id="ht">5:00</div>
  </div>
  <div class="board"><canvas id="cv"></canvas><div id="toasts"></div></div>
  <div class="hud">
    <div class="hp me"><span>${T('自分の城')}</span><i><b id="hb"></b></i><em id="hbn"></em></div>
    <div class="coin">💰 <b id="hm">0</b></div>
  </div>
  <div class="pal">${picks.map(k => `<div class="slot"><button class="pb r-${UNITS[k].role}" data-k="${k}"><img src="${imgSrc(UNITS[k].stats[0].img)}" alt=""><span><b class="lvb">Lv1</b> ${UNITS[k].cost}</span><i class="cdv"></i></button><button class="up" data-up="${k}">⬆<small></small></button></div>`).join('')}</div>
  <div class="row">
    <div class="strikes">${Array.from({ length: laneCount }, (_, l) => `<button class="strike" data-sl="${l}"><i></i><span>${laneCount === 1 ? T('城の一撃') : T('城の一撃') + ' ' + LANE_MARK[laneCount][l]}</span></button>`).join('')}</div>
    <button id="spd" class="sub mini">▶︎×1</button>
    <button id="pause" class="sub mini">⏸</button>
    <button id="quit" class="sub mini">✕</button>
  </div>`;
  cv = $('cv'); cx = cv.getContext('2d');
  resize();
  // 出撃: ボタンを押さえたまま道までドラッグして離す(道が1本のときは、タップでも出せる)
  app.querySelectorAll('.pb').forEach(b => {
    b.onpointerdown = ev => {
      const k = b.dataset.k;
      if (B.over || drag) return;
      if (B.coin[0] < UNITS[k].cost) { toast(T('コインが足りない')); return; }
      if (B.cd[0][k] > 0) { toast(T('まだ出せない')); return; }
      ev.preventDefault();
      try { b.setPointerCapture(ev.pointerId); } catch (e) { }
      const g = document.createElement('img');
      g.src = imgSrc(UNITS[k].stats[lvOf(0, k) - 1].img); g.className = 'ghost'; document.body.appendChild(g);
      drag = { k, id: ev.pointerId, g, lane: -1, x0: ev.clientX, y0: ev.clientY, moved: false };
      dragMove(ev);
    };
    b.onpointermove = ev => { if (drag && ev.pointerId === drag.id) dragMove(ev); };
    b.onpointerup = ev => { if (drag && ev.pointerId === drag.id) dragEnd(ev, true); };
    b.onpointercancel = ev => { if (drag && ev.pointerId === drag.id) dragEnd(ev, false); };
    b.oncontextmenu = ev => ev.preventDefault();
  });
  app.querySelectorAll('.up').forEach(b => b.onclick = () => {
    const k = b.dataset.up, before = UNITS[k].stats[lvOf(0, k) - 1];
    if (lvOf(0, k) >= LV_MAX) return;
    if (!levelUp(0, k)) { toast(T('コインが足りない')); return; }
    const after = UNITS[k].stats[lvOf(0, k) - 1];
    toast(after.img !== before.img ? T('{a} が {b} に進化！', { a: T(before.name), b: T(after.name) }) : T('{name} が Lv{n} に！', { name: T(after.name), n: lvOf(0, k) }) + ' ' + T(after.desc));
  });
  app.querySelectorAll('[data-sl]').forEach(b => b.onclick = () => { if (!strike(0, +b.dataset.sl) && B.gauge[0] < STRIKE.charge) toast(T('ゲージがたまっていない')); });
  $('spd').onclick = () => { B.speed = B.speed === 1 ? 2 : 1; $('spd').textContent = '▶︎×' + B.speed; };
  $('pause').onclick = () => { B.paused = !B.paused; $('pause').textContent = B.paused ? '▶︎' : '⏸'; };
  $('quit').onclick = () => { B.over = 'quit'; };
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
  if (spawn(0, k, lane)) return;
  if (B.coin[0] < UNITS[k].cost) toast(T('コインが足りない'));
  else if (B.cd[0][k] > 0) toast(T('まだ出せない'));
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
  if (!B.paused && !B.over) { acc += dt * B.speed; while (acc >= TICK) { sim(); acc -= TICK; if (B.over) break; } }
  for (const f of B.fx) if (f.flagGet !== undefined && !f.told) { f.told = true; toast(f.flagGet === 0 ? T('旗を取った！ コインが多くたまる') : T('旗を取られた…')); }
  for (const t of toasts) t.t -= dt;
  toasts = toasts.filter(t => t.t > 0);
  draw(); hud();
  if (B.over) { raf = 0; if (B.over === 'quit') home(); else setTimeout(end, 900); return; }
  raf = requestAnimationFrame(loop);
}

function hud() {
  const pc = v => Math.max(0, v / CASTLE_HP * 100) + '%';
  $('hb').style.width = pc(B.castle[0]); $('hc').style.width = pc(B.castle[1]);
  $('hbn').textContent = Math.ceil(B.castle[0]); $('hcn').textContent = Math.ceil(B.castle[1]);
  $('hm').textContent = Math.floor(B.coin[0]);
  const left = Math.max(0, Math.ceil(TIME_LIMIT - B.t));
  $('ht').textContent = Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
  app.querySelectorAll('.pb').forEach(b => {
    const k = b.dataset.k, cd = B.cd[0][k] || 0;
    b.classList.toggle('poor', B.coin[0] < UNITS[k].cost);
    b.classList.toggle('on', !!drag && drag.k === k);
    b.querySelector('.cdv').style.height = (cd > 0 ? cd / UNITS[k].cd * 100 : 0) + '%';
    // レベルが変わったら、絵と Lv を書きかえる
    const lv = lvOf(0, k);
    if (b.dataset.lv !== String(lv)) {
      b.dataset.lv = lv;
      b.querySelector('img').src = imgSrc(UNITS[k].stats[lv - 1].img);
      b.querySelector('.lvb').textContent = 'Lv' + lv;
    }
  });
  app.querySelectorAll('.up').forEach(b => {
    const k = b.dataset.up, max = lvOf(0, k) >= LV_MAX;
    b.disabled = max || B.coin[0] < upCost(0, k);
    b.classList.toggle('max', max);
    b.querySelector('small').textContent = max ? 'MAX' : upCost(0, k);
  });
  const g = B.gauge[0] / STRIKE.charge;
  app.querySelectorAll('[data-sl]').forEach(b => { b.querySelector('i').style.width = g * 100 + '%'; b.classList.toggle('ready', g >= 1); });
  $('toasts').innerHTML = toasts.slice(-2).map(t => `<div class="toast">${esc(t.msg)}</div>`).join('');
}

/* ---------- 戦場をかく ---------- */
const TOP = () => H * 0.17, BOT = () => H * 0.9;
const Y = p => BOT() - (p / LANE) * (BOT() - TOP());
const ROAD = () => W * (B.lanes === 1 ? 0.6 : B.lanes === 2 ? 0.38 : 0.28);
const laneX = l => W * (l + 0.5) / B.lanes;
const X = (x, l) => laneX(l || 0) + x * ROAD() * 0.33;
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
  if (B.gauge[0] >= STRIKE.charge) { cx.fillStyle = 'rgba(255,215,0,.16)'; for (let l = 0; l < B.lanes; l++) cx.fillRect(laneX(l) - ROAD() / 2, Y(STRIKE.reach), ROAD(), H - Y(STRIKE.reach)); }
  for (let l = 0; l < B.lanes; l++) flagDraw(l);
  castle(Y(LANE), 1); castle(Y(0), 0);
  // キャラ(奥=上から順に)
  const us = B.units.slice().sort((a, b) => Y(a.p) - Y(b.p) || a.id - b.id);
  for (const u of us) {
    const im = img(u.img);
    const w = SPR() * (u.d.size || 1), h = w * 100 / 176;
    const x = X(u.x, u.lane), y = Y(u.p) - (u.act > 0 ? (u.side ? -3 : 3) : 0);
    if (u.slowT > 0) { cx.fillStyle = 'rgba(124,200,255,.35)'; cx.beginPath(); cx.ellipse(x, y, w * 0.3, h * 0.45, 0, 0, 7); cx.fill(); }
    if (im.complete && im.naturalWidth) {
      if (u.hitT > 0) cx.globalAlpha = 0.55;
      cx.drawImage(im, x - w / 2, y - h / 2, w, h);
      cx.globalAlpha = 1;
    }
    bar(x, y - h * 0.5 - 4, u.hp / u.max, u.side ? '#e74c3c' : '#3fa9f5', w * 0.5);
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
      cx.fillStyle = 'rgba(255,200,40,.5)'; cx.fillRect(laneX(f.l) - ROAD() / 2, Math.min(y0, y1), ROAD(), Math.abs(y1 - y0));
    }
    cx.globalAlpha = 1;
  }
}
const LANE_MARK = { 2: ['◀', '▶'], 3: ['◀', '▲', '▶'] };
const FLAG_COL = { '-1': '#f2efe6', 0: '#3fa9f5', 1: '#e74c3c' };
function flagDraw(l) {
  const f = B.flags[l], x = laneX(l), y = Y(FLAG.at), s = SPR();
  // 取り合う範囲
  cx.fillStyle = 'rgba(255,255,255,.08)'; cx.fillRect(x - ROAD() / 2, Y(FLAG.at + FLAG.zone), ROAD(), Y(FLAG.at - FLAG.zone) - Y(FLAG.at + FLAG.zone));
  // 旗ざお と 旗
  const px = x + ROAD() * 0.42, top = y - s * 0.55;
  cx.strokeStyle = '#4a3a2a'; cx.lineWidth = 2; cx.beginPath(); cx.moveTo(px, y + s * 0.1); cx.lineTo(px, top); cx.stroke();
  cx.fillStyle = FLAG_COL[f.own]; cx.strokeStyle = 'rgba(0,0,0,.45)'; cx.lineWidth = 1;
  cx.beginPath(); cx.moveTo(px, top); cx.lineTo(px - s * 0.38, top + s * 0.13); cx.lineTo(px, top + s * 0.26); cx.closePath(); cx.fill(); cx.stroke();
  // どちらにかたむいているか(青 = 自分、赤 = 相手)
  const w = ROAD() * 0.5, bx = x - w / 2, by = y + s * 0.16;
  cx.fillStyle = 'rgba(0,0,0,.4)'; cx.fillRect(bx, by, w, 4);
  if (f.prog > 0) { cx.fillStyle = '#3fa9f5'; cx.fillRect(x, by, w / 2 * f.prog, 4); }
  if (f.prog < 0) { cx.fillStyle = '#e74c3c'; cx.fillRect(x + w / 2 * f.prog, by, -w / 2 * f.prog, 4); }
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
function end() {
  if (!B || !B.over) return;
  const s = Math.floor(B.t), r = B.over;
  const ttl = r === 'win' ? T('🏆 勝利！') : r === 'lose' ? T('🏳️ 敗北…') : T('引き分け');
  const why = B.castle[1] <= 0 ? T('相手の城を落とした！') : B.castle[0] <= 0 ? T('城を落とされた…') : T('時間切れ。城のHPでくらべた');
  app.innerHTML = `
  <h1 class="title">${ttl}</h1>
  <div class="card">
    <div>${why}</div>
    <div class="dim">${T('自分の城 {a} / 相手の城 {b}', { a: Math.ceil(B.castle[0]), b: Math.ceil(B.castle[1]) })}</div>
    <div class="dim">${T('時間 {m}分{s}秒・倒した敵 {k}', { m: Math.floor(s / 60), s: s % 60, k: B.kills[0] })}</div>
    <div class="team">${picks.map(k => `<img src="${imgSrc(UNITS[k].stats[lvOf(0, k) - 1].img)}" alt="">`).join('')}</div>
  </div>
  <button id="again" class="wide">${T('同じキャラでもう一回')}</button>
  <button id="re" class="sub">${T('キャラを選びなおす')}</button>
  <button id="hm2" class="sub">${T('ホームへ')}</button>`;
  $('again').onclick = play; $('re').onclick = draft; $('hm2').onclick = home;
}

/* テスト用(ブラウザのコンソールから: __br.B など) */
window.__br = { get B() { return B }, sim, spawn, strike, newBattle, setPicks(p) { picks = p }, setCpu(l) { cpuLevel = l }, setLanes(n) { laneCount = n }, levelUp };

home();
