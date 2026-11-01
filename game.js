/* BANNER RAID 本体(試作: ひとりで CPU と対戦)
   画面: home(ホーム)→ draft(キャラ選び)→ play(対戦)→ end(結果)
   盤面の計算は sim(dt) だけ。オンライン対戦にするときも、この部分はそれぞれのスマホで動かす。 */

const $ = id => document.getElementById(id);
const app = $('app');
const LS = { get(k) { try { return localStorage.getItem(k) } catch (e) { return null } }, set(k, v) { try { localStorage.setItem(k, v) } catch (e) { } } };
const FOOT = () => `<p class="dim foot"><a href="${sitePath('/')}">${T("Muddy's Games トップ")}</a>・<a href="${sitePath('/privacy.html')}">${T('プライバシーポリシー')}</a></p>`;

/* ---------- 盤面(7×10マス)と道 ---------- */
const COLS = 7, ROWS = 10;
const WP = [[1, -0.6], [1, 2], [5, 2], [5, 5], [1, 5], [1, 8], [5, 8], [5, 9.5]];  // 道の曲がり角(マスの中心)
const SEG = [];
let PATH_LEN = 0;
for (let i = 0; i < WP.length - 1; i++) {
  const [x1, y1] = WP[i], [x2, y2] = WP[i + 1], L = Math.hypot(x2 - x1, y2 - y1);
  SEG.push({ x1, y1, x2, y2, L, s: PATH_LEN }); PATH_LEN += L;
}
const PATH = new Set();
for (const s of SEG) {
  const n = Math.ceil(s.L * 4);
  for (let k = 0; k <= n; k++) {
    const c = Math.round(s.x1 + (s.x2 - s.x1) * k / n), r = Math.round(s.y1 + (s.y2 - s.y1) * k / n);
    if (r >= 0 && r < ROWS) PATH.add(c + ',' + r);
  }
}
const BASE = { c: 5, r: 9 };
function posAt(d) {
  for (const s of SEG) if (d <= s.s + s.L) { const t = (d - s.s) / s.L; return [s.x1 + (s.x2 - s.x1) * t, s.y1 + (s.y2 - s.y1) * t]; }
  const s = SEG[SEG.length - 1]; return [s.x2, s.y2];
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/* ---------- ゲームの状態 ---------- */
let G = null;
let picks = (LS.get('br-picks') || '').split(',').filter(k => UNITS[k]).slice(0, 4);
let uid = 1;

function newGame() {
  G = {
    t: 0, coin: START_COIN, banner: BANNER_HP, cpu: BANNER_HP, speed: 1, paused: false, over: null,
    units: [], enemies: [], fx: [], toasts: [], sent: [], queue: [],
    wave: 0, nextWave: 4, passiveT: 0, cpuNext: 90, kills: 0, sel: null, place: null,
  };
}

/* 野良の敵の波。n が大きいほど数も種類も増える */
function makeWave(n) {
  const list = [];
  const cnt = 4 + Math.floor(n * 0.7);
  for (let i = 0; i < cnt; i++) {
    let k = 'goblin';
    const r = (i * 7 + n * 3) % 10;
    if (n >= 2 && r < 3) k = 'wolf';
    if (n >= 3 && r === 9) k = 'skeleton';
    if (n >= 4 && r === 5) k = 'orc';
    if (n >= 6 && r === 4) k = 'skeleton';
    if (n >= 8 && r === 3) k = 'orc';
    list.push(k);
  }
  return list;
}
function hpScale() {
  let m = 1 + G.wave * 0.09;
  if (G.t > RAMP_SEC) m *= 1 + (G.t - RAMP_SEC) / 60 * 0.3;
  return m;
}
function spawn(k, assassin) {
  const e = ENEMIES[k], m = assassin ? 1 + G.t / 240 : hpScale();
  const hp = Math.round(e.hp * m);
  G.enemies.push({ id: uid++, k, hp, max: hp, d: 0, x: WP[0][0], y: WP[0][1], slowT: 0, atkT: e.rate, by: null });
}

/* ---------- キャラの数値(レベル込み) ---------- */
const st = u => UNITS[u.k];
const uMax = u => Math.round(st(u).hp * Math.pow(LV_HP, u.lv - 1));
const uPow = (u, v) => v * Math.pow(LV_POW, u.lv - 1);
const lvCost = u => Math.round(st(u).cost * LVUP_COST * u.lv);
const revCost = u => Math.round(st(u).cost * REVIVE_COST);
const unitAt = (c, r) => G.units.find(u => u.c === c && u.r === r);

function placeUnit(k, c, r) {
  if (PATH.has(c + ',' + r) || unitAt(c, r) || G.coin < UNITS[k].cost) return false;
  G.coin -= UNITS[k].cost;
  const u = { id: uid++, k, c, r, x: c, y: r, lv: 1, hp: 0, cd: 0, down: 0, spent: UNITS[k].cost };
  u.hp = uMax(u); G.units.push(u); return u;
}
function levelUp(u) {
  if (u.lv >= LV_MAX || G.coin < lvCost(u)) return;
  const c = lvCost(u), ratio = u.hp / uMax(u);
  G.coin -= c; u.spent += c; u.lv++; if (!u.down) u.hp = Math.round(uMax(u) * ratio);
}
function revive(u) { if (u.down && G.coin >= revCost(u)) { G.coin -= revCost(u); u.down = 0; u.hp = uMax(u); } }
function sell(u) {
  G.coin += Math.floor(u.spent * SELL_BACK);
  for (const e of G.enemies) if (e.by === u.id) e.by = null;
  G.units = G.units.filter(x => x !== u); G.sel = null;
}
function hurtUnit(u, v) {
  if (u.down) return;
  u.hp -= v;
  if (u.hp <= 0) { u.hp = 0; u.down = REVIVE_SEC; for (const e of G.enemies) if (e.by === u.id) e.by = null; }
}
function hurtEnemy(e, v) { e.hp -= v; }

function toast(msg, cls) { G.toasts.push({ msg, cls: cls || '', t: 2.6 }); }

/* ---------- 刺客 ---------- */
function sendAssassin() {
  if (G.over || G.coin < ASSASSIN_COST) return;
  G.coin -= ASSASSIN_COST;
  G.sent.push({ t: 10 });
  toast(T('🥷 刺客を送った！'), 'me');
}
/* CPU のがわは試作用の「にせもの」: 時間とともに守りが固くなり、刺客が止められやすくなる */
function cpuGuard() { return Math.min(0.75, 0.2 + G.t / 700); }

/* ---------- 1コマ進める ---------- */
function sim(dt) {
  if (G.over) return;
  G.t += dt;

  // コイン(何もしなくても少しずつ)
  G.passiveT += dt;
  while (G.passiveT >= 2) { G.passiveT -= 2; G.coin += PASSIVE_COIN; }

  // 野良の敵の波
  G.nextWave -= dt;
  if (G.nextWave <= 0) {
    G.wave++; G.nextWave = G.t > RAMP_SEC ? WAVE_SEC * 0.75 : WAVE_SEC;
    makeWave(G.wave).forEach((k, i) => G.queue.push({ k, t: i * 0.8 })); G.queue.sort((a, b) => a.t - b.t);
    toast(T('第{n}波', { n: G.wave }));
  }
  for (const q of G.queue) q.t -= dt;
  while (G.queue.length && G.queue[0].t <= 0) { const q = G.queue.shift(); spawn(q.k, q.a); }

  // CPU から来る刺客
  G.cpuNext -= dt;
  if (G.cpuNext <= 0) {
    const two = G.t > RAMP_SEC;
    spawn('assassin', true); if (two) { G.queue.push({ k: 'assassin', t: 1.2, a: 1 }); G.queue.sort((a, b) => a.t - b.t); }
    G.cpuNext = Math.max(18, 45 - G.t / 15);
    toast(T('⚠️ CPUが刺客を送ってきた！'), 'warn');
  }
  // 自分が送った刺客がCPUに着く
  for (const s of G.sent) s.t -= dt;
  while (G.sent.length && G.sent[0].t <= 0) {
    G.sent.shift();
    if (Math.random() < cpuGuard()) toast(T('🥷 刺客は止められた…'));
    else { G.cpu = Math.max(0, G.cpu - ENEMIES.assassin.base); toast(T('🥷 CPUの旗に{n}ダメージ！', { n: ENEMIES.assassin.base }), 'good'); }
  }

  // キャラ
  const alive = G.units.filter(u => !u.down);
  for (const u of G.units) {
    if (u.down) { u.down -= dt; if (u.down <= 0) { u.down = 0; u.hp = uMax(u); } continue; }
    const s = st(u);
    if (s.regen) u.hp = Math.min(uMax(u), u.hp + uPow(u, s.regen) * dt);
    let haste = 1;
    for (const b of alive) if (b !== u && UNITS[b.k].haste && dist(b, u) <= UNITS[b.k].range) haste = Math.max(haste, UNITS[b.k].haste + 0.1 * (b.lv - 1));
    if (!s.rate) continue;
    u.cd -= dt * haste;
    if (u.cd > 0) continue;

    if (s.coin) { const c = Math.round(uPow(u, s.coin)); G.coin += c; u.cd = s.rate; G.fx.push({ txt: '+' + c, x: u.x, y: u.y, t: 0.9 }); continue; }
    if (s.heal) {
      const near = alive.filter(o => dist(o, u) <= s.range && o.hp < uMax(o));
      if (!near.length) continue;
      const v = uPow(u, s.heal);
      if (s.healAll) near.forEach(o => { o.hp = Math.min(uMax(o), o.hp + v); G.fx.push({ ring: '#4caf50', x: o.x, y: o.y, t: 0.4 }); });
      else { const o = near.sort((a, b) => a.hp / uMax(a) - b.hp / uMax(b))[0]; o.hp = Math.min(uMax(o), o.hp + v); G.fx.push({ line: '#4caf50', x: u.x, y: u.y, x2: o.x, y2: o.y, t: 0.25 }); }
      u.cd = s.rate; continue;
    }
    const inR = G.enemies.filter(e => e.hp > 0 && dist(e, u) <= s.range);
    if (!inR.length) continue;
    if (s.slow) {
      inR.forEach(e => { e.slowT = 1.3; e.slowF = 1 - Math.min(0.7, s.slow + 0.05 * (u.lv - 1)); hurtEnemy(e, uPow(u, s.dmg)); });
      G.fx.push({ ring: '#7cc8ff', x: u.x, y: u.y, r: s.range, t: 0.3 }); u.cd = s.rate; continue;
    }
    const tgt = s.target === 'maxhp' ? inR.sort((a, b) => b.hp - a.hp)[0] : inR.sort((a, b) => b.d - a.d)[0];
    const v = uPow(u, s.dmg);
    hurtEnemy(tgt, v);
    if (s.splash) { for (const e of G.enemies) if (e !== tgt && dist(e, tgt) <= s.splash) hurtEnemy(e, v * 0.6); G.fx.push({ ring: '#b06cff', x: tgt.x, y: tgt.y, r: s.splash, t: 0.3 }); }
    G.fx.push({ line: s.range > 1.5 ? '#ffd166' : '#fff', x: u.x, y: u.y, x2: tgt.x, y2: tgt.y, t: 0.15 });
    u.cd = s.rate;
  }

  // 敵
  const blockCount = {};
  for (const e of G.enemies) if (e.by) blockCount[e.by] = (blockCount[e.by] || 0) + 1;
  for (const e of G.enemies) {
    if (e.hp <= 0) continue;
    const s = ENEMIES[e.k];
    let blk = e.by && G.units.find(u => u.id === e.by && !u.down);
    if (!blk) {
      e.by = null;
      const cand = alive.filter(u => UNITS[u.k].block > 0 && (blockCount[u.id] || 0) < UNITS[u.k].block && dist(u, e) <= 1.05);
      if (cand.length) {
        blk = cand.sort((a, b) => (UNITS[b.k].taunt ? 1 : 0) - (UNITS[a.k].taunt ? 1 : 0))[0];
        e.by = blk.id; blockCount[blk.id] = (blockCount[blk.id] || 0) + 1;
      }
    }
    e.atkT -= dt;
    if (blk) {
      if (e.atkT <= 0) {
        e.atkT = s.rate;
        let v = s.dmg * (e.k === 'assassin' ? 1 + G.t / 400 : 1 + G.wave * 0.05);
        hurtUnit(blk, v);
        if (UNITS[blk.k].reflect) hurtEnemy(e, v * UNITS[blk.k].reflect);
      }
    } else {
      if (s.shoot && e.atkT <= 0) {
        const tg = alive.filter(u => !u.down && dist(u, e) <= s.shoot).sort((a, b) => (UNITS[b.k].taunt ? 1 : 0) - (UNITS[a.k].taunt ? 1 : 0) || dist(a, e) - dist(b, e))[0];
        if (tg) { e.atkT = s.rate; hurtUnit(tg, s.dmg); G.fx.push({ line: '#e57373', x: e.x, y: e.y, x2: tg.x, y2: tg.y, t: 0.15 }); }
      }
      if (e.slowT > 0) e.slowT -= dt;
      e.d += s.spd * (e.slowT > 0 ? e.slowF : 1) * dt;
      [e.x, e.y] = posAt(e.d);
      if (e.d >= PATH_LEN) { G.banner -= s.base; e.hp = -1; e.gone = true; G.fx.push({ ring: '#e53935', x: BASE.c, y: BASE.r, r: 0.8, t: 0.4 }); }
    }
  }
  for (const e of G.enemies) if (e.hp <= 0 && !e.gone) { G.coin += ENEMIES[e.k].coin; G.kills++; G.fx.push({ txt: '+' + ENEMIES[e.k].coin, x: e.x, y: e.y, t: 0.7 }); }
  G.enemies = G.enemies.filter(e => e.hp > 0);
  for (const e of G.enemies) if (e.by && !G.units.some(u => u.id === e.by)) e.by = null;

  for (const f of G.fx) f.t -= dt;
  G.fx = G.fx.filter(f => f.t > 0);

  if (G.banner <= 0) { G.banner = 0; G.over = 'lose'; }
  else if (G.cpu <= 0) G.over = 'win';
}

/* ---------- 画面: ホーム ---------- */
function home() {
  stopLoop();
  app.innerHTML = `
  <h1 class="title">🚩 BANNER RAID</h1>
  <div class="dim">${T('旗を守りながら、刺客を送りこめ！')}</div>
  ${langSwitchHtml()}
  <div class="card left">
    <div class="lbl">${T('遊び方')}</div>
    <div>${T('① 12体のキャラから4体を選ぶ')}</div>
    <div>${T('② 道のそばにキャラを置いて、旗(🚩)を守る')}</div>
    <div>${T('③ 敵を倒すとコイン。コインで「キャラを置く・強くする・刺客を送る」')}</div>
    <div>${T('④ 相手の旗のHPを先に0にしたほうが勝ち')}</div>
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
      <span class="ic">${u.icon}</span>
      <span class="nm">${T(u.name)}</span>
      <span class="rl">${T(ROLE_NAME[u.role])}・${u.cost}💰</span>
      <span class="ds">${T(u.desc)}</span>
    </button>`;
  }).join('');
  app.innerHTML = `
  <h1>${T('キャラを4体選ぶ')}</h1>
  <div class="dim">${T('選んだ4体だけを、試合で置けます({n}/4)', { n: picks.length })}</div>
  <div class="ugrid">${cards}</div>
  <button id="go" class="wide" ${picks.length === 4 ? '' : 'disabled'}>${T('出陣！')}</button>
  <button id="back" class="sub">${T('もどる')}</button>`;
  app.querySelectorAll('.ucard').forEach(b => b.onclick = () => {
    const k = b.dataset.k;
    if (picks.includes(k)) picks = picks.filter(x => x !== k);
    else if (picks.length < 4) picks.push(k);
    else return;
    draft();
  });
  $('go').onclick = () => { LS.set('br-picks', picks.join(',')); play(); };
  $('back').onclick = home;
}

/* ---------- 画面: 対戦 ---------- */
let cv, cx, CELL = 50, raf = 0, lastT = 0;
function play() {
  newGame();
  app.innerHTML = `
  <div class="hud">
    <span>🚩 <b id="hb">20</b></span>
    <span class="vs">VS</span>
    <span>CPU 🚩 <b id="hc">20</b></span>
    <span class="coin">💰 <b id="hm">0</b></span>
    <span class="dim" id="ht">0:00</span>
  </div>
  <div class="board"><canvas id="cv"></canvas><div id="toasts"></div></div>
  <div id="info" class="info"></div>
  <div class="pal" id="pal"></div>
  <div class="row">
    <button id="send" class="send">🥷 ${T('刺客を送る')} ${ASSASSIN_COST}💰</button>
    <button id="spd" class="sub mini">▶︎×1</button>
    <button id="pause" class="sub mini">⏸</button>
  </div>`;
  cv = $('cv'); cx = cv.getContext('2d');
  resize();
  $('pal').innerHTML = picks.map(k => `<button class="pb r-${UNITS[k].role}" data-k="${k}"><span class="ic">${UNITS[k].icon}</span><span>${UNITS[k].cost}💰</span></button>`).join('');
  $('pal').querySelectorAll('.pb').forEach(b => b.onclick = () => { G.place = G.place === b.dataset.k ? null : b.dataset.k; G.sel = null; drawInfo(); });
  $('send').onclick = sendAssassin;
  $('spd').onclick = () => { G.speed = G.speed === 1 ? 2 : 1; $('spd').textContent = '▶︎×' + G.speed; };
  $('pause').onclick = () => { G.paused = !G.paused; $('pause').textContent = G.paused ? '▶︎' : '⏸'; };
  cv.onclick = onTap;
  drawInfo();
  lastT = performance.now();
  raf = requestAnimationFrame(loop);
}
function resize() {
  const w = Math.min(app.clientWidth || 360, 460);
  const h = Math.max(320, window.innerHeight - 270);
  CELL = Math.floor(Math.min(w / COLS, h / ROWS));
  const dpr = window.devicePixelRatio || 1;
  cv.width = CELL * COLS * dpr; cv.height = CELL * ROWS * dpr;
  cv.style.width = CELL * COLS + 'px'; cv.style.height = CELL * ROWS + 'px';
  cx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', () => { if (G && cv && document.body.contains(cv)) resize(); });

function stopLoop() { if (raf) cancelAnimationFrame(raf); raf = 0; }
function loop(now) {
  let dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
  if (!G.paused && !G.over) { let n = Math.round(dt * G.speed / (1 / 60)); for (let i = 0; i < Math.max(1, n); i++) sim(1 / 60); }
  for (const t of G.toasts) t.t -= dt;
  G.toasts = G.toasts.filter(t => t.t > 0);
  draw(); hud();
  if (G.over) { raf = 0; setTimeout(end, 700); return; }
  raf = requestAnimationFrame(loop);
}

function onTap(ev) {
  const r = cv.getBoundingClientRect();
  const c = Math.floor((ev.clientX - r.left) / CELL), rr = Math.floor((ev.clientY - r.top) / CELL);
  if (c < 0 || c >= COLS || rr < 0 || rr >= ROWS) return;
  const u = unitAt(c, rr);
  if (u) { G.sel = u.id; G.place = null; }
  else if (G.place && !PATH.has(c + ',' + rr)) {
    if (G.coin < UNITS[G.place].cost) toast(T('コインが足りない'));
    else { placeUnit(G.place, c, rr); }
  } else { G.sel = null; }
  drawInfo();
}

/* 下の説明(置くキャラ / 選んだキャラ) */
let infoKey = '';
function drawInfo() {
  const box = $('info'); if (!box) return;
  const u = G.sel && G.units.find(x => x.id === G.sel);
  document.querySelectorAll('.pb').forEach(b => b.classList.toggle('on', b.dataset.k === G.place));
  if (u) {
    const s = st(u);
    infoKey = 'u' + u.id + ':' + u.lv + ':' + (u.down ? 1 : 0) + ':' + Math.floor(G.coin / 5);
    box.innerHTML = `<b>${s.icon} ${T(s.name)} Lv${u.lv}</b> <span class="dim small">${T(s.desc)}</span>
      <div class="row">
        ${u.lv < LV_MAX ? `<button id="lv" class="mini" ${G.coin < lvCost(u) ? 'disabled' : ''}>⬆️ ${T('強くする')} ${lvCost(u)}💰</button>` : `<span class="dim small">${T('最大レベル')}</span>`}
        ${u.down ? `<button id="rv" class="mini" ${G.coin < revCost(u) ? 'disabled' : ''}>💫 ${T('すぐ復活')} ${revCost(u)}💰</button>` : ''}
        <button id="sl" class="mini sub">${T('下げる')} +${Math.floor(u.spent * SELL_BACK)}💰</button>
      </div>`;
    if ($('lv')) $('lv').onclick = () => { levelUp(u); drawInfo(); };
    if ($('rv')) $('rv').onclick = () => { revive(u); drawInfo(); };
    $('sl').onclick = () => { sell(u); drawInfo(); };
  } else if (G.place) {
    const s = UNITS[G.place]; infoKey = 'p' + G.place;
    box.innerHTML = `<b>${s.icon} ${T(s.name)}</b> <span class="dim small">${T(s.desc)}</span><div class="dim small">${T('道のそばの空いたマスをタップして置く')}</div>`;
  } else {
    infoKey = 'none';
    box.innerHTML = `<div class="dim small">${T('下のキャラを選んで、マスをタップして置く。置いたキャラをタップすると、強くできる')}</div>`;
  }
}

function hud() {
  $('hb').textContent = Math.max(0, G.banner);
  $('hc').textContent = G.cpu;
  $('hm').textContent = G.coin;
  const s = Math.floor(G.t);
  $('ht').textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  $('send').disabled = G.coin < ASSASSIN_COST;
  document.querySelectorAll('.pb').forEach(b => b.classList.toggle('poor', G.coin < UNITS[b.dataset.k].cost));
  // 選んでいるキャラの状態が変わったら、説明を書きなおす
  const u = G.sel && G.units.find(x => x.id === G.sel);
  const k = u ? 'u' + u.id + ':' + u.lv + ':' + (u.down ? 1 : 0) + ':' + Math.floor(G.coin / 5) : G.place ? 'p' + G.place : 'none';
  if (k !== infoKey) drawInfo();
  $('toasts').innerHTML = G.toasts.slice(-3).map(t => `<div class="toast ${t.cls}">${t.msg}</div>`).join('');
}

/* ---------- 盤面をかく ---------- */
const X = c => (c + 0.5) * CELL, Y = r => (r + 0.5) * CELL;
function draw() {
  const W = CELL * COLS, H = CELL * ROWS;
  cx.fillStyle = '#5d8a4a'; cx.fillRect(0, 0, W, H);
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (PATH.has(c + ',' + r)) { cx.fillStyle = '#c9a66b'; cx.fillRect(c * CELL, r * CELL, CELL, CELL); }
    else if ((c + r) % 2) { cx.fillStyle = 'rgba(0,0,0,.06)'; cx.fillRect(c * CELL, r * CELL, CELL, CELL); }
  }
  // 置ける場所
  if (G.place) {
    cx.strokeStyle = 'rgba(255,255,255,.35)'; cx.lineWidth = 1;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (!PATH.has(c + ',' + r) && !unitAt(c, r)) cx.strokeRect(c * CELL + 3, r * CELL + 3, CELL - 6, CELL - 6);
  }
  cx.fillStyle = 'rgba(139,46,31,.35)'; cx.beginPath(); cx.arc(X(BASE.c), Y(BASE.r), CELL * 0.42, 0, 7); cx.fill();
  cx.fillStyle = '#c62828'; emoji('🚩', BASE.c, BASE.r, 0.7);
  // 選んだキャラの射程
  const su = G.sel && G.units.find(x => x.id === G.sel);
  if (su && st(su).range) { cx.strokeStyle = 'rgba(255,255,255,.7)'; cx.setLineDash([4, 4]); cx.beginPath(); cx.arc(X(su.x), Y(su.y), st(su).range * CELL, 0, 7); cx.stroke(); cx.setLineDash([]); }
  // キャラ
  for (const u of G.units) {
    cx.globalAlpha = u.down ? 0.35 : 1;
    cx.fillStyle = { atk: '#c0392b', tank: '#2c6fbb', heal: '#2e9e5b', sup: '#b8860b' }[st(u).role];
    roundRect(u.c * CELL + 3, u.r * CELL + 3, CELL - 6, CELL - 6, 8); cx.fill();
    emoji(st(u).icon, u.x, u.y, 0.55);
    cx.globalAlpha = 1;
    if (u.lv > 1) { cx.fillStyle = '#ffd700'; cx.font = `bold ${CELL * 0.22}px sans-serif`; cx.textAlign = 'left'; cx.fillText('★'.repeat(u.lv - 1), u.c * CELL + 5, u.r * CELL + CELL * 0.22); }
    if (u.down) { cx.fillStyle = '#fff'; cx.font = `bold ${CELL * 0.3}px sans-serif`; cx.textAlign = 'center'; cx.fillText(Math.ceil(u.down), X(u.x), Y(u.y)); }
    else bar(u.x, u.y + 0.38, u.hp / uMax(u), '#5cd65c');
    if (u.id === G.sel) { cx.strokeStyle = '#fff'; cx.lineWidth = 2; roundRect(u.c * CELL + 2, u.r * CELL + 2, CELL - 4, CELL - 4, 8); cx.stroke(); }
  }
  // 敵
  for (const e of G.enemies) {
    emoji(ENEMIES[e.k].icon, e.x, e.y, e.k === 'assassin' || e.k === 'orc' ? 0.62 : 0.5);
    if (e.slowT > 0) { cx.fillStyle = 'rgba(124,200,255,.35)'; cx.beginPath(); cx.arc(X(e.x), Y(e.y), CELL * 0.3, 0, 7); cx.fill(); }
    bar(e.x, e.y - 0.38, e.hp / e.max, e.k === 'assassin' ? '#9b59b6' : '#e74c3c');
  }
  // 攻撃などの演出
  for (const f of G.fx) {
    cx.globalAlpha = Math.min(1, f.t * 4);
    if (f.line) { cx.strokeStyle = f.line; cx.lineWidth = 2; cx.beginPath(); cx.moveTo(X(f.x), Y(f.y)); cx.lineTo(X(f.x2), Y(f.y2)); cx.stroke(); }
    if (f.ring) { cx.strokeStyle = f.ring; cx.lineWidth = 2; cx.beginPath(); cx.arc(X(f.x), Y(f.y), (f.r || 0.45) * CELL, 0, 7); cx.stroke(); }
    if (f.txt) { cx.fillStyle = '#ffe066'; cx.font = `bold ${CELL * 0.26}px sans-serif`; cx.textAlign = 'center'; cx.fillText(f.txt, X(f.x), Y(f.y) - (1 - f.t) * CELL * 0.5); }
    cx.globalAlpha = 1;
  }
}
function emoji(ch, x, y, size) { cx.font = `${CELL * size}px sans-serif`; cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.fillText(ch, X(x), Y(y) + CELL * 0.03); }
function bar(x, y, p, col) {
  const w = CELL * 0.7, h = Math.max(3, CELL * 0.07), px = X(x) - w / 2, py = Y(y) - h / 2;
  cx.fillStyle = 'rgba(0,0,0,.5)'; cx.fillRect(px, py, w, h);
  cx.fillStyle = col; cx.fillRect(px, py, w * Math.max(0, Math.min(1, p)), h);
}
function roundRect(x, y, w, h, r) { cx.beginPath(); cx.moveTo(x + r, y); cx.arcTo(x + w, y, x + w, y + h, r); cx.arcTo(x + w, y + h, x, y + h, r); cx.arcTo(x, y + h, x, y, r); cx.arcTo(x, y, x + w, y, r); cx.closePath(); }

/* ---------- 画面: 結果 ---------- */
function end() {
  if (!G || !G.over) return;
  const s = Math.floor(G.t), win = G.over === 'win';
  app.innerHTML = `
  <h1 class="title">${win ? T('🏆 勝利！') : T('🏳️ 敗北…')}</h1>
  <div class="card">
    <div>${win ? T('CPUの旗を落とした！') : T('旗を守りきれなかった…')}</div>
    <div class="dim">${T('時間 {m}分{s}秒・第{w}波・倒した敵 {k}', { m: Math.floor(s / 60), s: s % 60, w: G.wave, k: G.kills })}</div>
    <div class="big">${picks.map(k => UNITS[k].icon).join(' ')}</div>
  </div>
  <button id="again" class="wide">${T('同じキャラでもう一回')}</button>
  <button id="re" class="sub">${T('キャラを選びなおす')}</button>
  <button id="hm2" class="sub">${T('ホームへ')}</button>`;
  $('again').onclick = play; $('re').onclick = draft; $('hm2').onclick = home;
}

/* テスト用(ブラウザのコンソールから: __br.G など) */
window.__br = { get G() { return G }, sim, newGame, placeUnit, sendAssassin, levelUp, PATH, UNITS };

home();
