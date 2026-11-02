/* BANNER RAID オンライン対戦(v=13〜: 8人まで。フロア式・トーナメント・チーム戦)。game.js のあとに読む。最後にホーム画面を出す。
   Firebase は Labyrinth・お絵描きと同じプロジェクト(labyrinth-game-bc5aa)。場所は br-rooms/{部屋コード}。

   部屋のデータ:
   meta      { state: 'lobby' | 'play', mode: 'floor' | 'tour' | 'team', lanes, round, champ }
   players/{uid}  { name, joined, seat: 'A'〜'D' + '0'/'1'(フロア式の席), team: 0 / 1(チーム戦) }   … 回線が切れたら消える
   games/{gid}    { round, seed, lanes, s0: "uid,uid", s1: "uid,uid", label, tr(トーナメントの何回戦), result: 'w0' | 'w1' | 'd' }
   picks/{gid}/{uid}   "sword,archer,knight,cleric"
   tour/{tr}           "uid,uid,uid,,..."(2人ずつ組。'' は不戦勝)
   cmds/{gid}/{push}   操作 { p: プレイヤー番号, t: コマ, a: 's'出撃 / 'u'強化 / 'x'城の一撃, k, l, n }
   fr/{gid}/{p}        フロンティア
   hash/{gid}/{p}/{コマ}

   同じ戦場にするしくみ(1試合の中):
   - 戦場の計算(sim)は、出ている人も観戦している人も同じものを同じコマ数だけ進める。ランダムは試合ごとの同じ種(seed)。
   - 操作は、押したコマ + DELAY のコマで、みんな同時に実行する。
   - 出ている人はそれぞれ fr(「このコマまでは、もう新しい操作を出さない」という約束)を書く。
     全員の fr のいちばん小さいコマより先へは進まない(待つ)。部屋からいなくなった人の fr は数えない。
   - 150コマごとに、城のHP・キャラの数・コインを hash に書いてくらべる。 */

const DELAY = 12;        // 操作は 12コマ(0.4秒)あとに実行する
const FR_EVERY = 3;      // fr は 3コマごとに書く
const HASH_EVERY = 150;  // 5秒ごとに、ずれていないか確かめる
const MAX_PLAYERS = 8;
const FLOORS = ['A', 'B', 'C', 'D'];

const NET = { db: null, uid: null, code: null, ref: null, got: {}, meta: null, players: {}, games: {}, picks: {}, tour: {},
  gid: null, watch: false, slots: [], me: -1, cmds: {}, fr: {}, sentFr: -1, seq: 0, pend: {}, hashes: {}, wait: 0, desync: false, leaving: false };
let myName = LS.get('br-name') || '';
let netScreen = '';

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
  stopLoop(); netScreen = 'home'; guardRoom(false);
  app.innerHTML = `
  <h1 class="title">BANNER RAID</h1>
  <div class="dim">${T('オンライン対戦(8人まで)')}</div>
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
      await rooms.child(code + '/meta').set({ state: 'lobby', mode: LS.get('br-mode') || 'floor', lanes: laneCount, round: 0, created: firebase.database.ServerValue.TIMESTAMP });
    } else {
      const meta = (await rooms.child(code + '/meta').get()).val();
      if (!meta) { $('er').textContent = T('部屋がありません'); return; }
      const ps = (await rooms.child(code + '/players').get()).val() || {};
      if (!ps[NET.uid] && Object.keys(ps).length >= MAX_PLAYERS) { $('er').textContent = T('満員です'); return; }
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

/* 部屋を見はる(5つとも最初の値が届いてから画面を決める) */
const NET_PARTS = ['meta', 'players', 'games', 'picks', 'tour'];
function netListen() {
  NET.leaving = false; NET.got = {};
  for (const c of NET_PARTS) NET.ref.child(c).on('value', s => { NET[c] = s.val() || (c === 'meta' ? null : {}); NET.got[c] = 1; netRoute(); });
}
function netUnlisten() {
  if (!NET.ref) return;
  for (const c of NET_PARTS) NET.ref.child(c).off();
  netBattleOff();
}

/* ---------- 部屋の人 ---------- */
function netOrder() {
  return Object.entries(NET.players).sort((a, b) => (a[1].joined || 0) - (b[1].joined || 0) || (a[0] < b[0] ? -1 : 1)).map(e => e[0]);
}
const netIsHost = () => netOrder()[0] === NET.uid;
const pname = id => (NET.players[id] ? NET.players[id].name : (NET.names && NET.names[id]) || T('いなくなった人'));
const gameSides = g => [g.s0 ? String(g.s0).split(',') : [], g.s1 ? String(g.s1).split(',') : []];
const gameSlots = g => { const [a, b] = gameSides(g); return a.map(id => ({ id, side: 0 })).concat(b.map(id => ({ id, side: 1 }))); };
/* 陣営の名前(チームなら「青チーム」、1人ならその人の名前) */
function netSideName(sd) {
  const g = NET.games[NET.gid]; if (!g) return sd ? T('相手') : T('自分');
  const ids = gameSides(g)[sd];
  if (ids.length > 1) return sd === 0 ? T('青チーム') : T('赤チーム');
  return ids[0] ? pname(ids[0]) : '?';
}
function netCurGames() {
  const r = NET.meta ? NET.meta.round : 0;
  return Object.entries(NET.games).filter(([, g]) => g.round === r).sort((a, b) => (a[1].tr || 0) - (b[1].tr || 0) || (a[0] < b[0] ? -1 : 1));
}
/* 自分が出る、まだ終わっていない試合 */
function netMyGame() {
  for (const [gid, g] of netCurGames()) if (!g.result && gameSlots(g).some(s => s.id === NET.uid)) return gid;
  return null;
}
const allPicked = gid => gameSlots(NET.games[gid]).every(s => NET.picks[gid] && NET.picks[gid][s.id]);

/* ---------- 部屋の状態で画面を切りかえる ---------- */
function netRoute() {
  if (NET.leaving || !NET.ref || NET_PARTS.some(c => !NET.got[c])) return;
  const m = NET.meta;
  if (!m) { netCleanup(); return netHome(T('部屋が閉じました')); }
  if (!NET.players[NET.uid]) { netCleanup(); return netHome(T('部屋から外れました')); }
  NET.names = Object.assign(NET.names || {}, Object.fromEntries(Object.entries(NET.players).map(([id, p]) => [id, p.name])));
  // 観戦中に自分の次の試合ができたら、観戦をやめてそちらへ
  if (netScreen === 'watch' && netMyGame()) netStopWatch(true);
  // 対戦中・観戦中
  if (B && B.online && NET.gid && !B.over && (netScreen === 'play' || netScreen === 'watch')) { netCheckGone(); return; }
  if (netScreen === 'end') return;   // 結果の画面は「つづける」を押すまでそのまま
  if (m.state === 'lobby') return netLobby();
  // 試合の進行(ホスト): トーナメントの次の回戦・優勝
  if (netIsHost()) netHostTick();
  const gid = netMyGame();
  if (gid) {
    if (!(NET.picks[gid] && NET.picks[gid][NET.uid])) { if (netScreen !== 'pick:' + gid) netPickScreen(gid); return; }
    if (allPicked(gid)) return netStart(gid, false);
    return netMenu(T('ほかの人がキャラを選ぶのを待っています…'));
  }
  netMenu();
}

/* いなくなった人のぶんは待たない。片方の陣営が全員いなくなったら、残ったほうの勝ち */
function netCheckGone() {
  const g = NET.games[NET.gid]; if (!g || !B || B.over) return;
  const here = gameSides(g).map(ids => ids.some(id => NET.players[id]));
  if (here[0] && !here[1]) { B.over = 'win'; B.forfeit = true; }
  else if (!here[0] && here[1]) { B.over = 'lose'; B.forfeit = true; }
}

/* ---------- 画面: 待ちあい ---------- */
const MODE_NAME = { floor: 'フロア式', tour: 'トーナメント', team: 'チーム戦' };
const MODE_NOTE = { floor: 'A〜Dのフロアに2人ずつ座ると、そろったフロアがいっせいに始まる(座らない人は観戦)', tour: '入っている人で、くじびきのトーナメント。負けた人は観戦', team: '青と赤に分かれて戦う。城・城の一撃・旗はチームで共有。コインと4体は1人ずつ' };
function netLobby() {
  netScreen = 'lobby'; stopLoop(); guardRoom(true);
  const order = netOrder(), host = netIsHost(), m = NET.meta, mode = m.mode || 'floor', me = NET.players[NET.uid];
  const modes = Object.keys(MODE_NAME).map(k => `<button class="sub mini ${k === mode ? 'on' : ''}" data-md="${k}" ${host ? '' : 'disabled'}>${T(MODE_NAME[k])}</button>`).join('');
  const ln = [1, 2, 3].map(n => `<button class="sub mini ${n === m.lanes ? 'on' : ''}" data-ln="${n}" ${host ? '' : 'disabled'}>${T('{n}本', { n })}</button>`).join('');
  const tag = id => `<span class="pl ${id === NET.uid ? 'me' : ''}">${id === order[0] ? '👑 ' : ''}${esc(pname(id))}</span>`;
  let body = '', ready = false;
  if (mode === 'floor') {
    const full = FLOORS.filter(f => [0, 1].every(i => order.some(id => NET.players[id].seat === f + i)));
    ready = full.length > 0;
    body = `<div class="floors">${FLOORS.map(f => `<div class="floor"><b>${f}</b>${[0, 1].map(i => {
      const id = order.find(x => NET.players[x].seat === f + i);
      return `<button class="seat ${id ? 'taken' : ''} ${id === NET.uid ? 'mine' : ''}" data-seat="${f}${i}" ${id && id !== NET.uid ? 'disabled' : ''}>${id ? esc(pname(id)) : T('座る')}</button>`;
    }).join('<span class="vs">VS</span>')}</div>`).join('')}</div>
    <div class="dim small">${T('座っていない人')}: ${order.filter(id => !NET.players[id].seat).map(id => esc(pname(id))).join('、') || '-'}</div>`;
  } else if (mode === 'team') {
    const t = [0, 1].map(n => order.filter(id => NET.players[id].team === n));
    ready = t[0].length > 0 && t[1].length > 0;
    body = `<div class="teams">${[0, 1].map(n => `<div class="teamcol t${n}"><b>${n ? T('赤チーム') : T('青チーム')}</b>${t[n].map(tag).join('')}<button class="sub mini" data-team="${n}">${me.team === n ? T('ぬける') : T('入る')}</button></div>`).join('')}</div>
    <div class="dim small">${T('チームに入っていない人')}: ${order.filter(id => NET.players[id].team !== 0 && NET.players[id].team !== 1).map(id => esc(pname(id))).join('、') || '-'}</div>`;
  } else {
    ready = order.length >= 2;
    body = `<div class="card">${order.map(tag).join('')}</div>`;
  }
  app.innerHTML = `
  <h1>${T('部屋コード')}</h1>
  <div class="code">${esc(NET.code)}</div>
  <div class="dim small">${T('このコードを教えてね(8人まで)')}・${order.length}/${MAX_PLAYERS}</div>
  <div class="seg">${modes}</div>
  <div class="dim small">${T(MODE_NOTE[mode])}</div>
  ${mode === 'tour' ? '' : `<div class="dim small">${T('入っている人')}: ${order.map(tag).join('')}</div>`}
  ${body}
  <div class="seg"><span class="dim small">${T('道の数')}</span> ${ln}</div>
  ${host ? `<button id="st" class="wide" ${ready ? '' : 'disabled'}>${T('はじめる(キャラ選びへ)')}</button>` : `<div class="dim">${T('ホストが「はじめる」を押すのを待っています')}</div>`}
  <button id="lv" class="sub">${T('部屋を出る')}</button>`;
  if (host) {
    app.querySelectorAll('[data-md]').forEach(b => b.onclick = () => { LS.set('br-mode', b.dataset.md); NET.ref.child('meta/mode').set(b.dataset.md); });
    app.querySelectorAll('[data-ln]').forEach(b => b.onclick = () => { laneCount = +b.dataset.ln; LS.set('br-lanes', laneCount); NET.ref.child('meta/lanes').set(laneCount); });
    $('st').onclick = netHostStart;
  }
  app.querySelectorAll('[data-seat]').forEach(b => b.onclick = () => NET.ref.child('players/' + NET.uid + '/seat').set(me.seat === b.dataset.seat ? null : b.dataset.seat));
  app.querySelectorAll('[data-team]').forEach(b => b.onclick = () => NET.ref.child('players/' + NET.uid + '/team').set(me.team === +b.dataset.team ? null : +b.dataset.team));
  $('lv').onclick = netLeave;
}

/* ホストが「はじめる」: 遊び方ごとに試合を作る */
function netHostStart() {
  const m = NET.meta, order = netOrder(), r = (m.round || 0) + 1, lanes = m.lanes || 2, mode = m.mode || 'floor';
  const seed = () => Math.floor(Math.random() * 0x7fffffff) | 1;
  const up = { 'meta/state': 'play', 'meta/round': r, 'meta/champ': null, games: null, picks: null, tour: null, cmds: null, fr: null, hash: null };
  if (mode === 'floor') {
    for (const f of FLOORS) {
      const a = order.find(id => NET.players[id].seat === f + '0'), b = order.find(id => NET.players[id].seat === f + '1');
      if (a && b) up['games/r' + r + f] = { round: r, seed: seed(), lanes, s0: a, s1: b, label: f };
    }
  } else if (mode === 'team') {
    const t = [0, 1].map(n => order.filter(id => NET.players[id].team === n));
    up['games/r' + r + 'T'] = { round: r, seed: seed(), lanes, s0: t[0].join(','), s1: t[1].join(','), label: 'T' };
  } else {
    // トーナメント: くじびき。2の何乗かにそろえて、足りないぶんは不戦勝('')。組は (i, size/2+i) にして、不戦勝が1つの組に固まらないようにする
    const ids = order.slice().sort(() => Math.random() - 0.5);
    let size = 2; while (size < ids.length) size *= 2;
    const pairs = []; for (let i = 0; i < size / 2; i++) pairs.push(ids[i] || '', ids[size / 2 + i] || '');
    up['tour/1'] = pairs.join(',');
    Object.assign(up, netTourGames(r, 1, pairs, lanes));
  }
  NET.ref.update(up);
}
function netTourGames(r, tr, pairs, lanes) {
  const up = {};
  for (let i = 0; i < pairs.length; i += 2) if (pairs[i] && pairs[i + 1]) up['games/r' + r + 't' + tr + '_' + (i / 2)] = { round: r, seed: Math.floor(Math.random() * 0x7fffffff) | 1, lanes, s0: pairs[i], s1: pairs[i + 1], label: tr + '-' + (i / 2 + 1), tr };
  return up;
}
/* トーナメントの勝ち上がり(ホストだけ): その回戦が全部終わったら、次の回戦を作る */
function netHostTick() {
  const m = NET.meta;
  if (m.mode !== 'tour' || m.champ || m.state !== 'play') return;
  const trs = Object.keys(NET.tour).map(Number).sort((a, b) => a - b), tr = trs[trs.length - 1];
  if (!tr) return;
  const pairs = String(NET.tour[tr]).split(',');
  const win = [];
  for (let i = 0; i < pairs.length; i += 2) {
    const a = pairs[i], b = pairs[i + 1];
    if (!a || !b) { win.push(a || b || ''); continue; }
    const g = NET.games['r' + m.round + 't' + tr + '_' + (i / 2)];
    if (!g || !g.result) return;   // まだ終わっていない試合がある
    win.push(netWinnerIds(g)[0]);
  }
  const alive = win.filter(Boolean);
  if (alive.length <= 1) { NET.ref.child('meta/champ').set(alive[0] || 'none'); return; }
  if (NET.tour[tr + 1]) return;
  NET.ref.update(Object.assign({ ['tour/' + (tr + 1)]: win.join(',') }, netTourGames(m.round, tr + 1, win, m.lanes || 2)));
}
/* 勝った陣営の人(引き分けは、試合の種で決める) */
function netWinnerIds(g) {
  const sides = gameSides(g);
  if (g.result === 'w0') return sides[0];
  if (g.result === 'w1') return sides[1];
  return sides[(g.seed || 0) % 2];
}

/* ---------- キャラ選び ---------- */
const netLabel = g => (g.tr ? T('{n}回戦', { n: g.tr }) : g.label === 'T' ? T('チーム戦') : T('{f}フロア', { f: g.label }));
function netPickScreen(gid) {
  netScreen = 'pick:' + gid;
  const g = NET.games[gid], sides = gameSides(g), mySide = sides[0].includes(NET.uid) ? 0 : 1;
  const foes = sides[1 - mySide].map(pname).join('・');
  draft({ note: T('{label} ・ 相手: {foes} ・ 道は{n}本', { label: netLabel(g), foes, n: g.lanes }), done: p => NET.ref.child('picks/' + gid + '/' + NET.uid).set(p.join(',')) });
}

/* ---------- 試合の一覧(観戦・待つ人) ---------- */
function netMenu(msg) {
  const m = NET.meta, host = netIsHost(), games = netCurGames();
  const key = 'menu:' + JSON.stringify([msg, m, games.map(([id, g]) => [id, g.result, allPicked(id)]), NET.tour, Object.keys(NET.players).length]);
  if (netScreen === key) return;
  netScreen = key; stopLoop(); guardRoom(true);
  const status = (id, g) => g.result ? T('{name} の勝ち', { name: netWinnerIds(g).map(pname).join('・') }) + (g.result === 'd' ? T('(引き分け)') : '') : allPicked(id) ? T('対戦中') : T('キャラ選び中');
  const vs = g => gameSides(g).map(ids => ids.map(pname).map(esc).join('・')).join(' <span class="vs">VS</span> ');
  const list = games.map(([id, g]) => `<div class="gm ${g.result ? 'done' : ''}"><div><b>${esc(netLabel(g))}</b> ${vs(g)}</div><div class="dim small">${status(id, g)}</div>${!g.result && allPicked(id) ? `<button class="sub mini" data-watch="${id}">${T('観戦する')}</button>` : ''}</div>`).join('');
  const allDone = games.every(([, g]) => g.result) && (m.mode !== 'tour' || !!m.champ);
  let tour = '';
  if (m.mode === 'tour') {
    const trs = Object.keys(NET.tour).map(Number).sort((a, b) => a - b);
    tour = `<div class="card left small">${trs.map(tr => { const ps = String(NET.tour[tr]).split(','), out = []; for (let i = 0; i < ps.length; i += 2) out.push(`${ps[i] ? esc(pname(ps[i])) : T('不戦勝')} vs ${ps[i + 1] ? esc(pname(ps[i + 1])) : T('不戦勝')}`); return `<div><b>${T('{n}回戦', { n: tr })}</b> ${out.join(' / ')}</div>`; }).join('')}</div>`;
  }
  const champ = m.mode === 'tour' && m.champ && m.champ !== 'none' ? `<div class="champ">👑 ${T('優勝: {name}', { name: esc(pname(m.champ)) })}</div>` : '';
  app.innerHTML = `
  <h1>${T(MODE_NAME[m.mode || 'floor'])}</h1>
  ${champ}
  ${msg ? `<div class="card">${esc(msg)}</div>` : ''}
  ${tour}
  <div class="gms">${list || `<div class="dim">${T('試合はありません')}</div>`}</div>
  ${host ? `<button id="lobby" class="wide ${allDone ? '' : 'sub'}">${T('待ちあいへ(みんな)')}</button>${allDone ? '' : `<div class="dim small">${T('まだ終わっていない試合があります')}</div>`}` : `<div class="dim small">${allDone ? T('ホストが待ちあいにもどすのを待っています') : ''}</div>`}
  <button id="lv" class="sub">${T('部屋を出る')}</button>`;
  app.querySelectorAll('[data-watch]').forEach(b => b.onclick = () => netStart(b.dataset.watch, true));
  if ($('lobby')) $('lobby').onclick = () => { if (allDone || $('lobby').classList.contains('sure')) NET.ref.update({ 'meta/state': 'lobby', 'meta/champ': null }); else { $('lobby').classList.add('sure'); $('lobby').textContent = T('本当にもどす？'); } };
  $('lv').onclick = netLeave;
}

/* ---------- 対戦(出る人も、観戦する人も) ---------- */
function netStart(gid, watch) {
  const g = NET.games[gid]; if (!g) return;
  netBattleOff();
  const slots = gameSlots(g), me = watch ? -1 : slots.findIndex(s => s.id === NET.uid);
  Object.assign(NET, { gid, watch: me < 0, slots, me, cmds: {}, fr: {}, sentFr: -1, seq: 0, pend: {}, hashes: {}, wait: 0, desync: false, toldDesync: false });
  slots.forEach((s, i) => { NET.fr[i] = DELAY - 1; });
  netScreen = me < 0 ? 'watch' : 'play';
  const players = slots.map(s => ({ side: s.side, deck: String(NET.picks[gid][s.id]).split(',').filter(k => UNITS[k]).slice(0, 4) }));
  play({ me, view: me < 0 ? 0 : slots[me].side, seed: g.seed, lanes: g.lanes || 2, players, specNote: netLabel(g) });
  NET.ref.child('cmds/' + gid).on('child_added', s => netGotCmd(s.val()));
  NET.ref.child('fr/' + gid).on('value', s => { const v = s.val() || {}; for (const k in v) if (typeof v[k] === 'number') NET.fr[k] = Math.max(NET.fr[k] || 0, v[k]); });
  slots.forEach((s, i) => { if (i !== me) NET.ref.child('hash/' + gid + '/' + i).on('child_added', h => netCheckHash(+h.key, h.val())); });
}
function netBattleOff() {
  if (!NET.ref || !NET.gid) return;
  const gid = NET.gid;
  NET.ref.child('cmds/' + gid).off(); NET.ref.child('fr/' + gid).off();
  (NET.slots || []).forEach((s, i) => NET.ref.child('hash/' + gid + '/' + i).off());
}

/* 自分の操作を送る(自分の表にもすぐ入れる) */
function netSend(a, k, lane) {
  if (!B || B.over || NET.me < 0) return false;
  if (a === 'u' && NET.pend['u' + k]) return false;   // 同じキャラの強化は、前のが終わるまで待つ
  const c = { p: NET.me, t: B.tick + DELAY, a, k: k || null, l: lane | 0, n: NET.seq++ };
  netAddCmd(c);
  if (a === 'u') NET.pend['u' + k] = true;
  NET.ref.child('cmds/' + NET.gid).push(c);
  return true;
}
function netAddCmd(c) { (NET.cmds[c.t] = NET.cmds[c.t] || []).push(c); }
function netGotCmd(c) {
  if (!c || (NET.me >= 0 && c.p === NET.me)) return;   // 自分のは、もう入れてある
  if (B && c.t <= B.tick) { NET.desync = true; console.warn('おそすぎる操作', c, B.tick); }
  netAddCmd(c);
}
/* そのコマの操作を実行する(プレイヤー番号・通し番号の順。みんな同じ順) */
function netApply(tick) {
  const list = NET.cmds[tick]; if (!list) return;
  list.sort((a, b) => a.p - b.p || a.n - b.n);
  for (const c of list) {
    if (c.a === 's') spawn(c.p, c.k, c.l);
    else if (c.a === 'u') { levelUp(c.p, c.k); if (c.p === NET.me) delete NET.pend['u' + c.k]; }
    else if (c.a === 'x') strike(sideOf(c.p), c.l);
  }
  delete NET.cmds[tick];
}

/* 1フレームぶん進める(みんなの約束より先へは進まない。観戦は追いつくまで速く進む) */
function netStep(dt) {
  acc = NET.watch ? acc + dt * 8 : Math.min(acc + dt, 0.3);
  // 待つ相手: 出ている人のうち、まだ部屋にいる人(自分はのぞく)
  let lim = Infinity;
  NET.slots.forEach((s, i) => { if (i !== NET.me && NET.players[s.id]) lim = Math.min(lim, NET.fr[i] || 0); });
  if (NET.me >= 0) lim = Math.min(lim, B.tick + DELAY - 1);
  let moved = 0;
  while (acc >= TICK && !B.over && moved < 900) {
    const next = B.tick + 1;
    if (next > lim) break;
    netApply(next); sim(); acc -= TICK; moved++;
    if (B.tick % HASH_EVERY === 0) netHash();
  }
  if (NET.watch && !moved) acc = 0;
  NET.wait = moved ? 0 : NET.wait + dt;
  if (NET.me >= 0) {
    // 自分の約束(このコマ + DELAY - 1 までは、もう操作を出さない)
    const myFr = B.tick + DELAY - 1;
    if (myFr - NET.sentFr >= FR_EVERY || (B.over && myFr > NET.sentFr)) { NET.sentFr = myFr; NET.ref.child('fr/' + NET.gid + '/' + NET.me).set(myFr); }
  }
  if (B.over) netGameOver();
}
function netHud() {
  const w = $('netwait');
  const waiting = NET.wait > 1 && !NET.watch;
  if (waiting && !w) $('toasts').insertAdjacentHTML('afterend', `<div id="netwait" class="netwait">${T('相手を待っています…')}</div>`);
  if (!waiting && w) w.remove();
  if (NET.desync && !NET.toldDesync) { NET.toldDesync = true; toast(T('画面にずれが出ました')); }
}
/* 試合が終わったら、出ていた人が結果を書く(みんな同じ結果なので、だれが書いても同じ) */
function netGameOver() {
  const g = NET.games[NET.gid];
  if (NET.me < 0 || !g || g.result || NET.wroteResult === NET.gid) return;
  NET.wroteResult = NET.gid;
  NET.ref.child('games/' + NET.gid + '/result').set(B.over === 'win' ? 'w0' : B.over === 'lose' ? 'w1' : 'd');
}
/* ずれていないかの確かめ */
const netSig = () => [B.castle.map(Math.round).join('/'), B.units.length, B.pl.map(P => Math.floor(P.coin)).join('/'), B.uid].join(',');
function netHash() {
  const h = netSig(); NET.hashes[B.tick] = h;
  if (NET.me >= 0) NET.ref.child('hash/' + NET.gid + '/' + NET.me + '/' + B.tick).set(h);
  for (const k of Object.keys(NET.hashes)) if (k.startsWith('o' + B.tick + ':')) { netCheckHash(B.tick, NET.hashes[k]); delete NET.hashes[k]; }
}
function netCheckHash(tick, h) {
  if (NET.hashes[tick] === undefined) { NET.hashes['o' + tick + ':' + Math.random()] = h; return; }
  NET.checked = (NET.checked || 0) + 1;
  if (NET.hashes[tick] !== h) { NET.desync = true; console.warn('ずれ', tick, NET.hashes[tick], h); }
}

function netStopWatch(quiet) {
  stopLoop(); netBattleOff(); NET.gid = null; netScreen = '';
  if (!quiet) netRoute();
}

/* ---------- 結果 ---------- */
function netEndButtons() {
  return `<button id="next" class="wide">${T('つづける')}</button>
  <button id="lv" class="sub">${T('部屋を出る')}</button>`;
}
function netEndInit() {
  netScreen = 'end';
  netGameOver();
  netBattleOff();
  $('next').onclick = () => { netScreen = ''; NET.gid = null; netRoute(); };
  $('lv').onclick = netLeave;
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
  Object.assign(NET, { ref: null, code: null, meta: null, players: {}, games: {}, picks: {}, tour: {}, gid: null, got: {} });
  netScreen = '';
  LS.set('br-room', '');
}

home();
