/* BANNER RAID オンライン対戦(v=12〜)。game.js のあとに読む。最後にホーム画面を出す。
   Firebase は Labyrinth・お絵描きと同じプロジェクト(labyrinth-game-bc5aa)。場所は br-rooms/{部屋コード}。

   しくみ(2人のスマホで同じ戦場にする):
   - 戦場の計算(sim)は2人とも同じものを、同じコマ数だけ進める。ランダムは部屋ごとの同じ種(seed)。
   - やりとりするのは「操作」だけ: { s: 陣営, t: 何コマ目に, a: 's'出撃 / 'u'強化 / 'x'城の一撃, k: キャラ, l: 道, n: 通し番号 }。
     操作は押したコマ + DELAY のコマで、2人とも同時に実行する。
   - それぞれ fr(フロンティア)を書く: 「このコマまでは、もう新しい操作を出さない」という約束。
     相手の fr より先へは進まない(相手を待つ)。だから、2人の戦場はずれない。
   - ずれていないかの確かめ: 150コマごとに、城のHP・キャラの数などを hash に書いて、くらべる。

   部屋のデータ:
   br-rooms/{code}/meta     { state: 'lobby' | 'pick' | 'play', lanes, seed, round, host }
   br-rooms/{code}/players/{uid}  { name, joined }      … 回線が切れたら消える
   br-rooms/{code}/picks/{uid}    "sword,archer,knight,cleric"
   br-rooms/{code}/cmds/{round}/{push}   操作
   br-rooms/{code}/fr/{round}/{side}     フロンティア
   br-rooms/{code}/hash/{round}/{side}/{tick} */

const DELAY = 12;        // 操作は 12コマ(0.4秒)あとに実行する
const FR_EVERY = 3;      // fr は 3コマごとに書く
const HASH_EVERY = 150;  // 5秒ごとに、ずれていないか確かめる

const NET = { db: null, uid: null, off: 0, code: null, ref: null, meta: null, players: {}, picks: {}, round: 0,
  side: 0, cmds: {}, fr: [DELAY - 1, DELAY - 1], sentFr: -1, seq: 0, pend: {}, hashes: {}, wait: 0, desync: false, started: false, leaving: false };
let myName = LS.get('br-name') || '';

/* ---------- つなぐ(はじめて「オンライン対戦」を押したときだけ) ---------- */
function netInit() {
  if (NET.db) return Promise.resolve(true);
  if (typeof firebase === 'undefined' || typeof firebaseConfig === 'undefined') return Promise.resolve(false);
  try {
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    /* App Check: このサイトから来たアクセスだと証明する(失敗してもゲームは続ける) */
    try { firebase.appCheck().activate(new firebase.appCheck.ReCaptchaEnterpriseProvider('6LfFffwtAAAAAKMoDAtqJDlgLK720RWBuBENti2t'), true); } catch (e) { console.warn('App Check', e); }
    NET.db = firebase.database();
  } catch (e) { console.warn(e); return Promise.resolve(false); }
  /* 見えない匿名ログイン。uid をそのままプレイヤーの ID にする(ルールで「自分の場所しか書けない」をチェック) */
  return new Promise(res => {
    let done = false; const fin = ok => { if (!done) { done = true; res(ok); } };
    try { firebase.auth().signInAnonymously().then(c => { NET.uid = c.user.uid; fin(true); }).catch(e => { console.warn(e); fin(false); }); } catch (e) { fin(false); }
    setTimeout(() => fin(!!NET.uid), 8000);
  });
}

/* ---------- 画面: オンラインのホーム ---------- */
function netHome(err) {
  stopLoop();
  app.innerHTML = `
  <h1 class="title">BANNER RAID</h1>
  <div class="dim">${T('オンライン対戦(2人)')}</div>
  <div class="card">
    <input id="nm" maxlength="8" placeholder="${T('なまえ')}" value="${esc(myName)}">
    <button id="mk" class="wide">${T('部屋を作る')}</button>
    <hr>
    <input id="cd" inputmode="numeric" maxlength="4" placeholder="${T('部屋コード(4けた)')}" value="${esc(LS.get('br-room') || '')}">
    <button id="jn" class="wide sub">${T('入室する')}</button>
    <div class="err" id="er">${err ? esc(err) : ''}</div>
  </div>
  <button id="back" class="sub">${T('もどる')}</button>`;
  $('mk').onclick = () => netEnter(null);
  $('jn').onclick = () => netEnter($('cd').value.trim());
  $('back').onclick = home;
}

async function netEnter(code) {
  const nm = $('nm').value.trim();
  if (!nm) { $('er').textContent = T('なまえを入れてね'); return; }
  if (code !== null && !/^\d{4}$/.test(code)) { $('er').textContent = T('部屋コードは4けたの数字だよ'); return; }
  myName = nm; LS.set('br-name', nm);
  $('er').textContent = T('接続中…');
  if (!(await netInit()) || !NET.uid) { $('er').textContent = T('つながりませんでした。もう一度ためしてね'); return; }
  try {
    const rooms = NET.db.ref('br-rooms');
    if (code === null) {
      for (let i = 0; i < 20; i++) { code = String(1000 + Math.floor(Math.random() * 9000)); if (!(await rooms.child(code).get()).exists()) break; }
      await rooms.child(code + '/meta').set({ state: 'lobby', lanes: laneCount, round: 0, created: firebase.database.ServerValue.TIMESTAMP });
    } else {
      const meta = (await rooms.child(code + '/meta').get()).val();
      if (!meta) { $('er').textContent = T('部屋がありません'); return; }
      const ps = (await rooms.child(code + '/players').get()).val() || {};
      const others = Object.keys(ps).filter(id => id !== NET.uid);
      if (others.length >= 2 || (others.length >= 1 && !ps[NET.uid] && Object.keys(ps).length >= 2)) { $('er').textContent = T('満員です'); return; }
      if (meta.state !== 'lobby' && !ps[NET.uid]) { $('er').textContent = T('もう始まっています'); return; }
    }
    NET.code = code; NET.ref = rooms.child(code);
    const me = NET.ref.child('players/' + NET.uid);
    const old = (await me.get()).val();
    await me.set({ name: myName, joined: old && old.joined || firebase.database.ServerValue.TIMESTAMP });
    me.onDisconnect().remove();
    LS.set('br-room', code);
    netListen();
  } catch (e) { console.warn(e); $('er').textContent = T('つながりませんでした。もう一度ためしてね'); }
}

/* 部屋を見はる(cmds は対戦が始まってから) */
function netListen() {
  NET.leaving = false; NET.got = {};
  // 3つとも最初の値が届いてから画面を決める(先に meta だけ届くと、まだ自分がいないように見えるため)
  NET.ref.child('meta').on('value', s => { NET.meta = s.val(); NET.got.meta = 1; netRoute(); });
  NET.ref.child('players').on('value', s => { NET.players = s.val() || {}; NET.got.players = 1; netRoute(); });
  NET.ref.child('picks').on('value', s => { NET.picks = s.val() || {}; NET.got.picks = 1; netRoute(); });
}
function netUnlisten() {
  if (!NET.ref) return;
  for (const c of ['meta', 'players', 'picks']) NET.ref.child(c).off();
  netBattleOff();
}

/* 入った順: 先に入った人がホスト(side 0) */
function netOrder() {
  return Object.entries(NET.players).sort((a, b) => (a[1].joined || 0) - (b[1].joined || 0) || (a[0] < b[0] ? -1 : 1)).map(e => e[0]);
}
const netIsHost = () => netOrder()[0] === NET.uid;
function netFoeName() { const id = netOrder().find(i => i !== NET.uid); return id && NET.players[id] ? NET.players[id].name : T('相手'); }

/* 部屋の状態で画面を切りかえる */
let netScreen = '';
function netRoute() {
  if (NET.leaving || !NET.ref || !NET.got || !(NET.got.meta && NET.got.players && NET.got.picks)) return;
  const m = NET.meta;
  if (!m) { netCleanup(); return netHome(T('部屋が閉じました')); }
  if (!NET.players[NET.uid]) { netCleanup(); return netHome(T('部屋から外れました')); }
  const order = netOrder();
  // 対戦中に相手がいなくなった
  if (B && B.online && !B.over && NET.started && order.length < 2) { B.over = 'forfeit'; return; }
  if (m.state === 'lobby') return netLobby();
  if (m.state === 'pick') {
    if (order.length < 2) { if (netIsHost()) NET.ref.child('meta/state').set('lobby'); return; }
    if (!NET.picks[NET.uid]) { if (netScreen !== 'pick') netPickScreen(); return; }
    // 2人とも決めたら、ホストが対戦を始める
    if (order.every(id => NET.picks[id]) && netIsHost()) {
      NET.ref.child('meta').update({ state: 'play', seed: (Math.floor(Math.random() * 0x7fffffff) | 1), round: (m.round || 0) + 1 });
      return;
    }
    return netWaitScreen(T('相手がキャラを選ぶのを待っています…'));
  }
  if (m.state === 'play') {
    if (NET.round !== m.round && order.length === 2 && order.every(id => NET.picks[id])) netStart();
    else if (NET.round !== m.round) netWaitScreen(T('もう始まっています'));
  }
}

/* ---------- 画面: 待ちあい ---------- */
function netLobby() {
  netScreen = 'lobby'; stopLoop();
  const order = netOrder(), host = netIsHost(), m = NET.meta;
  const names = order.map((id, i) => `<span class="pl ${id === NET.uid ? 'me' : ''}">${i === 0 ? '👑 ' : ''}${esc(NET.players[id].name)}</span>`).join('<span class="vs">VS</span>');
  const ln = [1, 2, 3].map(n => `<button class="sub mini ${n === m.lanes ? 'on' : ''}" data-ln="${n}" ${host ? '' : 'disabled'}>${T('{n}本', { n })}</button>`).join('');
  app.innerHTML = `
  <h1>${T('部屋コード')}</h1>
  <div class="code">${esc(NET.code)}</div>
  <div class="dim small">${T('このコードを相手に教えてね')}</div>
  <div class="card">${names}${order.length < 2 ? `<div class="dim">${T('相手が入るのを待っています…')}</div>` : ''}</div>
  <div class="seg"><span class="dim small">${T('道の数')}</span> ${ln}</div>
  ${host ? `<button id="st" class="wide" ${order.length === 2 ? '' : 'disabled'}>${T('はじめる(キャラ選びへ)')}</button>` : `<div class="dim">${T('ホストが「はじめる」を押すのを待っています')}</div>`}
  <button id="lv" class="sub">${T('部屋を出る')}</button>`;
  if (host) {
    app.querySelectorAll('[data-ln]').forEach(b => b.onclick = () => { laneCount = +b.dataset.ln; LS.set('br-lanes', laneCount); NET.ref.child('meta/lanes').set(laneCount); });
    $('st').onclick = async () => { await NET.ref.child('picks').remove(); NET.ref.child('meta/state').set('pick'); };
  }
  $('lv').onclick = netLeave;
}

function netPickScreen() {
  netScreen = 'pick';
  draft({ note: T('道は{n}本。2人とも決めたら始まります', { n: NET.meta.lanes }), done: p => NET.ref.child('picks/' + NET.uid).set(p.join(',')) });
}
function netWaitScreen(msg) {
  if (netScreen === 'wait:' + msg) return;
  netScreen = 'wait:' + msg; stopLoop();
  app.innerHTML = `<h1 class="title">BANNER RAID</h1><div class="card">${esc(msg)}</div><button id="lv" class="sub">${T('部屋を出る')}</button>`;
  $('lv').onclick = netLeave;
}

/* ---------- 対戦 ---------- */
function netStart() {
  const m = NET.meta, order = netOrder();
  netBattleOff();
  NET.round = m.round; NET.side = order.indexOf(NET.uid);
  NET.cmds = {}; NET.fr = [DELAY - 1, DELAY - 1]; NET.sentFr = -1; NET.seq = 0; NET.pend = {}; NET.hashes = {}; NET.wait = 0; NET.desync = false; NET.started = true;
  const decks = order.map(id => String(NET.picks[id]).split(',').filter(k => UNITS[k]).slice(0, 4));
  netScreen = 'play';
  play({ side: NET.side, seed: m.seed, lanes: m.lanes || 2, decks });
  const r = NET.round;
  NET.ref.child('cmds/' + r).on('child_added', s => netGotCmd(s.val()));
  NET.ref.child('fr/' + r).on('value', s => { const v = s.val() || {}; for (const sd of [0, 1]) if (typeof v[sd] === 'number') NET.fr[sd] = Math.max(NET.fr[sd], v[sd]); });
  NET.ref.child('hash/' + r + '/' + (1 - NET.side)).on('child_added', s => netCheckHash(+s.key, s.val()));
  // 前の対戦のデータは、ホストが消しておく
  if (NET.side === 0 && r > 1) NET.ref.update({ ['cmds/' + (r - 1)]: null, ['fr/' + (r - 1)]: null, ['hash/' + (r - 1)]: null });
}
function netBattleOff() {
  if (!NET.ref || !NET.round) return;
  const r = NET.round;
  NET.ref.child('cmds/' + r).off(); NET.ref.child('fr/' + r).off(); NET.ref.child('hash/' + r + '/' + (1 - NET.side)).off();
}

/* 自分の操作を送る(自分の表にもすぐ入れる) */
function netSend(a, k, lane) {
  if (!B || B.over) return false;
  if (a === 'u' && NET.pend['u' + k]) return false;   // 同じキャラの強化は、前のが終わるまで待つ
  const c = { s: NET.side, t: B.tick + DELAY, a, k: k || null, l: lane | 0, n: NET.seq++ };
  netAddCmd(c);
  if (a === 'u') NET.pend['u' + k] = true;
  NET.ref.child('cmds/' + NET.round).push(c);
  return true;
}
function netAddCmd(c) { (NET.cmds[c.t] = NET.cmds[c.t] || []).push(c); }
function netGotCmd(c) {
  if (!c || c.s === NET.side) return;   // 自分のは、もう入れてある
  if (B && c.t <= B.tick) { NET.desync = true; console.warn('おそすぎる操作', c, B.tick); }
  netAddCmd(c);
}
/* そのコマの操作を実行する(陣営・通し番号の順。2人とも同じ順) */
function netApply(tick) {
  const list = NET.cmds[tick]; if (!list) return;
  list.sort((a, b) => a.s - b.s || a.n - b.n);
  for (const c of list) {
    if (c.a === 's') spawn(c.s, c.k, c.l);
    else if (c.a === 'u') { levelUp(c.s, c.k); if (c.s === NET.side) delete NET.pend['u' + c.k]; }
    else if (c.a === 'x') strike(c.s, c.l);
  }
  delete NET.cmds[tick];
}

/* 1フレームぶん進める(相手の約束より先へは進まない) */
function netStep(dt) {
  acc = Math.min(acc + dt, 0.3);
  let moved = false;
  while (acc >= TICK && !B.over) {
    const next = B.tick + 1;
    if (next > NET.fr[1 - NET.side]) break;   // 相手を待つ
    netApply(next); sim(); acc -= TICK; moved = true;
    if (B.tick % HASH_EVERY === 0) netHash();
  }
  NET.wait = moved ? 0 : NET.wait + dt;
  // 自分の約束(このコマ + DELAY - 1 までは、もう操作を出さない)
  const myFr = B.tick + DELAY - 1;
  if (myFr - NET.sentFr >= FR_EVERY || (B.over && myFr > NET.sentFr)) { NET.sentFr = myFr; NET.ref.child('fr/' + NET.round + '/' + NET.side).set(myFr); }
}
function netHud() {
  const w = $('netwait');
  if (NET.wait > 1 && !w) $('toasts').insertAdjacentHTML('afterend', `<div id="netwait" class="netwait">${T('相手を待っています…')}</div>`);
  if (NET.wait <= 1 && w) w.remove();
  if (NET.desync && !NET.toldDesync) { NET.toldDesync = true; toast(T('2人の画面にずれが出ました')); }
}
/* ずれていないかの確かめ */
const netSig = () => [Math.round(B.castle[0]), Math.round(B.castle[1]), B.units.length, Math.floor(B.coin[0]), Math.floor(B.coin[1]), B.uid].join(',');
function netHash() {
  const h = netSig(); NET.hashes[B.tick] = h;
  NET.ref.child('hash/' + NET.round + '/' + NET.side + '/' + B.tick).set(h);
  if (NET.hashes['o' + B.tick] !== undefined) netCheckHash(B.tick, NET.hashes['o' + B.tick]);
}
function netCheckHash(tick, h) {
  if (NET.hashes[tick] === undefined) { NET.hashes['o' + tick] = h; return; }
  if (NET.hashes[tick] !== h) { NET.desync = true; console.warn('ずれ', tick, NET.hashes[tick], h); }
}

/* ---------- 結果 ---------- */
function netEndButtons() {
  return `<button id="again" class="wide">${T('もう一回(キャラ選びへ)')}</button>
  <button id="lobby" class="sub">${T('待ちあいへ')}</button>
  <button id="lv" class="sub">${T('部屋を出る')}</button>`;
}
function netEndInit() {
  NET.started = false;
  const go = async st => { netBattleOff(); await NET.ref.child('picks').remove(); NET.ref.child('meta/state').set(st); };
  $('again').onclick = () => go('pick');
  $('lobby').onclick = () => go('lobby');
  $('lv').onclick = netLeave;
  // 相手が先に押したら、そちらへ
  netScreen = 'end';
}

/* ---------- 部屋を出る ---------- */
async function netLeave() {
  if (!NET.ref) return home();
  NET.leaving = true;
  const ref = NET.ref, last = Object.keys(NET.players).filter(id => id !== NET.uid).length === 0;
  netUnlisten();
  try {
    ref.child('players/' + NET.uid).onDisconnect().cancel();
    if (last) await ref.remove(); else await ref.child('players/' + NET.uid).remove();
  } catch (e) { console.warn(e); }
  netCleanup();
  if (B && B.online && !B.over) B.over = 'quit';
  home();
}
function netCleanup() {
  netUnlisten();
  NET.ref = null; NET.code = null; NET.meta = null; NET.players = {}; NET.picks = {}; NET.round = 0; NET.started = false; netScreen = '';
  LS.set('br-room', '');
}

home();
