/* BANNER RAID 本体(v=2: キャラが相手の城へ攻めていくタイプ。ひとりで練習 = CPU対戦)
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
UNIT_KEYS.forEach(img); Object.keys(ENEMIES).forEach(k => img('e-' + k));

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

function newBattle(seed) {
  B = {
    tick: 0, t: 0, rng: makeRng(seed || 1), uid: 1,
    coin: [START_COIN, START_COIN], castle: [CASTLE_HP, CASTLE_HP], gauge: [0, 0],
    cd: [{}, {}], deck: [picks.slice(), Object.keys(ENEMIES)], kind: ['u', 'e'],
    rate: [1, CPU_LEVELS[cpuLevel]],
    units: [], fx: [], over: null, kills: [0, 0], spent: [0, 0],
    ai: { next: null, think: 0 },
    speed: 1, paused: false,
  };
}
const defOf = (side, k) => (B.kind[side] === 'u' ? UNITS[k] : ENEMIES[k]);

/* 出撃 */
function canSpawn(side, k) {
  const d = defOf(side, k);
  return d && !B.over && B.deck[side].includes(k) && B.coin[side] >= d.cost && !(B.cd[side][k] > 0);
}
function spawn(side, k) {
  if (!canSpawn(side, k)) return false;
  const d = defOf(side, k);
  B.coin[side] -= d.cost; B.spent[side] += d.cost;
  B.cd[side][k] = d.cd;
  B.units.push({ id: B.uid++, side, k, d, p: homeP(side) + DIR[side] * 3, hp: d.hp, max: d.hp, atkT: 0.3, slowT: 0, x: B.rng() * 2 - 1, hitT: 0, act: 0 });
  return true;
}

/* 城の一撃 */
function strike(side) {
  if (B.over || B.gauge[side] < STRIKE.charge) return false;
  B.gauge[side] = 0;
  for (const u of B.units) if (u.side !== side && u.hp > 0 && fromHome(side, u.p) <= STRIKE.reach) {
    hurt(u, STRIKE.dmg, side);
    u.p += DIR[1 - side] * -STRIKE.push;   // 城から遠ざける
    u.p = Math.max(0, Math.min(LANE, u.p));
  }
  B.fx.push({ strike: side, t: 0.6 });
  return true;
}

function hurt(u, v, bySide) {
  if (u.hp <= 0) return;
  u.hp -= v; u.hitT = 0.12;
  if (u.hp <= 0) { u.dead = true; B.kills[bySide]++; B.coin[bySide] = Math.min(COIN_MAX, B.coin[bySide] + Math.round(u.d.cost * KILL_BONUS)); B.fx.push({ boom: true, p: u.p, x: u.x, t: 0.4 }); }
}

/* ---------- 1コマ進める ---------- */
function sim() {
  if (B.over) return;
  const dt = TICK;
  B.tick++; B.t = B.tick * TICK;

  for (const s of [0, 1]) {
    let bonus = 0;
    for (const u of B.units) if (u.side === s && u.hp > 0 && u.d.coin) bonus += u.d.coin;
    B.coin[s] = Math.min(COIN_MAX, B.coin[s] + (COIN_PER_SEC * B.rate[s] + bonus) * dt);
    B.gauge[s] = Math.min(STRIKE.charge, B.gauge[s] + dt);
    for (const k in B.cd[s]) if (B.cd[s][k] > 0) B.cd[s][k] -= dt;
  }
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
    for (const v of live) if (v.side === o && v.hp > 0) {
      const g = (v.p - u.p) * dir;
      if (g >= -1.5) { foes.push([v, g]); if (g < nd) { nd = g; near = v; } }
    }
    const castleGap = (homeP(o) - u.p) * dir;

    let haste = 1;
    for (const b of live) if (b.side === s && b !== u && b.d.haste && b.hp > 0 && Math.abs(b.p - u.p) <= b.d.range) haste = Math.max(haste, b.d.haste);
    u.atkT -= dt * haste * (u.slowT > 0 ? 0.7 : 1);

    let stop = false;
    if (d.coin) {
      stop = fromHome(s, u.p) >= d.stopAt || nd <= 3;
    } else if (d.heal) {
      stop = nd <= d.range || castleGap <= d.range;
      const hurtAllies = live.filter(a => a.side === s && a.hp > 0 && a.hp < a.max && Math.abs(a.p - u.p) <= d.range);
      if (hurtAllies.length && u.atkT <= 0) {
        if (d.healAll) hurtAllies.forEach(a => { a.hp = Math.min(a.max, a.hp + d.heal); B.fx.push({ ring: '#4caf50', p: a.p, x: a.x, t: 0.35 }); });
        else { const a = hurtAllies.sort((a1, a2) => a1.hp / a1.max - a2.hp / a2.max || a1.id - a2.id)[0]; a.hp = Math.min(a.max, a.hp + d.heal); B.fx.push({ line: '#4caf50', p: u.p, x: u.x, p2: a.p, x2: a.x, t: 0.25 }); }
        u.atkT = d.rate; u.act = 0.2;
      }
    } else if (d.haste) {
      stop = nd <= d.range || castleGap <= d.range;
    } else if (d.slow) {
      stop = nd <= d.range || castleGap <= d.range;
      const inR = foes.filter(([v, g]) => g <= d.range);
      if (inR.length && u.atkT <= 0) {
        inR.forEach(([v]) => { v.slowT = 1.5; v.slowP = d.slow; hurt(v, d.dmg, s); });
        B.fx.push({ ring: '#7cc8ff', p: u.p, x: u.x, r: d.range, t: 0.3 });
        u.atkT = d.rate; u.act = 0.2;
      }
    } else {
      // アタッカー・タンク・CPU軍: 射程に入った相手(または城)を攻撃
      const inR = foes.filter(([v, g]) => g <= d.range);
      const castleIn = castleGap <= d.range;
      stop = inR.length > 0 || castleIn;
      if (stop && u.atkT <= 0) {
        let tgt = null;
        if (d.sniper) tgt = castleIn ? 'castle' : inR.sort((a, b) => b[0].hp - a[0].hp || a[0].id - b[0].id)[0][0];
        else tgt = inR.length ? inR.sort((a, b) => a[1] - b[1] || a[0].id - b[0].id)[0][0] : 'castle';
        if (tgt === 'castle') {
          B.castle[o] = Math.max(0, B.castle[o] - d.dmg);
          B.fx.push({ line: d.range > 8 ? '#ffd166' : '#fff', p: u.p, x: u.x, p2: homeP(o), x2: u.x * 0.3, t: 0.15 });
        } else {
          hurt(tgt, d.dmg, s);
          if (tgt.d.reflect) hurt(u, d.dmg * tgt.d.reflect, o);
          if (d.splash) {
            for (const [v] of foes) if (v !== tgt && Math.abs(v.p - tgt.p) <= d.splash) hurt(v, d.dmg * 0.6, s);
            B.fx.push({ ring: '#b06cff', p: tgt.p, x: tgt.x, r: d.splash, t: 0.3 });
          }
          B.fx.push({ line: d.range > 8 ? '#ffd166' : '#fff', p: u.p, x: u.x, p2: tgt.p, x2: tgt.x, t: 0.15 });
        }
        u.atkT = d.rate; u.act = 0.2;
      }
    }
    if (u.act > 0) u.act -= dt;
    // 進む(相手の体を通りぬけない・城の前で止まる)
    if (!stop && nd > 2 && castleGap > 2) {
      u.p += dir * d.spd * slowF * dt;
      u.p = Math.max(0, Math.min(LANE, u.p));
    }
  }
  B.units = B.units.filter(u => u.hp > 0);
  for (const f of B.fx) f.t -= dt;
  B.fx = B.fx.filter(f => f.t > 0);

  if (B.castle[0] <= 0 || B.castle[1] <= 0) B.over = B.castle[1] <= 0 && B.castle[0] > 0 ? 'win' : B.castle[0] <= 0 && B.castle[1] > 0 ? 'lose' : 'draw';
  else if (B.t >= TIME_LIMIT) B.over = B.castle[0] > B.castle[1] ? 'win' : B.castle[0] < B.castle[1] ? 'lose' : 'draw';
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
  A.think = 0.5;
  // 城のまわりに相手が来たら、城の一撃
  const close = B.units.filter(u => u.side === 0 && fromHome(1, u.p) <= STRIKE.reach);
  const closeHp = close.reduce((a, u) => a + u.hp, 0);
  if (B.gauge[1] >= STRIKE.charge && (close.length >= 3 || closeHp >= 900 || B.castle[1] < CASTLE_HP * 0.35 && close.length)) strike(1);
  // 押されていたら、安いのを急いで出す
  const danger = B.units.some(u => u.side === 0 && fromHome(1, u.p) <= 30);
  if (danger && canSpawn(1, 'goblin') && B.rng() < 0.5) { spawn(1, 'goblin'); return; }
  if (!A.next || B.cd[1][A.next] > 3) A.next = cpuPick();
  if (canSpawn(1, A.next)) { spawn(1, A.next); A.next = null; }
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
    <div>${T('① 12体のキャラから4体を選ぶ')}</div>
    <div>${T('② コインは時間でたまる。ボタンでキャラを出撃させる')}</div>
    <div>${T('③ キャラは相手の城へ進み、ぶつかった敵と戦う')}</div>
    <div>${T('④ ゲージがたまったら「城の一撃」で、城のまわりの敵を一気に攻撃')}</div>
    <div>${T('⑤ 相手の城のHPを先に0にしたほうが勝ち(5分たったら、城のHPが多いほうの勝ち)')}</div>
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
    const u = UNITS[k], on = picks.includes(k);
    return `<button class="ucard ${on ? 'on' : ''} r-${u.role}" data-k="${k}">
      <img src="${imgSrc(k)}" alt="">
      <span class="nm">${T(u.name)}</span>
      <span class="rl">${T(ROLE_NAME[u.role])}・${u.cost}</span>
      <span class="ds">${T(u.desc)}</span>
    </button>`;
  }).join('');
  const lv = ['easy', 'normal', 'hard'].map(l => `<button class="sub mini ${l === cpuLevel ? 'on' : ''}" data-lv="${l}">${T({ easy: 'かんたん', normal: 'ふつう', hard: 'むずかしい' }[l])}</button>`).join('');
  app.innerHTML = `
  <h1>${T('キャラを4体選ぶ')}</h1>
  <div class="dim">${T('選んだ4体だけを、試合で出撃できます({n}/4)', { n: picks.length })}</div>
  <div class="ugrid">${cards}</div>
  <div class="seg"><span class="dim small">${T('CPUの強さ')}</span> ${lv}</div>
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
  <div class="pal">${picks.map(k => `<button class="pb r-${UNITS[k].role}" data-k="${k}"><img src="${imgSrc(k)}" alt=""><span>${UNITS[k].cost}</span><i class="cdv"></i></button>`).join('')}</div>
  <div class="row">
    <button id="strike" class="strike"><i id="gauge"></i><span>${T('城の一撃')}</span></button>
    <button id="spd" class="sub mini">▶︎×1</button>
    <button id="pause" class="sub mini">⏸</button>
    <button id="quit" class="sub mini">✕</button>
  </div>`;
  cv = $('cv'); cx = cv.getContext('2d');
  resize();
  app.querySelectorAll('.pb').forEach(b => b.onclick = () => { if (!spawn(0, b.dataset.k) && B.coin[0] < UNITS[b.dataset.k].cost) toast(T('コインが足りない')); });
  $('strike').onclick = () => strike(0);
  $('spd').onclick = () => { B.speed = B.speed === 1 ? 2 : 1; $('spd').textContent = '▶︎×' + B.speed; };
  $('pause').onclick = () => { B.paused = !B.paused; $('pause').textContent = B.paused ? '▶︎' : '⏸'; };
  $('quit').onclick = () => { B.over = 'quit'; };
  lastT = performance.now(); acc = 0;
  raf = requestAnimationFrame(loop);
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

function stopLoop() { if (raf) cancelAnimationFrame(raf); raf = 0; }
function loop(now) {
  const dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
  if (!B.paused && !B.over) { acc += dt * B.speed; while (acc >= TICK) { sim(); acc -= TICK; if (B.over) break; } }
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
    b.querySelector('.cdv').style.height = (cd > 0 ? cd / UNITS[k].cd * 100 : 0) + '%';
  });
  const g = B.gauge[0] / STRIKE.charge;
  $('gauge').style.width = g * 100 + '%';
  $('strike').classList.toggle('ready', g >= 1);
  $('toasts').innerHTML = toasts.slice(-2).map(t => `<div class="toast">${esc(t.msg)}</div>`).join('');
}

/* ---------- 戦場をかく ---------- */
const TOP = () => H * 0.17, BOT = () => H * 0.9;
const Y = p => BOT() - (p / LANE) * (BOT() - TOP());
const X = x => W / 2 + x * W * 0.2;
function draw() {
  cx.fillStyle = '#5d8a4a'; cx.fillRect(0, 0, W, H);
  // 道
  cx.fillStyle = '#c9a66b'; cx.fillRect(W * 0.2, 0, W * 0.6, H);
  cx.fillStyle = 'rgba(0,0,0,.07)';
  for (let i = 0; i < 12; i++) cx.fillRect(W * 0.2, (i * H) / 12, W * 0.6, 2);
  // 城の一撃が届く範囲(ゲージがたまっているとき)
  if (B.gauge[0] >= STRIKE.charge) { cx.fillStyle = 'rgba(255,215,0,.13)'; cx.fillRect(W * 0.2, Y(STRIKE.reach), W * 0.6, H - Y(STRIKE.reach)); }
  castle(Y(LANE), 1); castle(Y(0), 0);
  // キャラ(奥=上から順に)
  const us = B.units.slice().sort((a, b) => Y(a.p) - Y(b.p) || a.id - b.id);
  for (const u of us) {
    const key = B.kind[u.side] === 'u' ? u.k : 'e-' + u.k, im = img(key);
    const w = W * 0.27 * (u.d.size || 1), h = w * 100 / 176;
    const x = X(u.x), y = Y(u.p) - (u.act > 0 ? (u.side ? -3 : 3) : 0);
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
    if (f.line) { cx.strokeStyle = f.line; cx.lineWidth = 2; cx.beginPath(); cx.moveTo(X(f.x), Y(f.p)); cx.lineTo(X(f.x2), Y(f.p2)); cx.stroke(); }
    if (f.ring) { cx.strokeStyle = f.ring; cx.lineWidth = 2; cx.beginPath(); const r = (f.r ? f.r / LANE * (BOT() - TOP()) : W * 0.06); cx.ellipse(X(f.x), Y(f.p), Math.min(r, W * 0.3), r, 0, 0, 7); cx.stroke(); }
    if (f.boom) { cx.fillStyle = '#fff3'; cx.beginPath(); cx.arc(X(f.x), Y(f.p), W * 0.07 * (1.4 - f.t), 0, 7); cx.fill(); }
    if (f.strike !== undefined) {
      const s = f.strike, y0 = Y(homeP(s)), y1 = Y(s === 0 ? STRIKE.reach : LANE - STRIKE.reach);
      cx.fillStyle = 'rgba(255,200,40,.45)'; cx.fillRect(0, Math.min(y0, y1), W, Math.abs(y1 - y0));
    }
    cx.globalAlpha = 1;
  }
}
function castle(y, side) {
  const w = W * 0.5, h = H * 0.07, x = W / 2 - w / 2, top = side ? y - h * 1.05 : y - h * 0.05;
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
    <div class="team">${picks.map(k => `<img src="${imgSrc(k)}" alt="">`).join('')}</div>
  </div>
  <button id="again" class="wide">${T('同じキャラでもう一回')}</button>
  <button id="re" class="sub">${T('キャラを選びなおす')}</button>
  <button id="hm2" class="sub">${T('ホームへ')}</button>`;
  $('again').onclick = play; $('re').onclick = draft; $('hm2').onclick = home;
}

/* テスト用(ブラウザのコンソールから: __br.B など) */
window.__br = { get B() { return B }, sim, spawn, strike, newBattle, setPicks(p) { picks = p }, setCpu(l) { cpuLevel = l } };

home();
