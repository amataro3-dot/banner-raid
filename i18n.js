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
  '② コインは時間でたまる。キャラのボタンを道までドラッグして出撃': ['② Coins build up over time. Drag a character button onto a lane to send it out', '② 코인은 시간이 지나면 쌓인다. 캐릭터 버튼을 길까지 드래그해서 출격'],
  '③ キャラは相手の城へ進み、ぶつかった敵と戦う': ['③ Characters march to the enemy castle and fight whoever they meet', '③ 캐릭터는 상대 성으로 나아가며 마주친 적과 싸운다'],
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
  '遠くから速く撃つ': ['Shoots fast from a distance', '멀리서 빠르게 쏜다'],
  'まとめて攻撃。かたまった敵に強い': ['Area attack. Strong against packed enemies', '범위 공격. 뭉친 적에게 강하다'],
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
  '道までドラッグして出撃': ['Drag onto a lane to send it out', '길까지 드래그해서 출격'],
  'まだ出せない': ['Not ready yet', '아직 출격할 수 없어요'],
  // --- v=7(キャラ10体・レベル) ---
  '① 10体のキャラから4体を選ぶ': ['① Pick 4 of the 10 characters', '① 캐릭터 10명 중 4명을 고른다'],
  '⬆ でキャラのレベルを上げられる(Lv3まで)。4体は Lv3 で進化する': ['⬆ levels up a character (up to Lv3). Four of them evolve at Lv3', '⬆ 로 캐릭터 레벨을 올릴 수 있다 (Lv3까지). 4명은 Lv3에서 진화한다'],
  'Lv3で{name}に進化': ['Evolves into {name} at Lv3', 'Lv3에서 {name}(으)로 진화'],
  '{a} が {b} に進化！': ['{a} evolved into {b}!', '{a}이(가) {b}(으)로 진화!'],
  '{name} が Lv{n} に！': ['{name} is now Lv{n}!', '{name} Lv{n} 달성!'],
  '近接。1体に大ダメージ。HPは低い。安くてすぐ出せる': ['Melee. Big damage to one enemy. Low HP. Cheap and quick to send', '근접. 적 1명에게 큰 피해. HP는 낮다. 싸고 빨리 출격'],
  '攻撃力アップ': ['Attack up', '공격력 업'],
  'ときどき2倍ダメージ(会心の一撃)': ['Sometimes deals double damage (critical hit)', '가끔 2배 피해 (회심의 일격)'],
  '撃つのが速くなる': ['Shoots faster', '더 빠르게 쏜다'],
  '射程がとても長い。城やHPの多い敵をねらう': ['Very long range. Aims at castles and tough enemies', '사거리가 매우 길다. 성이나 HP가 많은 적을 노린다'],
  '攻撃の範囲が広がる': ['Wider attack area', '공격 범위가 넓어진다'],
  'まとめて攻撃して、敵を遅くする': ['Area attack that also slows enemies', '범위 공격으로 적을 느리게 한다'],
  'ランサー': ['Lancer', '랜서'],
  '少し遠くから突く。前に並んだ2体に当たる': ['Thrusts from a little farther. Hits 2 enemies in a row', '조금 멀리서 찌른다. 앞에 늘어선 2명에게 맞는다'],
  '前に並んだ3体までつらぬく': ['Pierces up to 3 enemies in a row', '앞에 늘어선 3명까지 관통'],
  'HPが高く、前で敵を止める。攻撃は弱い': ['High HP. Holds enemies at the front. Weak attack', 'HP가 높아 앞에서 적을 막는다. 공격은 약하다'],
  'HPアップ': ['HP up', 'HP 업'],
  '攻撃がまわりの敵にも当たる(地ならし)': ['Attacks also hit nearby enemies (ground slam)', '공격이 주변 적에게도 맞는다 (땅 고르기)'],
  '回復量アップ': ['Healing up', '회복량 업'],
  'まわりの味方をみんな回復': ['Heals all nearby allies', '주변 아군 모두를 회복'],
  '効果の範囲が広がる': ['Wider effect area', '효과 범위가 넓어진다'],
  '攻撃だけでなく、歩く速さも上がる': ['Boosts walking speed as well as attacks', '공격뿐 아니라 걷는 속도도 오른다'],
  '稼ぐコインが増える': ['Earns more coins', '버는 코인이 늘어난다'],
  'さらに増える': ['Earns even more', '더욱 늘어난다'],
  'エンジニア': ['Engineer', '엔지니어'],
  '戦わない。城のそばで、城を少しずつ直す': ['Doesn’t fight. Stays by the castle and slowly repairs it', '싸우지 않는다. 성 옆에서 성을 조금씩 고친다'],
  '城を直す量が増える': ['Repairs more', '성을 고치는 양이 늘어난다'],
  '城の一撃のゲージも速くたまる': ['Also charges the Castle Strike gauge faster', '성의 일격 게이지도 빨리 찬다'],
  // --- v=9(旗・道を選ぶ城の一撃) ---
  '④ ゲージがたまったら「城の一撃」。道を1本選んで、城のまわりの敵を一気に攻撃': ['④ When the gauge is full, use Castle Strike on one lane to hit every enemy near your castle', '④ 게이지가 차면 「성의 일격」. 길 하나를 골라 성 주변의 적을 한꺼번에 공격'],
  '⑤ 道のまん中の旗のまわりに、相手より多くキャラがいると旗が取れる。取った旗の数だけコインが多くたまる': ['⑤ Have more characters than the enemy around the flag in the middle of a lane to take it. Each flag you hold earns extra coins', '⑤ 길 가운데 깃발 주변에 상대보다 캐릭터가 많으면 깃발을 차지한다. 차지한 깃발 수만큼 코인이 더 쌓인다'],
  '⑥ 相手の城のHPを先に0にしたほうが勝ち(5分たったら、城のHPが多いほうの勝ち)': ['⑥ First to bring the enemy castle to 0 HP wins (after 5 minutes, more castle HP wins)', '⑥ 상대 성의 HP를 먼저 0으로 만들면 승리 (5분이 지나면 성 HP가 많은 쪽이 승리)'],
  'ゲージがたまっていない': ['The gauge isn’t full yet', '게이지가 아직 안 찼어요'],
  '旗を取った！ コインが多くたまる': ['Flag taken! You earn extra coins', '깃발 획득! 코인이 더 쌓인다'],
  '旗を取られた…': ['The enemy took a flag…', '깃발을 빼앗겼다…'],
  // --- v=10(CPU もキャラで戦う) ---
  '自分': ['You', '나'],
  'タップでスタート': ['Tap to start', '탭해서 시작'],
};
