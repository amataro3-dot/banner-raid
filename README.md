# BANNER RAID

キャラを出撃させて相手の城を落とす、対戦タワーディフェンス。Muddy's Games(muddys-games.com/banner-raid/)のゲーム。

- 仕様と引き継ぎは `amataro3-dot/muddys-notes` の `banner-raid/` にある。
- キャラ・お金・城・旗の数値は `units.js` にまとめてある。
- 絵は `img/`(Gemini で作った絵を切り分けたもの)。
- オンライン対戦(8人まで: フロア式・トーナメント・チーム戦)は `net.js`。Firebase は Labyrinth・お絵描きと同じプロジェクト(`config.js`)。ルールに `br-rooms` が必要(muddys-notes の `firebase/firebase_rules.json`)。
- 上げるときは版の番号をそろえる: `node tools/set-version.mjs 14`(絵の `?v=` も game.js の番号に合わせて変わる)
