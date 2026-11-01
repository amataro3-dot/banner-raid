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
  '旗を守りながら、刺客を送りこめ！': ['Guard your banner and send in assassins!', '깃발을 지키면서 자객을 보내라!'],
  '遊び方': ['How to play', '게임 방법'],
  '① 12体のキャラから4体を選ぶ': ['① Pick 4 of the 12 characters', '① 캐릭터 12명 중 4명을 고른다'],
  '② 道のそばにキャラを置いて、旗(🚩)を守る': ['② Place them beside the road to guard your banner (🚩)', '② 길 옆에 캐릭터를 놓아 깃발(🚩)을 지킨다'],
  '③ 敵を倒すとコイン。コインで「キャラを置く・強くする・刺客を送る」': ['③ Defeat enemies for coins. Spend them to place, upgrade, or send assassins', '③ 적을 쓰러뜨리면 코인. 코인으로 「캐릭터 배치·강화·자객 보내기」'],
  '④ 相手の旗のHPを先に0にしたほうが勝ち': ['④ First to bring the rival banner’s HP to 0 wins', '④ 상대 깃발의 HP를 먼저 0으로 만들면 승리'],
  'ひとりで練習(CPU対戦)': ['Practice (vs CPU)', '혼자 연습 (CPU 대전)'],
  'オンライン対戦(準備中)': ['Online battle (coming soon)', '온라인 대전 (준비 중)'],
  '試作版です。キャラの強さは、遊びながら調整します': ['Prototype. Character balance will change as we test.', '시제품 버전이에요. 캐릭터 밸런스는 플레이하면서 조정해요'],
  // --- キャラ選び ---
  'キャラを4体選ぶ': ['Pick 4 characters', '캐릭터 4명 고르기'],
  '選んだ4体だけを、試合で置けます({n}/4)': ['Only your 4 picks can be placed in battle ({n}/4)', '고른 4명만 경기에서 놓을 수 있어요 ({n}/4)'],
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
  '近くの1体に大ダメージ。1体だけ足止めできる': ['Big damage to one nearby enemy. Can block 1 enemy', '가까운 적 1명에게 큰 피해. 1명을 막을 수 있다'],
  '遠くまで速く撃つ': ['Shoots fast from long range', '멀리까지 빠르게 쏜다'],
  'まとめて攻撃(当たったまわりにもダメージ)': ['Area attack (also hurts enemies around the target)', '범위 공격 (맞은 적 주변에도 피해)'],
  '射程がとても長く、撃つのは遅い。HPの多い敵をねらう': ['Very long range, slow shots. Targets the toughest enemy', '사거리가 매우 길고 느리게 쏜다. HP가 많은 적을 노린다'],
  '敵を2体まで足止めする': ['Blocks up to 2 enemies', '적을 2명까지 막는다'],
  'HPがとても多い。3体まで足止めし、敵の攻撃を引きつける': ['Huge HP. Blocks up to 3 enemies and draws their attacks', 'HP가 매우 많다. 3명까지 막고 적의 공격을 끌어당긴다'],
  '受けたダメージの一部をはね返す。少しずつ自分も回復': ['Reflects part of the damage taken. Slowly heals itself', '받은 피해의 일부를 되돌려준다. 조금씩 스스로 회복'],
  'いちばん弱っている1体を大きく回復': ['Greatly heals the most wounded ally', '가장 약해진 아군 1명을 크게 회복'],
  'まわりの味方をみんな少しずつ回復': ['Gently heals all nearby allies', '주변 아군 모두를 조금씩 회복'],
  'まわりの敵をみんな遅くする': ['Slows all nearby enemies', '주변 적 모두를 느리게 한다'],
  'まわりの味方の攻撃を速くする': ['Speeds up nearby allies’ attacks', '주변 아군의 공격을 빠르게 한다'],
  '戦わないかわりに、時間でコインを稼ぐ': ['Doesn’t fight, but earns coins over time', '싸우지 않는 대신 시간에 따라 코인을 번다'],
  // --- 対戦 ---
  '刺客を送る': ['Send assassin', '자객 보내기'],
  '第{n}波': ['Wave {n}', '제{n}파'],
  '⚠️ CPUが刺客を送ってきた！': ['⚠️ The CPU sent an assassin!', '⚠️ CPU가 자객을 보냈다!'],
  '🥷 刺客を送った！': ['🥷 Assassin sent!', '🥷 자객을 보냈다!'],
  '🥷 刺客は止められた…': ['🥷 Your assassin was stopped…', '🥷 자객이 막혔다…'],
  '🥷 CPUの旗に{n}ダメージ！': ['🥷 {n} damage to the CPU banner!', '🥷 CPU 깃발에 {n} 피해!'],
  'コインが足りない': ['Not enough coins', '코인이 부족해요'],
  '強くする': ['Upgrade', '강화'],
  '最大レベル': ['Max level', '최대 레벨'],
  'すぐ復活': ['Revive now', '즉시 부활'],
  '下げる': ['Remove', '철수'],
  '道のそばの空いたマスをタップして置く': ['Tap an empty tile beside the road to place', '길 옆 빈칸을 탭해서 놓기'],
  '下のキャラを選んで、マスをタップして置く。置いたキャラをタップすると、強くできる': ['Choose a character below, then tap a tile. Tap a placed character to upgrade it', '아래 캐릭터를 고르고 칸을 탭해서 놓기. 놓은 캐릭터를 탭하면 강화할 수 있어요'],
  // --- 結果 ---
  '🏆 勝利！': ['🏆 Victory!', '🏆 승리!'],
  '🏳️ 敗北…': ['🏳️ Defeat…', '🏳️ 패배…'],
  'CPUの旗を落とした！': ['You took down the CPU banner!', 'CPU 깃발을 무너뜨렸다!'],
  '旗を守りきれなかった…': ['Your banner fell…', '깃발을 지키지 못했다…'],
  '時間 {m}分{s}秒・第{w}波・倒した敵 {k}': ['Time {m}m {s}s · Wave {w} · Enemies defeated {k}', '시간 {m}분 {s}초 · 제{w}파 · 쓰러뜨린 적 {k}'],
  '同じキャラでもう一回': ['Again with the same team', '같은 캐릭터로 한 번 더'],
  'キャラを選びなおす': ['Pick again', '캐릭터 다시 고르기'],
  'ホームへ': ['Home', '홈으로'],
};
