/* 言語(日本語・English・한국어)。game.js より先に読む。Party-Arcade・Labyrinth・Hit & Blow と同じ決まり。
   - 画面の文字は T('日本語の文')。下の辞書 I18N に [英語, 韓国語] を書く。辞書にない文は日本語のまま出る。
   - {n} などは T('{n}けた',{n:3}) のように置きかえる(HTMLもそのまま入る)。
   - 名前のあとの「さん」は SAN(名前)(英語はなし、韓国語は「님」)。
   - Firebase には数字・名前・uid だけが入る(文は入らない)ので、同じ部屋でも人それぞれの言語で出る。
   - 言語は URL の ?lang=ja/en/ko → localStorage の muddys-lang(全ゲーム共通)→ スマホの言語設定 の順で決める。 */

const LANGS = ['ja', 'en', 'ko'];
const LANG_NAMES = { ja: '日本語', en: 'English', ko: '한국어' };
const LANG = (() => {
  try {
    const q = new URLSearchParams(location.search).get('lang');
    if (LANGS.includes(q)) { localStorage.setItem('muddys-lang', q); return q; }
  } catch (e) { }
  try { const s = localStorage.getItem('muddys-lang'); if (LANGS.includes(s)) return s; } catch (e) { }
  const n = String(navigator.language || '').toLowerCase();
  return n.startsWith('ko') ? 'ko' : n.startsWith('ja') ? 'ja' : 'en';
})();
document.documentElement.lang = LANG;

function T(ja, vars) {
  const e = I18N[ja];
  let s = LANG === 'ja' || !e ? ja : (e[LANG === 'en' ? 0 : 1] ?? ja);
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return s;
}
const SAN = n => n + (LANG === 'ja' ? 'さん' : LANG === 'ko' ? '님' : '');
/* サイトへのリンク(英語・韓国語は /en/ /ko/ のページ) */
const sitePath = p => (LANG !== 'ja' ? '/' + LANG + p : p);

/* ホームの「日本語 / English / 한국어」。押したら、なまえを覚えてから読みこみ直す */
const langSwitchHtml = () => `<div class="seg lang">${LANGS.map(l => `<button class="sub ${l === LANG ? 'on' : ''}" data-lang="${l}">${LANG_NAMES[l]}</button>`).join('')}</div>`;
function langSwitchInit(saveName) {
  document.querySelectorAll('[data-lang]').forEach(b => b.onclick = () => {
    const l = b.dataset.lang; if (l === LANG) return;
    try { saveName(); localStorage.setItem('muddys-lang', l); } catch (e) { }
    const u = new URL(location.href); u.searchParams.delete('lang'); location.href = u.toString();
  });
}

const I18N = {
  // --- ホーム ---
  "Muddy's Games トップ": ["Muddy's Games home", "Muddy's Games 홈"],
  'プライバシーポリシー': ['Privacy policy', '개인정보 처리방침'],
  '遊び方': ['How to play', '게임 방법'],
  '① 12体のキャラから4体を選ぶ': ['① Pick 4 of the 12 characters', '① 캐릭터 12명 중 4명을 고른다'],
  'ひとりで練習(CPU対戦)': ['Practice (vs CPU)', '혼자 연습 (CPU 대전)'],
  'オンライン対戦(準備中)': ['Online battle (coming soon)', '온라인 대전 (준비 중)'],
  '試作版です。キャラの強さは、遊びながら調整します': ['Prototype. Character balance will change as we test.', '시제품 버전이에요. 캐릭터 밸런스는 플레이하면서 조정해요'],
  // --- キャラ選び ---
  'キャラを4体選ぶ': ['Pick 4 characters', '캐릭터 4명 고르기'],
  '出陣！': ['To battle!', '출진!'],
  'もどる': ['Back', '뒤로'],
  'アタッカー': ['Attacker', '어태커'],
  'タンク': ['Tank', '탱커'],
  'ヒーラー': ['Healer', '힐러'],
  'サポート': ['Support', '서포터'],
  'ソード': ['Sword', '소드'],
  'アーチャー': ['Archer', '아처'],
  'メイジ': ['Mage', '메이지'],
  'スナイパー': ['Sniper', '스나이퍼'],
  'ナイト': ['Knight', '나이트'],
  'ゴーレム': ['Golem', '골렘'],
  'パラディン': ['Paladin', '팔라딘'],
  'クレリック': ['Cleric', '클레릭'],
  'シャーマン': ['Shaman', '샤먼'],
  'フロスト': ['Frost', '프로스트'],
  'バード': ['Bard', '바드'],
  'マーチャント': ['Merchant', '머천트'],
  '受けたダメージの一部をはね返す。少しずつ自分も回復': ['Reflects part of the damage taken. Slowly heals itself', '받은 피해의 일부를 되돌려준다. 조금씩 스스로 회복'],
  'まわりの味方をみんな少しずつ回復': ['Gently heals all nearby allies', '주변 아군 모두를 조금씩 회복'],
  'まわりの敵をみんな遅くする': ['Slows all nearby enemies', '주변 적 모두를 느리게 한다'],
  'まわりの味方の攻撃を速くする': ['Speeds up nearby allies’ attacks', '주변 아군의 공격을 빠르게 한다'],
  // --- 対戦 ---
  'コインが足りない': ['Not enough coins', '코인이 부족해요'],
  // --- 結果 ---
  '🏆 勝利！': ['🏆 Victory!', '🏆 승리!'],
  '🏳️ 敗北…': ['🏳️ Defeat…', '🏳️ 패배…'],
  '同じキャラでもう一回': ['Again with the same team', '같은 캐릭터로 한 번 더'],
  'キャラを選びなおす': ['Pick again', '캐릭터 다시 고르기'],
  'ホームへ': ['Home', '홈으로'],
  // --- v=2(攻めていくタイプ) ---
  'キャラを出撃させて、相手の城を落とせ！': ['Send out your characters and take the enemy castle!', '캐릭터를 출격시켜 상대 성을 무너뜨려라!'],
  '② コインは時間でたまる。ボタンでキャラを出撃させる': ['② Coins build up over time. Tap a button to send a character out', '② 코인은 시간이 지나면 쌓인다. 버튼으로 캐릭터를 출격'],
  '③ キャラは相手の城へ進み、ぶつかった敵と戦う': ['③ Characters march to the enemy castle and fight whoever they meet', '③ 캐릭터는 상대 성으로 나아가며 마주친 적과 싸운다'],
  '④ ゲージがたまったら「城の一撃」で、城のまわりの敵を一気に攻撃': ['④ When the gauge is full, use Castle Strike to hit every enemy near your castle', '④ 게이지가 차면 「성의 일격」으로 성 주변의 적을 한꺼번에 공격'],
  '⑤ 相手の城のHPを先に0にしたほうが勝ち(5分たったら、城のHPが多いほうの勝ち)': ['⑤ First to bring the enemy castle to 0 HP wins (after 5 minutes, more castle HP wins)', '⑤ 상대 성의 HP를 먼저 0으로 만들면 승리 (5분이 지나면 성 HP가 많은 쪽이 승리)'],
  '選んだ4体だけを、試合で出撃できます({n}/4)': ['Only your 4 picks can be sent out in battle ({n}/4)', '고른 4명만 경기에서 출격할 수 있어요 ({n}/4)'],
  'CPUの強さ': ['CPU level', 'CPU 난이도'],
  'かんたん': ['Easy', '쉬움'],
  'ふつう': ['Normal', '보통'],
  'むずかしい': ['Hard', '어려움'],
  '相手の城': ['Enemy castle', '상대 성'],
  '自分の城': ['Your castle', '내 성'],
  '城の一撃': ['Castle Strike', '성의 일격'],
  '引き分け': ['Draw', '무승부'],
  '相手の城を落とした！': ['You took the enemy castle!', '상대 성을 무너뜨렸다!'],
  '城を落とされた…': ['Your castle fell…', '성이 무너졌다…'],
  '時間切れ。城のHPでくらべた': ['Time’s up. Decided by castle HP', '시간 종료. 성 HP로 비교했어요'],
  '自分の城 {a} / 相手の城 {b}': ['Your castle {a} / Enemy castle {b}', '내 성 {a} / 상대 성 {b}'],
  '時間 {m}分{s}秒・倒した敵 {k}': ['Time {m}m {s}s · Enemies defeated {k}', '시간 {m}분 {s}초 · 쓰러뜨린 적 {k}'],
  '近接。1体に大ダメージ。安くてすぐ出せる': ['Melee. Big damage to one enemy. Cheap and quick to send', '근접. 적 1명에게 큰 피해. 싸고 빨리 출격'],
  '遠くから速く撃つ': ['Shoots fast from a distance', '멀리서 빠르게 쏜다'],
  'まとめて攻撃。かたまった敵に強い': ['Area attack. Strong against packed enemies', '범위 공격. 뭉친 적에게 강하다'],
  '射程がとても長い。城やHPの多い敵をねらう。撃つのは遅い': ['Very long range. Aims at castles and tough enemies. Slow shots', '사거리가 매우 길다. 성이나 HP가 많은 적을 노린다. 느리게 쏜다'],
  'かたくて、前で敵を止める': ['Sturdy. Holds the enemy at the front', '단단해서 앞에서 적을 막는다'],
  'HPがとても多い。歩くのは遅い': ['Huge HP. Walks slowly', 'HP가 매우 많다. 걸음이 느리다'],
  '味方1体を大きく回復': ['Greatly heals one ally', '아군 1명을 크게 회복'],
  '戦わない。出撃しているあいだ、コインのたまる速さが上がる': ['Doesn’t fight. Coins build up faster while it is out', '싸우지 않는다. 출격해 있는 동안 코인이 더 빨리 쌓인다'],
  'ゴブリン': ['Goblin', '고블린'],
  'オオカミ': ['Wolf', '늑대'],
  'オーク': ['Orc', '오크'],
  'ガイコツ弓兵': ['Skeleton archer', '해골 궁수'],
  '刺客': ['Assassin', '자객'],
  '道の数': ['Lanes', '길 수'],
  '{n}本': ['{n}', '{n}개'],
  '道をタップして出撃': ['Tap a lane to send it out', '길을 탭해서 출격'],
  'まだ出せない': ['Not ready yet', '아직 출격할 수 없어요'],
};
